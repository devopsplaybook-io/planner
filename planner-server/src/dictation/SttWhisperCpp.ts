import axios from "axios";
import * as childProcess from "child_process";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Config } from "../Config";

const logger = console;

const MODEL_NAME_PATTERN = /^ggml-[a-zA-Z0-9._-]+$/;
const MODEL_DOWNLOAD_BASE_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const MODEL_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;
const WHISPER_TIMEOUT_MS = 15 * 60 * 1000;
const WHISPER_MAX_THREADS = 4;
const STDERR_TAIL_LENGTH = 400;

// The embedded engine is CPU-heavy: run one transcription at a time
let transcriptionChain: Promise<unknown> = Promise.resolve();

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = childProcess.spawn(command, args);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs} ms`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function stderrTail(stderr: string): string {
  const tail = stderr.trim().slice(-STDERR_TAIL_LENGTH);
  return tail ? `: ${tail}` : "";
}

function resolveModelPath(config: Config): string {
  const model = config.STT_EMBEDDED_MODEL;
  if (!MODEL_NAME_PATTERN.test(model)) {
    throw new Error(`Invalid embedded STT model name: ${model}`);
  }
  return path.join(config.DATA_DIR, "stt-models", `${model}.bin`);
}

async function ensureModelDownloaded(
  config: Config,
  modelPath: string,
): Promise<void> {
  if (await fs.pathExists(modelPath)) {
    return;
  }
  const model = config.STT_EMBEDDED_MODEL;
  const partPath = `${modelPath}.part`;
  logger.info(`[SttWhisperCpp] Downloading the embedded STT model ${model}`);
  const response = await axios.get(
    `${MODEL_DOWNLOAD_BASE_URL}/${model}.bin`,
    {
      responseType: "stream",
      timeout: MODEL_DOWNLOAD_TIMEOUT_MS,
      maxContentLength: Infinity,
    },
  );
  await fs.ensureDir(path.dirname(modelPath));
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(partPath);
    response.data.on("error", reject);
    writer.on("error", reject);
    writer.on("finish", () => resolve());
    response.data.pipe(writer);
  });
  await fs.rename(partPath, modelPath);
  logger.info(`[SttWhisperCpp] Embedded STT model ${model} downloaded`);
}

async function decodeToWav(
  config: Config,
  audioFilePath: string,
  wavPath: string,
): Promise<void> {
  const result = await runProcess(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      audioFilePath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      wavPath,
    ],
    FFMPEG_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    throw new Error(
      `ffmpeg failed with exit code ${result.code}${stderrTail(result.stderr)}`,
    );
  }
}

async function transcribeWithWhisperCli(
  config: Config,
  modelPath: string,
  wavPath: string,
  language: string | null,
): Promise<string> {
  const binPath =
    config.STT_EMBEDDED_BIN_PATH ||
    path.join(__dirname, "..", "..", "bin", "whisper-cli");
  const threads = Math.min(WHISPER_MAX_THREADS, os.cpus().length || 1);
  const result = await runProcess(
    binPath,
    [
      "-m",
      modelPath,
      "-f",
      wavPath,
      "-l",
      language || "auto",
      "-t",
      String(threads),
      "-np",
      "-nt",
    ],
    WHISPER_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    throw new Error(
      `whisper-cli failed with exit code ${result.code}${stderrTail(result.stderr)}`,
    );
  }
  const transcript = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
  if (!transcript) {
    throw new Error("STT returned an empty transcript");
  }
  return transcript;
}

async function transcribe(
  config: Config,
  audioFilePath: string,
  language: string | null,
): Promise<string> {
  const modelPath = resolveModelPath(config);
  await ensureModelDownloaded(config, modelPath);
  const wavPath = path.join(config.TMP_DIR, "dictation", `${uuidv4()}.wav`);
  try {
    await fs.ensureDir(path.dirname(wavPath));
    await decodeToWav(config, audioFilePath, wavPath);
    return await transcribeWithWhisperCli(config, modelPath, wavPath, language);
  } finally {
    try {
      await fs.remove(wavPath);
    } catch (error) {
      logger.error(
        `[SttWhisperCpp] Failed to delete the temporary WAV file: ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Transcribes an audio file with the embedded whisper.cpp engine. The engine
 * only runs while a transcription is in progress: the model is loaded by a
 * short-lived whisper-cli process spawned per call and nothing engine-related
 * stays resident between dictations.
 */
export async function SttWhisperCppTranscribe(
  config: Config,
  audioFilePath: string,
  audioMimeType: string,
  language: string | null,
): Promise<string> {
  const run = transcriptionChain.then(() =>
    transcribe(config, audioFilePath, language),
  );
  // Keep the chain alive even when a transcription fails
  transcriptionChain = run.catch(() => undefined);
  return run;
}
