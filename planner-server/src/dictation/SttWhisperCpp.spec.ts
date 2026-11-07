import { EventEmitter } from "events";
import axios from "axios";
import * as childProcess from "child_process";
import * as fs from "fs-extra";
import * as path from "path";

jest.mock("axios");
jest.mock("fs-extra");
jest.mock("child_process");

const realFs = jest.requireActual("fs") as typeof import("fs");
const mockAxios = axios as jest.Mocked<typeof axios>;
const mockSpawn = (childProcess as any).spawn as jest.Mock;
const mockPathExists = (fs as any).pathExists as jest.Mock;
const mockEnsureDir = (fs as any).ensureDir as jest.Mock;
const mockCreateWriteStream = (fs as any).createWriteStream as jest.Mock;
const mockRename = (fs as any).rename as jest.Mock;
const mockRemove = (fs as any).remove as jest.Mock;
const mockReadDir = (fs as any).readdir as jest.Mock;

import {
  ParseWavDurationMs,
  SttNoSpeechError,
  SttWhisperCppCleanStalePartFiles,
  SttWhisperCppPrepareModel,
  SttWhisperCppTranscribe,
} from "./SttWhisperCpp";
import { Config } from "../Config";

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** Waits for an asynchronous condition: the pipeline touches the real
 * filesystem between stages, which can take more than a few event-loop
 * ticks on a loaded machine. */
const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 300; i++) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

function fakeChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

interface SpawnScript {
  code?: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

/** Writes a valid 16 kHz mono PCM WAV of the given duration to disk. */
function writeWav(filePath: string, durationMs: number): void {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = Math.round(
    (sampleRate * channels * (bitsPerSample / 8) * durationMs) / 1000,
  );
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  realFs.mkdirSync(path.dirname(filePath), { recursive: true });
  realFs.writeFileSync(filePath, buffer);
}

describe("SttWhisperCpp embedded STT engine", () => {
  let config: Config;
  let ffmpegScript: SpawnScript;
  let whisperScript: SpawnScript;
  let whisperJson: unknown;
  let wavDurationMs: number | null;

  beforeEach(() => {
    config = new Config();
    config.STT_MODE = "embedded";
    config.STT_EMBEDDED_MODEL = "ggml-base";
    config.DATA_DIR = "/data-test";
    config.TMP_DIR = "/tmp/stt-test";

    mockPathExists.mockResolvedValue(true);
    mockEnsureDir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
    mockReadDir.mockResolvedValue([]);

    ffmpegScript = { code: 0 };
    whisperScript = { code: 0, stdout: "hello world" };
    whisperJson = null;
    wavDurationMs = null;
    mockSpawn.mockImplementation((command: string, args: string[]) => {
      const isFfmpeg = command === "ffmpeg";
      const script = isFfmpeg ? ffmpegScript : whisperScript;
      const child = fakeChild();
      setImmediate(() => {
        if (script.error) {
          child.emit("error", script.error);
          return;
        }
        if (script.stdout) {
          child.stdout.emit("data", script.stdout);
        }
        if (script.stderr) {
          child.stderr.emit("data", script.stderr);
        }
        if (isFfmpeg && wavDurationMs !== null) {
          writeWav(args[args.length - 1], wavDurationMs);
        }
        if (!isFfmpeg && whisperJson !== null) {
          const jsonBase = args[args.indexOf("-of") + 1];
          realFs.mkdirSync(path.dirname(jsonBase), { recursive: true });
          realFs.writeFileSync(
            `${jsonBase}.json`,
            typeof whisperJson === "string"
              ? whisperJson
              : JSON.stringify(whisperJson),
          );
        }
        child.emit("close", script.code ?? 0);
      });
      return child;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("should download the model on first use and store it in DATA_DIR", async () => {
    mockPathExists.mockResolvedValue(false);
    const source = new EventEmitter() as any;
    source.pipe = jest.fn();
    mockAxios.get.mockResolvedValue({ data: source } as never);
    const writer = new EventEmitter();
    mockCreateWriteStream.mockReturnValue(writer);

    const promise = SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/a1.audio",
      "audio/webm",
      "en",
    );
    await flush();
    expect(mockAxios.get).toHaveBeenCalledWith(
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
      expect.objectContaining({ responseType: "stream" }),
    );
    expect(source.pipe).toHaveBeenCalledWith(writer);

    writer.emit("finish");
    await flush();
    expect(mockRename).toHaveBeenCalledWith(
      "/data-test/stt-models/ggml-base.bin.part",
      "/data-test/stt-models/ggml-base.bin",
    );
    await expect(promise).resolves.toMatchObject({
      text: "hello world",
      audioDurationMs: null,
      threads: expect.any(Number),
    });
  });

  it("should not re-download the model when it already exists", async () => {
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a2.audio",
        "audio/webm",
        "en",
      ),
    ).resolves.toMatchObject({ text: "hello world" });
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it("should reject an invalid model name", async () => {
    config.STT_EMBEDDED_MODEL = "../evil";
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a3.audio",
        "audio/webm",
        "en",
      ),
    ).rejects.toThrow("Invalid embedded STT model name: ../evil");
    expect(mockAxios.get).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("should decode the upload to a 16 kHz mono WAV with ffmpeg and clean it up", async () => {
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a4.audio",
        "audio/webm",
        "en",
      ),
    ).resolves.toMatchObject({ text: "hello world" });

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const [command, args] = mockSpawn.mock.calls[0];
    expect(command).toBe("ffmpeg");
    expect(args).toEqual(
      expect.arrayContaining(["-ar", "16000", "-ac", "1", "-f", "wav"]),
    );
    const wavPath = args[args.length - 1];
    expect(wavPath).toMatch(/^\/tmp\/stt-test\/dictation\/.+\.wav$/);
    expect(mockRemove).toHaveBeenCalledWith(wavPath);
  });

  it("should trim leading and trailing silence by default", async () => {
    await SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/a4b.audio",
      "audio/webm",
      "en",
    );
    const [, args] = mockSpawn.mock.calls[0];
    const filterIndex = args.indexOf("-af");
    expect(filterIndex).toBeGreaterThan(-1);
    expect(args[filterIndex + 1]).toContain("silenceremove");
    expect(args[filterIndex + 1]).toContain("areverse");
  });

  it("should skip silencing when the trim option is disabled", async () => {
    await SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/a4c.audio",
      "audio/webm",
      "en",
      { trimSilence: false },
    );
    const [, args] = mockSpawn.mock.calls[0];
    expect(args).not.toContain("-af");
  });

  it("should reject when the ffmpeg decode fails without leaking stderr", async () => {
    ffmpegScript = { code: 1, stderr: "invalid audio data" };
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a5.audio",
        "audio/webm",
        "en",
      ),
    ).rejects.toThrow("ffmpeg failed with exit code 1");
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("should run whisper-cli with the expected arguments", async () => {
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a6.audio",
        "audio/webm",
        "en",
      ),
    ).resolves.toMatchObject({ text: "hello world" });

    const [command, args] = mockSpawn.mock.calls[1];
    expect(command).toBe(
      path.join(__dirname, "..", "..", "bin", "whisper-cli"),
    );
    expect(args).toEqual([
      "-m",
      "/data-test/stt-models/ggml-base.bin",
      "-f",
      expect.stringMatching(/^\/tmp\/stt-test\/dictation\/.+\.wav$/),
      "-l",
      "en",
      "-t",
      expect.any(String),
      "-np",
      "-nt",
      "-ojf",
      "-of",
      expect.stringMatching(/^\/tmp\/stt-test\/dictation\/.+$/),
    ]);
  });

  it("should pass the vocabulary prompt to whisper-cli", async () => {
    await SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/a6c.audio",
      "audio/webm",
      "en",
      { prompt: "Vocabulary: Planner, Kubernetes." },
    );
    const [, args] = mockSpawn.mock.calls[1];
    expect(args).toEqual(
      expect.arrayContaining([
        "--prompt",
        "Vocabulary: Planner, Kubernetes.",
      ]),
    );
  });

  it("should omit the prompt flag when no vocabulary is configured", async () => {
    await SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/a6d.audio",
      "audio/webm",
      "en",
    );
    const [, args] = mockSpawn.mock.calls[1];
    expect(args).not.toContain("--prompt");
  });

  it("should parse per-segment confidences from the whisper JSON output", async () => {
    whisperJson = {
      transcription: [
        {
          text: " hello world",
          offsets: { from: 120, to: 1480 },
          tokens: [
            { text: "[_BEG_]", p: 0.99 },
            { text: " hello", p: 0.8 },
            { text: " world", p: 0.6 },
            { text: "   ", p: 0.1 },
          ],
        },
        {
          text: " second part",
          offsets: { from: 1500, to: 2400 },
          tokens: [
            { text: " second", p: 0.4 },
            { text: " part", p: 0.5 },
            { text: "<|endoftext|>", p: 0.9 },
          ],
        },
      ],
    };
    const result = await SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/a6e.audio",
      "audio/webm",
      "en",
    );
    expect(result.text).toBe("hello world");
    expect(result.segments).toHaveLength(2);
    expect(result.segments?.[0]).toMatchObject({
      text: "hello world",
      fromMs: 120,
      toMs: 1480,
    });
    expect(result.segments?.[0].confidence).toBeCloseTo(0.7, 5);
    expect(result.segments?.[1]).toMatchObject({
      text: "second part",
      fromMs: 1500,
      toMs: 2400,
    });
    expect(result.segments?.[1].confidence).toBeCloseTo(0.45, 5);
    // The generated JSON file never outlives the transcription
    expect(mockRemove).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/stt-test\/dictation\/.+\.json$/),
    );
  });

  it("should degrade to null segments when the JSON output is unreadable", async () => {
    whisperJson = "not json";
    const result = await SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/a6f.audio",
      "audio/webm",
      "en",
    );
    expect(result.text).toBe("hello world");
    expect(result.segments).toBeNull();
  });

  it("should pass an explicit thread count through to whisper-cli", async () => {
    await SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/a6b.audio",
      "audio/webm",
      "en",
      { threads: 2 },
    );
    const [, args] = mockSpawn.mock.calls[1];
    expect(args[args.indexOf("-t") + 1]).toBe("2");
  });

  it("should detect the language when none is given", async () => {
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a7.audio",
        "audio/webm",
        null,
      ),
    ).resolves.toMatchObject({ text: "hello world" });
    const [, args] = mockSpawn.mock.calls[1];
    expect(args).toEqual(expect.arrayContaining(["-l", "auto"]));
  });

  it("should use the configured binary path when set", async () => {
    config.STT_EMBEDDED_BIN_PATH = "/opt/custom/whisper-cli";
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a8.audio",
        "audio/webm",
        "en",
      ),
    ).resolves.toMatchObject({ text: "hello world" });
    const [command] = mockSpawn.mock.calls[1];
    expect(command).toBe("/opt/custom/whisper-cli");
  });

  it("should join the multi-line whisper output into one transcript", async () => {
    whisperScript = { code: 0, stdout: "  first line \n\n  second line \n" };
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a9.audio",
        "audio/webm",
        "en",
      ),
    ).resolves.toMatchObject({ text: "first line second line" });
  });

  it("should report the decoded audio duration", async () => {
    wavDurationMs = 4200;
    const result = await SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/a9b.audio",
      "audio/webm",
      "en",
    );
    expect(result.audioDurationMs).toBeGreaterThan(4000);
    expect(result.audioDurationMs).toBeLessThan(4400);
  });

  it("should raise a no-speech error when the trimmed audio is too short", async () => {
    wavDurationMs = 120;
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a9c.audio",
        "audio/webm",
        "en",
      ),
    ).rejects.toBeInstanceOf(SttNoSpeechError);
    // whisper-cli never runs on empty audio
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("should reject an empty transcript", async () => {
    whisperScript = { code: 0, stdout: "  \n \n" };
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a10.audio",
        "audio/webm",
        "en",
      ),
    ).rejects.toThrow("STT returned an empty transcript");
  });

  it("should reject when whisper-cli fails without leaking stderr", async () => {
    whisperScript = { code: 1, stderr: "secret transcript fragment" };
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a11.audio",
        "audio/webm",
        "en",
      ),
    ).rejects.toThrow("whisper-cli failed with exit code 1");
  });

  it("should reject when the whisper binary is missing", async () => {
    whisperScript = {
      error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
    };
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp/stt-test/dictation/a12.audio",
        "audio/webm",
        "en",
      ),
    ).rejects.toThrow("spawn ENOENT");
  });

  it("should serialize concurrent transcriptions", async () => {
    const gate = deferred();
    let whisperSpawnCount = 0;
    mockSpawn.mockImplementation((command: string) => {
      const child = fakeChild();
      if (command === "ffmpeg") {
        setImmediate(() => child.emit("close", 0));
      } else {
        whisperSpawnCount++;
        setImmediate(() => {
          child.stdout.emit("data", "hi\n");
          if (whisperSpawnCount === 1) {
            gate.promise.then(() => child.emit("close", 0));
          } else {
            child.emit("close", 0);
          }
        });
      }
      return child;
    });

    const first = SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/b1.audio",
      "audio/webm",
      "en",
    );
    await flush();
    const second = SttWhisperCppTranscribe(
      config,
      "/tmp/stt-test/dictation/b2.audio",
      "audio/webm",
      "en",
    );
    // The first transcription reaches whisper-cli and stays blocked on the
    // gate: the serialized second one must not spawn anything yet
    await waitFor(() => whisperSpawnCount === 1);
    await flush();

    // The first transcription is still running: nothing was spawned for the
    // second one yet
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    gate.resolve(undefined);
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.text)).toEqual(["hi", "hi"]);
    expect(mockSpawn).toHaveBeenCalledTimes(4);
    // Each run removes its temporary WAV and whisper JSON output
    expect(mockRemove).toHaveBeenCalledTimes(4);
  });
});

describe("SttWhisperCpp model preparation", () => {
  let config: Config;

  beforeEach(() => {
    config = new Config();
    config.STT_MODE = "embedded";
    config.STT_EMBEDDED_MODEL = "ggml-tiny";
    config.DATA_DIR = "/data-test";
    mockPathExists.mockResolvedValue(false);
    mockEnsureDir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
    mockReadDir.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("should retry a failed download and remove the partial file", async () => {
    const writer = new EventEmitter();
    mockCreateWriteStream.mockReturnValue(writer);
    const source = new EventEmitter() as any;
    source.pipe = jest.fn();
    mockAxios.get
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ data: source } as never);

    source.pipe.mockImplementation(() => setImmediate(() => writer.emit("finish")));

    const promise = SttWhisperCppPrepareModel(config, undefined, {
      retryDelayMs: 0,
    });
    await expect(promise).resolves.toBeUndefined();
    expect(mockAxios.get).toHaveBeenCalledTimes(3);
    expect(mockRename).toHaveBeenCalledWith(
      "/data-test/stt-models/ggml-tiny.bin.part",
      "/data-test/stt-models/ggml-tiny.bin",
    );
  });

  it("should give up after three attempts and surface the error", async () => {
    mockAxios.get.mockRejectedValue(new Error("network down"));
    mockCreateWriteStream.mockReturnValue(new EventEmitter());

    await expect(
      SttWhisperCppPrepareModel(config, undefined, { retryDelayMs: 0 }),
    ).rejects.toThrow("network down");
    expect(mockAxios.get).toHaveBeenCalledTimes(3);
  });

  it("should share one download between concurrent preparers", async () => {
    const source = new EventEmitter() as any;
    source.pipe = jest.fn();
    mockAxios.get.mockResolvedValue({ data: source } as never);
    const writer = new EventEmitter();
    mockCreateWriteStream.mockReturnValue(writer);

    source.pipe.mockImplementation(() => setImmediate(() => writer.emit("finish")));

    const first = SttWhisperCppPrepareModel(config, undefined, {
      retryDelayMs: 0,
    });
    const second = SttWhisperCppPrepareModel(config, undefined, {
      retryDelayMs: 0,
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(mockAxios.get).toHaveBeenCalledTimes(1);
  });

  it("should remove stale .part files at startup", async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue(["ggml-base.bin", "ggml-base.bin.part"]);

    await expect(SttWhisperCppCleanStalePartFiles(config)).resolves.toBe(1);
    expect(mockRemove).toHaveBeenCalledWith(
      "/data-test/stt-models/ggml-base.bin.part",
    );
  });
});

describe("ParseWavDurationMs", () => {
  it("should compute the duration of a PCM WAV file", async () => {
    const filePath = path.join(
      require("os").tmpdir(),
      `stt-wav-${process.pid}-${Date.now()}.wav`,
    );
    writeWav(filePath, 2500);
    try {
      const duration = await ParseWavDurationMs(filePath);
      expect(duration).toBeGreaterThan(2400);
      expect(duration).toBeLessThan(2600);
    } finally {
      realFs.rmSync(filePath, { force: true });
    }
  });

  it("should return null for a file that is not a WAV", async () => {
    const filePath = path.join(
      require("os").tmpdir(),
      `stt-wav-bad-${process.pid}-${Date.now()}.wav`,
    );
    realFs.writeFileSync(filePath, "not a wav");
    try {
      await expect(ParseWavDurationMs(filePath)).resolves.toBeNull();
    } finally {
      realFs.rmSync(filePath, { force: true });
    }
  });
});
