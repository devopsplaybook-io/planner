import axios from "axios";
import * as childProcess from "child_process";
import * as fs from "fs-extra";
import { promises as fsp } from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Config } from "../Config";
import {
  ReadEffectiveCpuCount,
  ResolveWhisperThreads,
} from "../utils/CpuLimits";
import {
  DictationSegment,
  DICTATION_SEGMENTS_MAX,
} from "./DictationTypes";
import {
  DictationTelemetryRecordModelPrepare,
  DictationTelemetryStartSpan,
} from "./DictationTelemetry";

const logger = console;

const MODEL_NAME_PATTERN = /^ggml-[a-zA-Z0-9._-]+$/;
const MODEL_DOWNLOAD_BASE_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const MODEL_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;
const WHISPER_TIMEOUT_MS = 15 * 60 * 1000;
const WHISPER_MAX_THREADS = 4;
const MODEL_DOWNLOAD_ATTEMPTS = 3;
const MIN_SPEECH_DURATION_MS = 300;

// The embedded engine is CPU-heavy: one transcription at a time, interactive
// work always dequeued before long-form batch chunks.
export type SttPriority = "interactive" | "batch";

interface SttQueueEntry {
  run: () => Promise<SttWhisperCppResult>;
  resolve: (value: SttWhisperCppResult) => void;
  reject: (error: unknown) => void;
}

const sttQueues: Record<SttPriority, SttQueueEntry[]> = {
  interactive: [],
  batch: [],
};
let sttWorkerRunning = false;

async function drainSttQueue(): Promise<void> {
  if (sttWorkerRunning) {
    return;
  }
  sttWorkerRunning = true;
  try {
    for (;;) {
      const entry =
        sttQueues.interactive.shift() ?? sttQueues.batch.shift();
      if (!entry) {
        break;
      }
      try {
        entry.resolve(await entry.run());
      } catch (error) {
        // A failed transcription must never stall the queue
        entry.reject(error);
      }
    }
  } finally {
    sttWorkerRunning = false;
  }
}

function enqueueTranscription(
  priority: SttPriority,
  run: () => Promise<SttWhisperCppResult>,
): Promise<SttWhisperCppResult> {
  return new Promise((resolve, reject) => {
    sttQueues[priority].push({ run, resolve, reject });
    if (!sttWorkerRunning) {
      void drainSttQueue();
    }
  });
}

export interface SttWhisperCppResult {
  text: string;
  /** Duration of the decoded (optionally trimmed) audio, null when unknown */
  audioDurationMs: number | null;
  threads: number;
  sttMs: number;
  /** Per-segment confidence when the JSON output is available */
  segments: DictationSegment[] | null;
}

export interface SttWhisperCppTranscribeOptions {
  model?: string;
  threads?: number;
  trimSilence?: boolean;
  /** Initial prompt biasing the engine towards the user's vocabulary */
  prompt?: string | null;
  /** Benchmark hook: called with the spawned whisper-cli process */
  onSpawn?: (child: childProcess.ChildProcessWithoutNullStreams) => void;
  /** Queue lane: interactive recordings overtake long-form batch chunks. */
  priority?: SttPriority;
}

export interface SttWhisperCppPrepareOptions {
  /** Overrides the retry backoff (tests) */
  retryDelayMs?: number;
}

export type SttWhisperCppEngineState =
  | "idle"
  | "downloading"
  | "ready"
  | "error";

export interface SttWhisperCppStatus {
  state: SttWhisperCppEngineState;
  model: string | null;
  error: string | null;
}

/** Raised when the recording contains no usable speech after trimming. */
export class SttNoSpeechError extends Error {
  constructor() {
    super("No speech detected");
    this.name = "SttNoSpeechError";
  }
}

interface ModelState {
  state: SttWhisperCppEngineState;
  error: string | null;
  promise: Promise<void> | null;
}

const modelStates = new Map<string, ModelState>();

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  onSpawn?: (child: childProcess.ChildProcessWithoutNullStreams) => void,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = childProcess.spawn(command, args);
    onSpawn?.(child);
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

function resolveModelPath(config: Config, model?: string): string {
  const name = model || config.STT_EMBEDDED_MODEL;
  if (!MODEL_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid embedded STT model name: ${name}`);
  }
  return path.join(config.DATA_DIR, "stt-models", `${name}.bin`);
}

function getEngineStatus(config: Config, model?: string): SttWhisperCppStatus {
  const name = model || config.STT_EMBEDDED_MODEL;
  let modelPath: string;
  try {
    modelPath = resolveModelPath(config, name);
  } catch {
    return { state: "error", model: name, error: "Invalid model name" };
  }
  const state = modelStates.get(modelPath);
  if (state) {
    return { state: state.state, model: name, error: state.error };
  }
  return { state: "idle", model: name, error: null };
}

/**
 * Current embedded engine preparation state, for the config endpoint and the
 * job view: "ready" when the model file is on disk, "downloading" while the
 * startup/lazy download runs, "error" after a failed download.
 */
export function SttWhisperCppGetStatus(
  config: Config,
  model?: string,
): SttWhisperCppStatus {
  const status = getEngineStatus(config, model);
  if (status.state === "idle") {
    try {
      if (fs.existsSync(resolveModelPath(config, model))) {
        return { ...status, state: "ready" };
      }
    } catch {
      // Invalid model name: reported above
    }
  }
  return status;
}

/** Thread count actually passed to whisper-cli for the current config. */
export function SttWhisperCppGetThreads(config: Config): number {
  return ResolveWhisperThreads(
    ReadEffectiveCpuCount(),
    config.STT_EMBEDDED_THREADS,
    WHISPER_MAX_THREADS,
  );
}

/**
 * Deletes leftover `.part` files of interrupted model downloads. Called at
 * startup so a crash never leaves a partial model behind.
 */
export async function SttWhisperCppCleanStalePartFiles(
  config: Config,
): Promise<number> {
  const dir = path.join(config.DATA_DIR, "stt-models");
  if (!(await fs.pathExists(dir))) {
    return 0;
  }
  let removed = 0;
  for (const file of await fs.readdir(dir)) {
    if (file.endsWith(".part")) {
      await fs.remove(path.join(dir, file)).catch(() => undefined);
      removed++;
    }
  }
  return removed;
}

async function downloadModel(
  config: Config,
  model: string,
  modelPath: string,
): Promise<void> {
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
  try {
    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(partPath);
      response.data.on("error", reject);
      writer.on("error", reject);
      writer.on("finish", () => resolve());
      response.data.pipe(writer);
    });
    await fs.rename(partPath, modelPath);
  } catch (error) {
    await fs.remove(partPath).catch(() => undefined);
    throw error;
  }
  logger.info(`[SttWhisperCpp] Embedded STT model ${model} downloaded`);
}

/**
 * Ensures the embedded model is on disk, downloading it to a `.part` file
 * and renaming it on success. Concurrent callers share one download; a
 * failed download is retried (2 s / 4 s / 8 s) and leaves no `.part` file.
 * Never awaited at startup (see DictationInit) so readiness is unaffected.
 */
export async function SttWhisperCppPrepareModel(
  config: Config,
  model?: string,
  options: SttWhisperCppPrepareOptions = {},
): Promise<void> {
  const name = model || config.STT_EMBEDDED_MODEL;
  const modelPath = resolveModelPath(config, name);
  if (await fs.pathExists(modelPath)) {
    modelStates.set(modelPath, {
      state: "ready",
      error: null,
      promise: null,
    });
    return;
  }
  const existing = modelStates.get(modelPath);
  if (existing?.promise) {
    return existing.promise;
  }
  const state: ModelState = { state: "downloading", error: null, promise: null };
  modelStates.set(modelPath, state);
  state.promise = (async () => {
    const delays = [2000, 4000, 8000].map(
      (delay) => options.retryDelayMs ?? delay,
    );
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MODEL_DOWNLOAD_ATTEMPTS; attempt++) {
      try {
        await downloadModel(config, name, modelPath);
        state.state = "ready";
        state.error = null;
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < MODEL_DOWNLOAD_ATTEMPTS - 1) {
          logger.warn(
            `[SttWhisperCpp] Model download attempt ${attempt + 1} failed, retrying`,
          );
          await sleep(delays[attempt]);
        }
      }
    }
    state.state = "error";
    state.error = lastError?.message || "Model download failed";
    throw lastError || new Error("Model download failed");
  })().finally(() => {
    state.promise = null;
  });
  return state.promise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimSilenceFilter(): string {
  // Remove leading and trailing silence: trim start, reverse, trim start,
  // reverse back.
  return [
    "silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:detection=peak",
    "areverse",
    "silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:detection=peak",
    "areverse",
  ].join(",");
}

async function decodeToWav(
  audioFilePath: string,
  wavPath: string,
  trimSilence: boolean,
): Promise<void> {
  const args = [
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
  ];
  if (trimSilence) {
    args.push("-af", trimSilenceFilter());
  }
  args.push("-f", "wav", wavPath);
  // Errors never embed ffmpeg stderr: it may contain audio metadata and the
  // command name plus exit code is enough to diagnose a failure.
  const result = await runProcess("ffmpeg", args, FFMPEG_TIMEOUT_MS);
  if (result.code !== 0) {
    throw new Error(`ffmpeg failed with exit code ${result.code}`);
  }
}

/**
 * Reads the duration of a PCM WAV file from its RIFF chunks. Returns null
 * when the header cannot be interpreted.
 */
export async function ParseWavDurationMs(
  wavPath: string,
): Promise<number | null> {
  let handle: fsp.FileHandle | null = null;
  try {
    handle = await fsp.open(wavPath, "r");
    const head = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (bytesRead < 44 || head.toString("ascii", 0, 4) !== "RIFF") {
      return null;
    }
    let sampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let dataSize = -1;
    let offset = 12;
    while (offset + 8 <= bytesRead) {
      const chunkId = head.toString("ascii", offset, offset + 4);
      const chunkSize = head.readUInt32LE(offset + 4);
      if (chunkId === "fmt " && offset + 24 <= bytesRead) {
        channels = head.readUInt16LE(offset + 10);
        sampleRate = head.readUInt32LE(offset + 12);
        bitsPerSample = head.readUInt16LE(offset + 22);
      } else if (chunkId === "data") {
        dataSize = chunkSize;
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    if (!sampleRate || !channels || !bitsPerSample || dataSize < 0) {
      return null;
    }
    return Math.round(
      (dataSize * 1000) / (sampleRate * channels * (bitsPerSample / 8)),
    );
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

const SPECIAL_TOKEN_PATTERN = /^(\[_.*\]|<\|.*\|>)$/;

interface WhisperJsonResult {
  text: string;
  segments: DictationSegment[] | null;
}

/**
 * Parses the whisper.cpp full JSON output into per-segment confidences.
 * Tokens with a special marker or no text are ignored; the confidence is the
 * average token probability of the segment. Returns null segments when the
 * JSON cannot be read (the caller keeps the plain transcript).
 */
async function readWhisperJson(
  jsonPath: string,
): Promise<DictationSegment[] | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fsp.readFile(jsonPath, "utf-8"));
  } catch {
    return null;
  }
  const transcription = (parsed as { transcription?: unknown })?.transcription;
  if (!Array.isArray(transcription)) {
    return null;
  }
  const segments: DictationSegment[] = [];
  for (const raw of transcription.slice(0, DICTATION_SEGMENTS_MAX)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (!text) {
      continue;
    }
    const offsets = entry.offsets as
      | { from?: unknown; to?: unknown }
      | undefined;
    const fromMs = Number(offsets?.from);
    const toMs = Number(offsets?.to);
    let sum = 0;
    let count = 0;
    if (Array.isArray(entry.tokens)) {
      for (const token of entry.tokens) {
        if (!token || typeof token !== "object") {
          continue;
        }
        const tokenEntry = token as { text?: unknown; p?: unknown };
        const tokenText =
          typeof tokenEntry.text === "string" ? tokenEntry.text.trim() : "";
        if (!tokenText || SPECIAL_TOKEN_PATTERN.test(tokenText)) {
          continue;
        }
        const probability = Number(tokenEntry.p);
        if (!Number.isFinite(probability)) {
          continue;
        }
        sum += probability;
        count++;
      }
    }
    segments.push({
      text,
      fromMs: Number.isFinite(fromMs) ? Math.max(0, fromMs) : 0,
      toMs: Number.isFinite(toMs) ? Math.max(0, toMs) : 0,
      confidence:
        count > 0 ? Math.min(1, Math.max(0, sum / count)) : null,
    });
  }
  return segments.length > 0 ? segments : null;
}

async function transcribeWithWhisperCli(
  config: Config,
  modelPath: string,
  wavPath: string,
  language: string | null,
  threads: number,
  prompt?: string | null,
  onSpawn?: (child: childProcess.ChildProcessWithoutNullStreams) => void,
): Promise<WhisperJsonResult> {
  const binPath =
    config.STT_EMBEDDED_BIN_PATH ||
    path.join(__dirname, "..", "..", "bin", "whisper-cli");
  const jsonBase = path.join(path.dirname(wavPath), uuidv4());
  const jsonPath = `${jsonBase}.json`;
  const args = [
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
    // Full JSON output is written to <jsonBase>.json: it carries the segment
    // offsets and token probabilities used for the confidence review.
    "-ojf",
    "-of",
    jsonBase,
  ];
  if (prompt) {
    args.push("--prompt", prompt);
  }
  try {
    const result = await runProcess(
      binPath,
      args,
      WHISPER_TIMEOUT_MS,
      onSpawn,
    );
    if (result.code !== 0) {
      // Never surface whisper stderr: it can contain transcript fragments.
      throw new Error(`whisper-cli failed with exit code ${result.code}`);
    }
    const transcript = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(" ");
    if (!transcript) {
      throw new Error("STT returned an empty transcript");
    }
    // Confidence is best-effort: a missing/malformed JSON never fails the job
    const segments = await readWhisperJson(jsonPath);
    return { text: transcript, segments };
  } finally {
    await fs.remove(jsonPath).catch(() => undefined);
  }
}

async function transcribe(
  config: Config,
  audioFilePath: string,
  language: string | null,
  options: SttWhisperCppTranscribeOptions,
): Promise<SttWhisperCppResult> {
  const modelName = options.model || config.STT_EMBEDDED_MODEL;
  const modelPath = resolveModelPath(config, modelName);
  const threads = options.threads ?? SttWhisperCppGetThreads(config);
  const trimSilence = options.trimSilence ?? config.STT_EMBEDDED_TRIM_SILENCE;

  const prepareSpan = DictationTelemetryStartSpan(
    "dictation.model_prepare",
    undefined,
    { "stt.model": modelName, "stt.engine": "embedded" },
  );
  const prepareStart = Date.now();
  try {
    await SttWhisperCppPrepareModel(config, modelName);
    DictationTelemetryRecordModelPrepare(
      modelName,
      Date.now() - prepareStart,
      "ready",
    );
  } catch (error) {
    prepareSpan.fail(error);
    DictationTelemetryRecordModelPrepare(
      modelName,
      Date.now() - prepareStart,
      "error",
    );
    throw error;
  } finally {
    prepareSpan.end();
  }

  const wavPath = path.join(config.TMP_DIR, "dictation", `${uuidv4()}.wav`);
  try {
    const decodeSpan = DictationTelemetryStartSpan("dictation.decode");
    try {
      await fs.ensureDir(path.dirname(wavPath));
      await decodeToWav(audioFilePath, wavPath, trimSilence);
    } catch (error) {
      decodeSpan.fail(error);
      throw error;
    } finally {
      decodeSpan.end();
    }

    const audioDurationMs = await ParseWavDurationMs(wavPath);
    if (
      trimSilence &&
      audioDurationMs !== null &&
      audioDurationMs < MIN_SPEECH_DURATION_MS
    ) {
      throw new SttNoSpeechError();
    }

    const sttSpan = DictationTelemetryStartSpan("dictation.stt", undefined, {
      "stt.engine": "embedded",
      "stt.model": modelName,
      "stt.threads": threads,
      ...(audioDurationMs !== null
        ? { "audio.duration_ms": audioDurationMs }
        : {}),
    });
    const sttStart = Date.now();
    try {
      const { text, segments } = await transcribeWithWhisperCli(
        config,
        modelPath,
        wavPath,
        language,
        threads,
        options.prompt,
        options.onSpawn,
      );
      const sttMs = Date.now() - sttStart;
      sttSpan.setAttribute("transcript.chars", text.length);
      return { text, audioDurationMs, threads, sttMs, segments };
    } catch (error) {
      sttSpan.fail(error);
      throw error;
    } finally {
      sttSpan.end();
    }
  } finally {
    await fs.remove(wavPath).catch(() => undefined);
  }
}

/**
 * Transcribes an audio file with the embedded whisper.cpp engine. The engine
 * only runs while a transcription is in progress: the model is loaded by a
 * short-lived whisper-cli process spawned per call. Runs are serialized (one
 * embedded transcription at a time) through a two-lane FIFO scheduler:
 * queued interactive recordings always run before the next batch chunk, so a
 * long-form import can never starve dictation. Each entry is enqueued
 * separately by its caller, which lets interactive work interleave between
 * long-form chunks.
 */
export async function SttWhisperCppTranscribe(
  config: Config,
  audioFilePath: string,
  _audioMimeType: string,
  language: string | null,
  options: SttWhisperCppTranscribeOptions = {},
): Promise<SttWhisperCppResult> {
  const priority: SttPriority =
    options.priority === "batch" ? "batch" : "interactive";
  return enqueueTranscription(priority, () =>
    transcribe(config, audioFilePath, language, options),
  );
}
