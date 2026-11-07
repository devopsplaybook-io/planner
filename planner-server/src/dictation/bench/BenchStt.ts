/**
 * Embedded STT benchmark harness.
 *
 * Runs the production whisper-cli invocation (same decode flags, optional
 * silence trim, -np/-nt) over real speech samples and reports per-config
 * RTF, p50/p95 latency, peak RSS and optional WER. Node builtins only so the
 * compiled file can be copied into a running planner pod and executed there
 * under the production cgroup limits.
 *
 * Usage:
 *   npm run bench:stt -- --audio-dir bench/audio --models ggml-base \
 *     --threads 1,2 --out /tmp/bench/results.json
 *
 * See docs/dictation-benchmark.md for the full procedure.
 */
import * as childProcess from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";

const USER_AGENT = "planner-dictation-bench/1.0";
const MODEL_DOWNLOAD_BASE_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const MODEL_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const DECODE_TIMEOUT_MS = 5 * 60 * 1000;
const WHISPER_TIMEOUT_MS = 15 * 60 * 1000;
const RSS_SAMPLE_MS = 100;

interface BenchOptions {
  audioDir: string;
  modelsDir: string;
  bin: string;
  ffmpeg: string;
  models: string[];
  threads: number[];
  trim: boolean;
  legacy: boolean;
  runs: number;
  language: string;
  out: string;
  references: string;
  cleanupModels: boolean;
  modelsBaseUrl: string;
}

interface Config {
  id: string;
  model: string;
  threads: number;
  trim: boolean;
  legacy: boolean;
}

interface RunSample {
  clip: string;
  run: number;
  sttMs: number;
  audioDurationMs: number | null;
  peakRssKb: number;
  transcript: string;
}

interface ClipResult {
  clip: string;
  audioDurationMs: number | null;
  runs: RunSample[];
}

interface ConfigResult {
  config: Config;
  clips: ClipResult[];
  p50SttMs: number | null;
  p95SttMs: number | null;
  p50Rtf: number | null;
  p95Rtf: number | null;
  peakRssMb: number | null;
  wer: number | null;
}

function usage(): string {
  return `Usage: BenchStt --audio-dir <dir> [options]

  --audio-dir <dir>        Directory with 10-30 s speech clips (required)
  --models-dir <dir>       Model directory (default: DATA_DIR/stt-models)
  --bin <path>             whisper-cli binary (default: ./bin/whisper-cli)
  --ffmpeg <path>          ffmpeg binary (default: ffmpeg)
  --models <csv>           Models to benchmark (default: ggml-base)
  --threads <csv>          Thread counts (default: 1)
  --no-trim                Disable the production silence trim
  --legacy                 Add the legacy baseline (-t 4, no trim, base)
  --runs <n>               Runs per clip, first is discarded (default: 3)
  --language <code>        whisper-cli language (default: auto)
  --references <file>      JSON map clip filename -> reference text for WER
  --out <file>             Write the JSON report here (default: stdout)
  --cleanup-models         Delete models downloaded by this run
  --models-base-url <url>  Model download base (Hugging Face by default)`;
}

function parseArgs(argv: string[]): BenchOptions {
  const opts: BenchOptions = {
    audioDir: "",
    modelsDir: process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, "stt-models")
      : "/data/stt-models",
    bin: "",
    ffmpeg: "ffmpeg",
    models: ["ggml-base"],
    threads: [1],
    trim: true,
    legacy: false,
    runs: 3,
    language: "auto",
    out: "",
    references: "",
    cleanupModels: false,
    modelsBaseUrl: MODEL_DOWNLOAD_BASE_URL,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      return value;
    };
    switch (arg) {
      case "--audio-dir":
        opts.audioDir = next();
        break;
      case "--models-dir":
        opts.modelsDir = next();
        break;
      case "--bin":
        opts.bin = next();
        break;
      case "--ffmpeg":
        opts.ffmpeg = next();
        break;
      case "--models":
        opts.models = next()
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case "--threads":
        opts.threads = next()
          .split(",")
          .map((value) => parseInt(value.trim(), 10))
          .filter((value) => Number.isFinite(value) && value > 0);
        break;
      case "--no-trim":
        opts.trim = false;
        break;
      case "--legacy":
        opts.legacy = true;
        break;
      case "--runs":
        opts.runs = Math.max(1, parseInt(next(), 10) || 3);
        break;
      case "--language":
        opts.language = next();
        break;
      case "--references":
        opts.references = next();
        break;
      case "--out":
        opts.out = next();
        break;
      case "--cleanup-models":
        opts.cleanupModels = true;
        break;
      case "--models-base-url":
        opts.modelsBaseUrl = next();
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!opts.audioDir) {
    throw new Error("--audio-dir is required");
  }
  return opts;
}

function resolveDefaultBin(): string {
  const candidates = [
    path.join(process.cwd(), "bin", "whisper-cli"),
    path.join(__dirname, "..", "..", "..", "bin", "whisper-cli"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  sampleRss: boolean,
): Promise<{ code: number | null; stdout: string; stderr: string; peakRssKb: number; wallMs: number }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let peakRssKb = 0;
    let timedOut = false;
    const startedAt = Date.now();
    const child = childProcess.spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const rssTimer = sampleRss
      ? setInterval(() => {
          if (!child.pid) {
            return;
          }
          try {
            const status = fs.readFileSync(
              `/proc/${child.pid}/status`,
              "utf8",
            );
            const match = /VmHWM:\s+(\d+)\s+kB/.exec(status);
            if (match) {
              peakRssKb = Math.max(peakRssKb, parseInt(match[1], 10));
            }
          } catch {
            // Process already exited: the final sample is the peak
          }
        }, RSS_SAMPLE_MS)
      : null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (rssTimer) clearInterval(rssTimer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (rssTimer) clearInterval(rssTimer);
      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs} ms`));
        return;
      }
      resolve({ code, stdout, stderr, peakRssKb, wallMs: Date.now() - startedAt });
    });
  });
}

function download(
  url: string,
  destination: string,
  redirects = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(
      url,
      { headers: { "User-Agent": USER_AGENT } },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirects <= 0) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          const nextUrl = new URL(response.headers.location, url).toString();
          download(nextUrl, destination, redirects - 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`Download failed with HTTP ${status} for ${url}`));
          return;
        }
        const writer = fs.createWriteStream(destination);
        response.pipe(writer);
        writer.on("finish", () => writer.close(() => resolve()));
        writer.on("error", reject);
      },
    );
    request.on("error", reject);
    request.setTimeout(MODEL_DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error(`Download timed out for ${url}`));
    });
  });
}

async function ensureModel(
  opts: BenchOptions,
  model: string,
): Promise<{ file: string; downloaded: boolean }> {
  const file = path.join(opts.modelsDir, `${model}.bin`);
  if (fs.existsSync(file)) {
    return { file, downloaded: false };
  }
  fs.mkdirSync(opts.modelsDir, { recursive: true });
  const part = `${file}.part`;
  console.error(`[bench] downloading ${model} to ${file}`);
  try {
    await download(`${opts.modelsBaseUrl}/${model}.bin`, part);
    fs.renameSync(part, file);
  } catch (error) {
    try {
      fs.unlinkSync(part);
    } catch {
      // Nothing to clean up
    }
    throw error;
  }
  return { file, downloaded: true };
}

function wavDurationMs(wavPath: string): number | null {
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(wavPath);
  } catch {
    return null;
  }
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    return null;
  }
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataSize = -1;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && offset + 24 <= buffer.length) {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
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
}

function trimFilter(): string {
  return [
    "silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:detection=peak",
    "areverse",
    "silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:detection=peak",
    "areverse",
  ].join(",");
}

async function decodeToWav(
  opts: BenchOptions,
  audioPath: string,
  wavPath: string,
  trim: boolean,
): Promise<void> {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    audioPath,
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
  ];
  if (trim) {
    args.push("-af", trimFilter());
  }
  args.push("-f", "wav", wavPath);
  const result = await runProcess(opts.ffmpeg, args, DECODE_TIMEOUT_MS, false);
  if (result.code !== 0) {
    throw new Error(`ffmpeg failed with exit code ${result.code}`);
  }
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function wordErrorRate(reference: string, hypothesis: string): number {
  const expected = normalizeWords(reference);
  const actual = normalizeWords(hypothesis);
  if (!expected.length) {
    return 0;
  }
  let previous = Array.from({ length: actual.length + 1 }, (_, i) => i);
  for (let i = 1; i <= expected.length; i++) {
    const current = [i];
    for (let j = 1; j <= actual.length; j++) {
      const cost = expected[i - 1] === actual[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[actual.length] / expected.length;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const value =
    sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
  return Math.round(value * 10) / 10;
}

function buildConfigs(opts: BenchOptions): Config[] {
  const configs: Config[] = [];
  for (const model of opts.models) {
    for (const threads of opts.threads) {
      configs.push({
        id: `${model} t${threads}${opts.trim ? "" : " no-trim"}`,
        model,
        threads,
        trim: opts.trim,
        legacy: false,
      });
    }
  }
  if (opts.legacy) {
    const legacy: Config = {
      id: "legacy ggml-base t4 no-trim",
      model: "ggml-base",
      threads: 4,
      trim: false,
      legacy: true,
    };
    if (
      !configs.some(
        (config) =>
          config.model === legacy.model &&
          config.threads === legacy.threads &&
          config.trim === legacy.trim,
      )
    ) {
      configs.push(legacy);
    }
  }
  return configs;
}

function listClips(audioDir: string): string[] {
  return fs
    .readdirSync(audioDir)
    .filter((name) => /\.(wav|mp3|ogg|oga|flac|m4a|webm)$/i.test(name))
    .sort()
    .map((name) => path.join(audioDir, name));
}

function cgroupCpuMax(): string {
  for (const file of [
    "/sys/fs/cgroup/cpu.max",
    "/sys/fs/cgroup/cpu/cpu.cfs_quota_us",
  ]) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {
      // Try the next cgroup layout
    }
  }
  return "";
}

function cpuModel(): string {
  try {
    const cpuinfo = fs.readFileSync("/proc/cpuinfo", "utf8");
    const match = /model name\s*:\s*(.+)/.exec(cpuinfo);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

async function binaryVersion(
  command: string,
  args: string[],
): Promise<string> {
  try {
    const result = await runProcess(command, args, 10000, false);
    return `${result.stdout}${result.stderr}`.trim().split("\n")[0] || "";
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  opts.bin = opts.bin || resolveDefaultBin();
  const clips = listClips(opts.audioDir);
  if (!clips.length) {
    throw new Error(`No audio clips found in ${opts.audioDir}`);
  }
  if (!fs.existsSync(opts.bin)) {
    throw new Error(`whisper-cli not found at ${opts.bin}`);
  }
  let references: Record<string, string> = {};
  if (opts.references) {
    references = JSON.parse(fs.readFileSync(opts.references, "utf8"));
  }

  const configs = buildConfigs(opts);
  const modelFiles = new Map<string, string>();
  const downloadedModels: string[] = [];
  for (const model of new Set(configs.map((config) => config.model))) {
    const { file, downloaded } = await ensureModel(opts, model);
    modelFiles.set(model, file);
    if (downloaded) {
      downloadedModels.push(file);
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-stt-"));
  const decoded = new Map<string, string>();
  const results: ConfigResult[] = [];

  try {
    for (const config of configs) {
      console.error(`[bench] config ${config.id}`);
      const clipResults: ClipResult[] = [];
      const sttSamples: number[] = [];
      const rtfSamples: number[] = [];
      let peakRssKb = 0;
      const wers: number[] = [];

      for (const clip of clips) {
        const clipName = path.basename(clip);
        const decodeKey = `${clip}|${config.trim}`;
        let wavPath = decoded.get(decodeKey);
        let audioDurationMs: number | null = null;
        if (!wavPath) {
          wavPath = path.join(
            tempDir,
            `${decoded.size}-${path.basename(clip, path.extname(clip))}.wav`,
          );
          await decodeToWav(opts, clip, wavPath, config.trim);
          decoded.set(decodeKey, wavPath);
        }
        audioDurationMs = wavDurationMs(wavPath);
        if (audioDurationMs === null) {
          throw new Error(`Cannot read the decoded duration of ${clip}`);
        }

        const runs: RunSample[] = [];
        for (let run = 0; run < opts.runs; run++) {
          const result = await runProcess(
            opts.bin,
            [
              "-m",
              modelFiles.get(config.model) as string,
              "-f",
              wavPath,
              "-l",
              opts.language,
              "-t",
              String(config.threads),
              "-np",
              "-nt",
            ],
            WHISPER_TIMEOUT_MS,
            true,
          );
          if (result.code !== 0) {
            throw new Error(
              `whisper-cli failed with exit code ${result.code} for ${clipName}`,
            );
          }
          const transcript = result.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .join(" ");
          const sample: RunSample = {
            clip: clipName,
            run,
            sttMs: result.wallMs,
            audioDurationMs,
            peakRssKb: result.peakRssKb,
            transcript,
          };
          runs.push(sample);
          // The first run pays the cold cache cost: discard it
          if (run > 0 || opts.runs === 1) {
            sttSamples.push(sample.sttMs);
            rtfSamples.push(
              Math.round((sample.sttMs / audioDurationMs) * 1000) / 1000,
            );
            peakRssKb = Math.max(peakRssKb, sample.peakRssKb);
          }
          console.error(
            `[bench]   ${clipName} run ${run + 1}/${opts.runs}: ` +
              `${sample.sttMs} ms (RTF ${(sample.sttMs / audioDurationMs).toFixed(2)})`,
          );
        }
        const reference = references[clipName];
        if (reference) {
          wers.push(wordErrorRate(reference, runs[runs.length - 1].transcript));
        }
        clipResults.push({ clip: clipName, audioDurationMs, runs });
      }

      results.push({
        config,
        clips: clipResults,
        p50SttMs: percentile(sttSamples, 50),
        p95SttMs: percentile(sttSamples, 95),
        p50Rtf: percentile(rtfSamples, 50),
        p95Rtf: percentile(rtfSamples, 95),
        peakRssMb: peakRssKb ? Math.round(peakRssKb / 1024) : null,
        wer: wers.length
          ? Math.round((wers.reduce((sum, value) => sum + value, 0) / wers.length) * 1000) /
            1000
          : null,
      });
    }
  } finally {
    if (!process.env.BENCH_KEEP_WAV) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      cpus: os.cpus().length,
      cgroupCpuMax: cgroupCpuMax(),
      cpuModel: cpuModel(),
      bin: opts.bin,
      whisperVersion: await binaryVersion(opts.bin, ["--version"]),
      ffmpegVersion: await binaryVersion(opts.ffmpeg, ["-version"]),
      language: opts.language,
      trim: opts.trim,
      runs: opts.runs,
      clips: clips.map((clip) => path.basename(clip)),
    },
    configs: results,
  };

  const header = [
    "config".padEnd(36),
    "p50 ms".padStart(9),
    "p95 ms".padStart(9),
    "p50 RTF".padStart(9),
    "p95 RTF".padStart(9),
    "peak RSS".padStart(9),
    "WER".padStart(6),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const result of results) {
    console.log(
      [
        result.config.id.padEnd(36),
        String(result.p50SttMs ?? "-").padStart(9),
        String(result.p95SttMs ?? "-").padStart(9),
        String(result.p50Rtf ?? "-").padStart(9),
        String(result.p95Rtf ?? "-").padStart(9),
        `${result.peakRssMb ?? "-"} MB`.padStart(9),
        String(result.wer ?? "-").padStart(6),
      ].join(" "),
    );
  }

  const json = JSON.stringify(report, null, 2);
  if (opts.out) {
    fs.writeFileSync(opts.out, json);
    console.log(`\nReport written to ${opts.out}`);
  } else {
    console.log(json);
  }

  if (opts.cleanupModels) {
    for (const file of downloadedModels) {
      try {
        fs.unlinkSync(file);
        console.error(`[bench] removed ${file}`);
      } catch {
        // Best effort
      }
    }
  }
}

main().catch((error) => {
  console.error(`[bench] ${error?.message || error}`);
  process.exit(1);
});
