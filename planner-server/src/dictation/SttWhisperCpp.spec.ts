import { EventEmitter } from "events";
import axios from "axios";
import * as childProcess from "child_process";
import * as fs from "fs-extra";
import * as path from "path";

jest.mock("axios");
jest.mock("fs-extra");
jest.mock("child_process");

const mockAxios = axios as jest.Mocked<typeof axios>;
const mockSpawn = (childProcess as any).spawn as jest.Mock;
const mockPathExists = (fs as any).pathExists as jest.Mock;
const mockEnsureDir = (fs as any).ensureDir as jest.Mock;
const mockCreateWriteStream = (fs as any).createWriteStream as jest.Mock;
const mockRename = (fs as any).rename as jest.Mock;
const mockRemove = (fs as any).remove as jest.Mock;

import { SttWhisperCppTranscribe } from "./SttWhisperCpp";
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

describe("SttWhisperCpp embedded STT engine", () => {
  let config: Config;
  let ffmpegScript: SpawnScript;
  let whisperScript: SpawnScript;

  beforeEach(() => {
    config = new Config();
    config.STT_MODE = "embedded";
    config.STT_EMBEDDED_MODEL = "ggml-base";
    config.DATA_DIR = "/data-test";
    config.TMP_DIR = "/tmp-test";

    mockPathExists.mockResolvedValue(true);
    mockEnsureDir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);

    ffmpegScript = { code: 0 };
    whisperScript = { code: 0, stdout: "hello world" };
    mockSpawn.mockImplementation((command: string) => {
      const script = command === "ffmpeg" ? ffmpegScript : whisperScript;
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
      "/tmp-test/dictation/a1.audio",
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
    await expect(promise).resolves.toBe("hello world");
  });

  it("should not re-download the model when it already exists", async () => {
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp-test/dictation/a2.audio",
        "audio/webm",
        "en",
      ),
    ).resolves.toBe("hello world");
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it("should reject an invalid model name", async () => {
    config.STT_EMBEDDED_MODEL = "../evil";
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp-test/dictation/a3.audio",
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
        "/tmp-test/dictation/a4.audio",
        "audio/webm",
        "en",
      ),
    ).resolves.toBe("hello world");

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const [command, args] = mockSpawn.mock.calls[0];
    expect(command).toBe("ffmpeg");
    expect(args).toEqual(
      expect.arrayContaining(["-ar", "16000", "-ac", "1", "-f", "wav"]),
    );
    const wavPath = args[args.length - 1];
    expect(wavPath).toMatch(/^\/tmp-test\/dictation\/.+\.wav$/);
    expect(mockRemove).toHaveBeenCalledWith(wavPath);
  });

  it("should reject when the ffmpeg decode fails", async () => {
    ffmpegScript = { code: 1, stderr: "invalid audio data" };
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp-test/dictation/a5.audio",
        "audio/webm",
        "en",
      ),
    ).rejects.toThrow("ffmpeg failed with exit code 1: invalid audio data");
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("should run whisper-cli with the expected arguments", async () => {
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp-test/dictation/a6.audio",
        "audio/webm",
        "en",
      ),
    ).resolves.toBe("hello world");

    const [command, args] = mockSpawn.mock.calls[1];
    expect(command).toBe(
      path.join(__dirname, "..", "..", "bin", "whisper-cli"),
    );
    expect(args).toEqual([
      "-m",
      "/data-test/stt-models/ggml-base.bin",
      "-f",
      expect.stringMatching(/^\/tmp-test\/dictation\/.+\.wav$/),
      "-l",
      "en",
      "-t",
      expect.any(String),
      "-np",
      "-nt",
    ]);
  });

  it("should detect the language when none is given", async () => {
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp-test/dictation/a7.audio",
        "audio/webm",
        null,
      ),
    ).resolves.toBe("hello world");
    const [, args] = mockSpawn.mock.calls[1];
    expect(args).toEqual(expect.arrayContaining(["-l", "auto"]));
  });

  it("should use the configured binary path when set", async () => {
    config.STT_EMBEDDED_BIN_PATH = "/opt/custom/whisper-cli";
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp-test/dictation/a8.audio",
        "audio/webm",
        "en",
      ),
    ).resolves.toBe("hello world");
    const [command] = mockSpawn.mock.calls[1];
    expect(command).toBe("/opt/custom/whisper-cli");
  });

  it("should join the multi-line whisper output into one transcript", async () => {
    whisperScript = { code: 0, stdout: "  first line \n\n  second line \n" };
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp-test/dictation/a9.audio",
        "audio/webm",
        "en",
      ),
    ).resolves.toBe("first line second line");
  });

  it("should reject an empty transcript", async () => {
    whisperScript = { code: 0, stdout: "  \n \n" };
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp-test/dictation/a10.audio",
        "audio/webm",
        "en",
      ),
    ).rejects.toThrow("STT returned an empty transcript");
  });

  it("should reject when whisper-cli fails", async () => {
    whisperScript = { code: 1, stderr: "whisper_model_load failed" };
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp-test/dictation/a11.audio",
        "audio/webm",
        "en",
      ),
    ).rejects.toThrow(
      "whisper-cli failed with exit code 1: whisper_model_load failed",
    );
  });

  it("should reject when the whisper binary is missing", async () => {
    whisperScript = {
      error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
    };
    await expect(
      SttWhisperCppTranscribe(
        config,
        "/tmp-test/dictation/a12.audio",
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
      "/tmp-test/dictation/b1.audio",
      "audio/webm",
      "en",
    );
    await flush();
    const second = SttWhisperCppTranscribe(
      config,
      "/tmp-test/dictation/b2.audio",
      "audio/webm",
      "en",
    );
    await flush();

    // The first transcription is still running: nothing was spawned for the
    // second one yet
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    gate.resolve(undefined);
    expect(await Promise.all([first, second])).toEqual(["hi", "hi"]);
    expect(mockSpawn).toHaveBeenCalledTimes(4);
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });
});
