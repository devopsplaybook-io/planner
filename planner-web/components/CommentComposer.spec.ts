// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import CommentComposer from "./CommentComposer.vue";

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

function mountComposer(props: Record<string, unknown> = {}) {
  return mount(CommentComposer, {
    props: { modelValue: "", ...props },
  });
}

describe("CommentComposer voice recording", () => {
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
    localStorage.clear();
  });

  it("should hide the voice button by default (allowVoice=false)", () => {
    const wrapper = mountComposer();
    expect(wrapper.find(".composer-voice-btn").exists()).toBe(false);
  });

  it("should hide the voice button when the browser cannot record", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const wrapper = mountComposer({ allowVoice: true });
    expect(wrapper.find(".composer-voice-btn").exists()).toBe(false);
  });

  it("should hide the voice button while the composer is busy", () => {
    const wrapper = mountComposer({ allowVoice: true, busy: true });
    expect(wrapper.find(".composer-voice-btn").exists()).toBe(false);
  });

  it("should show the voice button and the recording state with elapsed time", async () => {
    stubMedia();
    const wrapper = mountComposer({ allowVoice: true });
    expect(wrapper.find(".composer-voice-btn").exists()).toBe(true);

    await wrapper.find(".composer-voice-btn").trigger("click");
    expect(wrapper.find(".composer-voice-status").exists()).toBe(true);
    expect(wrapper.find(".composer-voice-btn").attributes("aria-pressed")).toBe(
      "true",
    );

    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.find(".composer-voice-timer").text()).toBe("00:02");
  });

  it("should emit voice with the recording on stop", async () => {
    stubMedia();
    const wrapper = mountComposer({ allowVoice: true });

    await wrapper.find(".composer-voice-btn").trigger("click");
    await wrapper
      .find('.composer-voice-status button[aria-label="Stop recording"]')
      .trigger("click");
    await flushPromises();

    const emitted = wrapper.emitted("voice");
    expect(emitted).toHaveLength(1);
    const result = emitted![0]![0] as { blob: Blob; mimeType: string };
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.mimeType).toBe("audio/webm;codecs=opus");
    // Recording state cleared after stop
    expect(wrapper.find(".composer-voice-status").exists()).toBe(false);
  });

  it("should not emit voice on cancel", async () => {
    stubMedia();
    const wrapper = mountComposer({ allowVoice: true });

    await wrapper.find(".composer-voice-btn").trigger("click");
    await wrapper
      .find('.composer-voice-status button[aria-label="Cancel recording"]')
      .trigger("click");

    expect(wrapper.emitted("voice")).toBeUndefined();
    expect(wrapper.find(".composer-voice-status").exists()).toBe(false);
  });

  it("should show a permission error inline and recover", async () => {
    stubMedia(false);
    const wrapper = mountComposer({ allowVoice: true });

    await wrapper.find(".composer-voice-btn").trigger("click");
    await flushPromises();

    const error = wrapper.find(".composer-voice-error");
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("Microphone access was denied");
    // A later successful start clears the error
    stubMedia(true);
    await wrapper.find(".composer-voice-btn").trigger("click");
    expect(wrapper.find(".composer-voice-error").exists()).toBe(false);
    await wrapper
      .find('.composer-voice-status button[aria-label="Cancel recording"]')
      .trigger("click");
  });
});

describe("CommentComposer write/preview", () => {
  it("should keep emitting the model value and submit events", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.find("textarea");
    await textarea.setValue("hello");
    expect(wrapper.emitted("update:modelValue")![0]![0]).toBe("hello");
    await textarea.trigger("keydown", { key: "Enter", ctrlKey: true });
    expect(wrapper.emitted("submit")).toHaveLength(1);
  });
});
