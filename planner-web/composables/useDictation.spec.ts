// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictation } from "./useDictation";

class FakeMediaStreamTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn((_type: string) => true);
  static reset() {
    FakeMediaRecorder.instances = [];
  }

  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: MediaStream;
  mimeType: string;

  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType || "";
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
    // Simulate one chunk arriving while recording
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
  }

  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.onstop?.();
  }
}

function stubMedia(ok = true) {
  const track = new FakeMediaStreamTrack();
  const stream = {
    getTracks: () => [track],
  } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => {
    if (!ok) {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    }
    return stream;
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  return { getUserMedia, stream, track };
}

describe("useDictation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    FakeMediaRecorder.isTypeSupported.mockImplementation(
      (type: string) => type === "audio/webm;codecs=opus",
    );
    FakeMediaRecorder.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("should report an unsupported browser", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const dictation = useDictation();
    const started = await dictation.start();
    expect(started).toBe(false);
    expect(dictation.error.value).toContain("not supported");
  });

  it("should report a denied microphone permission clearly", async () => {
    stubMedia(false);
    const dictation = useDictation();
    const started = await dictation.start();
    expect(started).toBe(false);
    expect(dictation.error.value).toContain("Microphone access was denied");
  });

  it("should start recording, pick a mimeType and stop with the audio", async () => {
    const { track } = stubMedia();
    const dictation = useDictation();
    const started = await dictation.start();
    expect(started).toBe(true);
    expect(dictation.isRecording.value).toBe(true);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0]?.mimeType).toBe(
      "audio/webm;codecs=opus",
    );

    await vi.advanceTimersByTimeAsync(3000);
    expect(dictation.elapsedSeconds.value).toBe(3);

    const recording = await dictation.stop();
    expect(recording).not.toBeNull();
    expect(recording?.mimeType).toBe("audio/webm;codecs=opus");
    expect(recording?.blob).toBeInstanceOf(Blob);
    expect(dictation.isRecording.value).toBe(false);
    expect(track.stopped).toBe(true);
  });

  it("should auto-stop at the maximum duration", async () => {
    stubMedia();
    const onAutoStop = vi.fn();
    const dictation = useDictation({ maxDurationSeconds: 5, onAutoStop });
    await dictation.start();

    await vi.advanceTimersByTimeAsync(5000);

    expect(onAutoStop).toHaveBeenCalled();
    expect(dictation.isRecording.value).toBe(false);
    expect(dictation.elapsedSeconds.value).toBe(5);
  });

  it("should discard the audio on cancel", async () => {
    const { track } = stubMedia();
    const dictation = useDictation();
    await dictation.start();

    dictation.cancel();

    expect(dictation.isRecording.value).toBe(false);
    expect(track.stopped).toBe(true);
    expect(await dictation.stop()).toBeNull();
  });

  it("should not start twice in a row", async () => {
    const { getUserMedia } = stubMedia();
    const dictation = useDictation();
    expect(await dictation.start()).toBe(true);
    expect(await dictation.start()).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await dictation.stop();
  });
});
