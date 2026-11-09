// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import CommentComposer from "./CommentComposer.vue";
import InlineDictationButton from "./InlineDictationButton.vue";
import { useDictationStore } from "../stores/dictation";
import { useRecommendationStore } from "../stores/recommendation";
import { useTasksStore } from "../stores/tasks";

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

function appConfig(overrides: Record<string, unknown> = {}) {
  return {
    llmRecommendationEnabled: false,
    llmImproveEnabled: false,
    dictationEnabled: true,
    dictationSttConfigured: true,
    dictation: {
      maxDurationSeconds: 120,
      maxUploadMb: 10,
      defaultLanguage: "auto",
      languages: ["auto", "fr"],
      estimatedRtf: 0.5,
      engine: "embedded",
      engineState: "ready",
      model: "",
      inlineJobs: true,
      ...overrides,
    },
  };
}

function jobView(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    source: "inline",
    status: "done",
    stage: null,
    engine: "embedded",
    language: "auto",
    revision: 3,
    result: {
      rawTranscript: "hello there",
      polishedText: "Hello there.",
      polished: true,
      actions: [],
      actionsAvailable: true,
    },
    availability: {
      rawTranscript: true,
      polishedText: true,
      actions: true,
    },
    timings: null,
    engineState: "ready",
    error: null,
    dateCreated: "2026-11-07T10:00:00.000Z",
    dateUpdated: "2026-11-07T10:00:00.000Z",
    ...overrides,
  };
}

let recommendationStore: ReturnType<typeof useRecommendationStore>;
let dictationStore: ReturnType<typeof useDictationStore>;
let tasksStore: ReturnType<typeof useTasksStore>;

function mountComposer(props: Record<string, unknown> = {}) {
  return mount(CommentComposer, {
    props: { modelValue: "", ...props },
    attachTo: document.body,
    global: {
      // Nuxt auto-imports the shared control; its own spec covers it
      stubs: { InlineDictationButton: true },
    },
  });
}

// The single microphone is the shared inline control: mount it for real so
// the composer's recording integration (transcript + optional audio) runs.
function mountComposerWithMic(props: Record<string, unknown> = {}) {
  return mount(CommentComposer, {
    props: { modelValue: "", ...props },
    attachTo: document.body,
    global: { components: { InlineDictationButton } },
  });
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  recommendationStore = useRecommendationStore();
  recommendationStore.config = appConfig() as never;
  dictationStore = useDictationStore();
  tasksStore = useTasksStore();
  vi.spyOn(dictationStore, "uploadJob").mockResolvedValue({ jobId: "job-1" });
  vi.spyOn(dictationStore, "fetchJob").mockResolvedValue({
    job: jobView() as never,
  });
  vi.spyOn(dictationStore, "openDialog").mockImplementation(() => undefined);
  vi.spyOn(dictationStore, "openJob").mockResolvedValue(undefined);
  vi.spyOn(tasksStore, "uploadAttachment").mockResolvedValue(undefined as never);
  vi.stubGlobal("useRecommendationStore", () => recommendationStore);
  vi.stubGlobal("useDictationStore", () => dictationStore);
  vi.stubGlobal("useTasksStore", () => tasksStore);
});

async function startRecording(wrapper: ReturnType<typeof mountComposer>) {
  await wrapper.find(".inline-dictation-btn").trigger("click");
  await flushPromises();
}

async function stopRecording(wrapper: ReturnType<typeof mountComposer>) {
  await wrapper
    .find('.inline-dictation-action[aria-label="Stop recording"]')
    .trigger("click");
  await flushPromises();
  await flushPromises();
}

function audioUploadCalls() {
  return (
    tasksStore.uploadAttachment as unknown as {
      mock: { calls: unknown[][] };
    }
  ).mock.calls;
}

function dictationUploadCalls() {
  return (
    dictationStore.uploadJob as unknown as {
      mock: { calls: unknown[][] };
    }
  ).mock.calls;
}

describe("CommentComposer voice dictation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    FakeMediaRecorder.isTypeSupported.mockImplementation(
      (type: string) => type === "audio/webm;codecs=opus",
    );
    FakeMediaRecorder.reset();
    stubMedia(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it("should show a single microphone and the attach-audio option", () => {
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });
    expect(wrapper.findAll(".inline-dictation-btn")).toHaveLength(1);
    expect(wrapper.find(".composer-attach-audio").exists()).toBe(true);
    expect(
      (wrapper.find(".composer-attach-audio input").element as HTMLInputElement)
        .checked,
    ).toBe(false);
    wrapper.unmount();
  });

  it("should hide the microphone and the option by default (allowVoice=false)", () => {
    const wrapper = mountComposerWithMic({ taskId: "t1" });
    expect(wrapper.find(".inline-dictation-btn").exists()).toBe(false);
    expect(wrapper.find(".composer-attach-audio").exists()).toBe(false);
    wrapper.unmount();
  });

  it("should hide the microphone and the option without a task", () => {
    const wrapper = mountComposerWithMic({ allowVoice: true });
    expect(wrapper.find(".inline-dictation-btn").exists()).toBe(false);
    expect(wrapper.find(".composer-attach-audio").exists()).toBe(false);
    wrapper.unmount();
  });

  it("should hide the microphone and the option when the server has no inline jobs", () => {
    recommendationStore.config = appConfig({ inlineJobs: false }) as never;
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });
    expect(wrapper.find(".inline-dictation-btn").exists()).toBe(false);
    expect(wrapper.find(".composer-attach-audio").exists()).toBe(false);
    wrapper.unmount();
  });

  it("should hide the microphone and the option when the browser cannot record", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });
    expect(wrapper.find(".inline-dictation-btn").exists()).toBe(false);
    expect(wrapper.find(".composer-attach-audio").exists()).toBe(false);
    wrapper.unmount();
  });

  it("should hide the microphone and the option while the composer is busy", () => {
    const wrapper = mountComposerWithMic({
      allowVoice: true,
      taskId: "t1",
      busy: true,
    });
    expect(wrapper.find(".inline-dictation-btn").exists()).toBe(false);
    expect(wrapper.find(".composer-attach-audio").exists()).toBe(false);
    wrapper.unmount();
  });

  it("should show the recording state with elapsed time", async () => {
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });

    await startRecording(wrapper);
    expect(wrapper.find(".inline-dictation-status").exists()).toBe(true);
    expect(wrapper.find(".inline-dictation-btn").attributes("aria-pressed")).toBe(
      "true",
    );

    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.find(".inline-dictation-timer").text()).toBe("00:02");
    wrapper.unmount();
  });

  it("should transcribe without attaching the audio by default", async () => {
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });

    await startRecording(wrapper);
    await stopRecording(wrapper);

    expect(tasksStore.uploadAttachment).not.toHaveBeenCalled();
    expect(dictationStore.uploadJob).toHaveBeenCalledTimes(1);
    const [, mimeType, language, source] = dictationUploadCalls()[0]!;
    expect(mimeType).toBe("audio/webm;codecs=opus");
    expect(language).toBe("auto");
    expect(source).toBe("inline");

    // The (polished) transcript lands in the textarea and is editable
    const textarea = wrapper.find("textarea").element as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello there.");
    const emitted = wrapper.emitted("update:modelValue")!;
    expect(emitted[emitted.length - 1]![0]).toBe("Hello there.");

    // One comment only: a single submit for the whole voice message
    await wrapper.find("textarea").trigger("keydown", {
      key: "Enter",
      ctrlKey: true,
    });
    expect(wrapper.emitted("submit")).toHaveLength(1);
    wrapper.unmount();
  });

  it("should attach the audio when the option is enabled", async () => {
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });
    await wrapper.find(".composer-attach-audio input").setValue(true);

    await startRecording(wrapper);
    await stopRecording(wrapper);

    expect(tasksStore.uploadAttachment).toHaveBeenCalledTimes(1);
    const [taskId, file] = audioUploadCalls()[0]!;
    expect(taskId).toBe("t1");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toMatch(
      /^voice-message-\d{8}-\d{6}\.webm$/,
    );
    expect(dictationStore.uploadJob).toHaveBeenCalledTimes(1);
    expect(
      (wrapper.find("textarea").element as HTMLTextAreaElement).value,
    ).toBe("Hello there.");
    wrapper.unmount();
  });

  it("should send the transcript edits in the single comment", async () => {
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });

    await startRecording(wrapper);
    await stopRecording(wrapper);

    const textarea = wrapper.find("textarea");
    await textarea.setValue("Hello there. Edited.");
    await textarea.trigger("keydown", { key: "Enter", ctrlKey: true });

    expect(wrapper.emitted("submit")).toHaveLength(1);
    expect(wrapper.emitted("update:modelValue")!.pop()![0]).toBe(
      "Hello there. Edited.",
    );
    wrapper.unmount();
  });

  it("should keep the transcript when the audio upload fails", async () => {
    (tasksStore.uploadAttachment as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: { error: "Attachment too large" } },
    });
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });
    await wrapper.find(".composer-attach-audio input").setValue(true);

    await startRecording(wrapper);
    await stopRecording(wrapper);

    const error = wrapper.find(".composer-voice-error");
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("Attachment too large");
    expect(
      (wrapper.find("textarea").element as HTMLTextAreaElement).value,
    ).toBe("Hello there.");
    wrapper.unmount();
  });

  it("should show a dictation failure inline", async () => {
    (dictationStore.uploadJob as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: "The dictation engine is unavailable.",
    });
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });

    await startRecording(wrapper);
    await stopRecording(wrapper);

    const error = wrapper.find(".inline-dictation-error");
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("The dictation engine is unavailable.");
    wrapper.unmount();
  });

  it("should not upload anything on cancel", async () => {
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });
    await wrapper.find(".composer-attach-audio input").setValue(true);

    await startRecording(wrapper);
    await wrapper
      .find('.inline-dictation-action[aria-label="Cancel recording"]')
      .trigger("click");
    await flushPromises();

    expect(tasksStore.uploadAttachment).not.toHaveBeenCalled();
    expect(dictationStore.uploadJob).not.toHaveBeenCalled();
    expect(wrapper.find(".inline-dictation-status").exists()).toBe(false);
    wrapper.unmount();
  });

  it("should record with the dictation language from preferences", async () => {
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });
    dictationStore.setLanguage("fr");

    await startRecording(wrapper);
    await stopRecording(wrapper);

    expect(dictationUploadCalls()[0]![2]).toBe("fr");
    wrapper.unmount();
  });

  it("should upload the voice message once when the max duration auto-stops it", async () => {
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });
    await wrapper.find(".composer-attach-audio input").setValue(true);

    await startRecording(wrapper);
    await vi.advanceTimersByTimeAsync(120000);
    await flushPromises();
    await flushPromises();

    expect(tasksStore.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(dictationStore.uploadJob).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".inline-dictation-status").exists()).toBe(false);
    wrapper.unmount();
  });

  it("should show a permission error inline and recover", async () => {
    stubMedia(false);
    const wrapper = mountComposerWithMic({ allowVoice: true, taskId: "t1" });

    await startRecording(wrapper);

    const error = wrapper.find(".inline-dictation-error");
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("Microphone access was denied");

    // A later successful start clears the error
    stubMedia(true);
    await startRecording(wrapper);
    expect(wrapper.find(".inline-dictation-error").exists()).toBe(false);
    await wrapper
      .find('.inline-dictation-action[aria-label="Cancel recording"]')
      .trigger("click");
    wrapper.unmount();
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
    wrapper.unmount();
  });

  it("should switch to preview without losing the text", async () => {
    const wrapper = mountComposer({ modelValue: "**bold**" });
    const previewTab = wrapper
      .findAll(".composer-tab")
      .find((tab) => tab.text() === "Preview");
    await previewTab!.trigger("click");
    expect(wrapper.find(".composer-preview").html()).toContain("<strong>");
    // The textarea is kept mounted (v-show) so the draft survives the toggle
    expect(wrapper.find("textarea").isVisible()).toBe(false);
    wrapper.unmount();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
});
