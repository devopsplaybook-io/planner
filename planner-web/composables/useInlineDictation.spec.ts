// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useInlineDictation } from "./useInlineDictation";
import type { InlineDictationOptions } from "./useInlineDictation";
import { useDictationStore } from "../stores/dictation";
import type { DictationJobView } from "../stores/dictation";
import { useRecommendationStore } from "../stores/recommendation";

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
  mimeType: string;

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType || "";
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
    this.ondataavailable?.({
      data: new Blob(["audio"], { type: "audio/webm" }),
    });
  }

  stop() {
    if (this.state === "inactive") {
      return;
    }
    this.state = "inactive";
    this.onstop?.();
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function jobView(
  options: {
    status?: "processing" | "done" | "error";
    raw?: string | null;
    polished?: string | null;
    revision?: number;
    error?: string | null;
  } = {},
): DictationJobView {
  const raw = options.raw ?? null;
  const polished = options.polished ?? null;
  const status = options.status ?? "processing";
  return {
    jobId: "job-1",
    source: "inline",
    status,
    stage: status === "processing" ? "transcribing" : null,
    engine: "embedded",
    language: "auto",
    targetLanguage: null,
    revision: options.revision ?? 1,
    result:
      raw === null
        ? null
        : {
            rawTranscript: raw,
            polishedText: polished,
            polished: polished !== null,
            actions: [],
            actionsAvailable: false,
            segments: null,
          },
    availability: {
      rawTranscript: raw !== null,
      polishedText: polished !== null,
      actions: false,
    },
    timings: null,
    engineState: "ready",
    error: options.error ?? null,
    dateCreated: "2026-11-07T10:00:00.000Z",
    dateUpdated: "2026-11-07T10:00:00.000Z",
  };
}

function stubMedia(ok = true) {
  const track = new FakeMediaStreamTrack();
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
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
  return { getUserMedia, track };
}

function makeField(value = ""): HTMLTextAreaElement {
  const field = document.createElement("textarea");
  field.value = value;
  document.body.appendChild(field);
  return field;
}

describe("useInlineDictation", () => {
  let field: HTMLTextAreaElement;
  let recommendationStore: ReturnType<typeof useRecommendationStore>;
  let dictationStore: ReturnType<typeof useDictationStore>;
  let uploadJob: ReturnType<typeof vi.spyOn>;
  let fetchJob: ReturnType<typeof vi.spyOn>;
  let openJob: ReturnType<typeof vi.spyOn>;
  let inline: ReturnType<typeof useInlineDictation>;

  function configure(maxDurationSeconds = 120) {
    recommendationStore.config = {
      llmRecommendationEnabled: false,
      llmImproveEnabled: false,
      dictationEnabled: true,
      dictationSttConfigured: true,
      dictation: {
        maxDurationSeconds,
        maxUploadMb: 10,
        defaultLanguage: "auto",
        languages: ["auto", "en", "fr"],
        estimatedRtf: 0.5,
        engine: "external",
        engineState: "ready",
        model: "",
        inlineJobs: true,
      },
    };
  }

  function createInline(options: Partial<InlineDictationOptions> = {}) {
    return useInlineDictation({ target: () => field, ...options });
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    FakeMediaRecorder.reset();
    FakeMediaRecorder.isTypeSupported.mockImplementation(
      (type: string) => type === "audio/webm;codecs=opus",
    );
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    stubMedia(true);

    recommendationStore = useRecommendationStore();
    configure();
    dictationStore = useDictationStore();

    uploadJob = vi
      .spyOn(dictationStore, "uploadJob")
      .mockResolvedValue({ jobId: "job-1" });
    fetchJob = vi
      .spyOn(dictationStore, "fetchJob")
      .mockResolvedValue({ job: jobView({ status: "done" }) });
    openJob = vi.spyOn(dictationStore, "openJob").mockResolvedValue(undefined);

    field = makeField("");
  });

  afterEach(() => {
    inline?.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("should be available when dictation is enabled and STT is configured", () => {
    inline = createInline();
    expect(inline.isAvailable.value).toBe(true);
    expect(inline.phase.value).toBe("idle");
    expect(inline.languages.value).toEqual(["auto", "en", "fr"]);
  });

  it("should submit the recording with the inline source", async () => {
    inline = createInline();
    await inline.start();
    expect(inline.phase.value).toBe("recording");
    await inline.stop();

    expect(uploadJob).toHaveBeenCalledTimes(1);
    const [, mimeType, language, source] = uploadJob.mock.calls[0]!;
    expect(mimeType).toBe("audio/webm;codecs=opus");
    expect(language).toBe("auto");
    expect(source).toBe("inline");
  });

  it("should insert the raw transcript as soon as STT completes", async () => {
    fetchJob.mockResolvedValue({
      job: jobView({ status: "processing", raw: "hello world" }),
    });
    inline = createInline();
    await inline.start();
    await inline.stop();
    await flush();

    expect(field.value).toBe("hello world");
    expect(inline.phase.value).toBe("done");
    expect(inline.pendingInsert.value).toBeNull();
  });

  it("should replace the raw transcript with the polished one while untouched", async () => {
    fetchJob
      .mockResolvedValueOnce({
        job: jobView({ status: "processing", raw: "hello wrld", revision: 1 }),
      })
      .mockResolvedValueOnce({
        job: jobView({
          status: "done",
          raw: "hello wrld",
          polished: "Hello world.",
          revision: 2,
        }),
      });
    inline = createInline();
    await inline.start();
    await inline.stop();
    await flush();

    expect(field.value).toBe("Hello world.");
    expect(inline.canApplyPolished.value).toBe(false);
  });

  it("should never overwrite an edit and offer the improved text instead", async () => {
    const polishedReady = deferred();
    let calls = 0;
    fetchJob.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return { job: jobView({ status: "processing", raw: "hello wrld" }) };
      }
      await polishedReady.promise;
      return {
        job: jobView({
          status: "done",
          raw: "hello wrld",
          polished: "Hello world.",
        }),
      };
    });
    inline = createInline();
    await inline.start();
    await inline.stop();
    await flush();

    expect(field.value).toBe("hello wrld");
    field.value = "hello wrld and a note";
    polishedReady.resolve();
    await flush();

    expect(field.value).toBe("hello wrld and a note");
    expect(inline.canApplyPolished.value).toBe(true);

    field.setSelectionRange(field.value.length, field.value.length);
    inline.applyPolished();
    expect(field.value).toContain("Hello world.");
    expect(field.value.startsWith("hello wrld and a note")).toBe(true);
    expect(inline.canApplyPolished.value).toBe(false);
  });

  it("should apply the deterministic formatting commands", async () => {
    fetchJob.mockResolvedValue({
      job: jobView({ status: "done", raw: "hello comma world" }),
    });
    inline = createInline();
    await inline.start();
    await inline.stop();
    await flush();

    expect(field.value).toBe("hello, world");
  });

  it("should replace the selection captured at recording start", async () => {
    field.value = "keep old text";
    field.setSelectionRange(5, 8);
    fetchJob.mockResolvedValue({
      job: jobView({ status: "done", raw: "new" }),
    });
    inline = createInline();
    await inline.start();
    await inline.stop();
    await flush();

    expect(field.value).toBe("keep new text");
  });

  it("should append to the existing text when the whole field is selected", async () => {
    field.value = "existing content";
    field.setSelectionRange(0, field.value.length);
    fetchJob.mockResolvedValue({
      job: jobView({ status: "done", raw: "dictated text" }),
    });
    inline = createInline();
    await inline.start();
    await inline.stop();
    await flush();

    expect(field.value).toBe("existing content dictated text");
  });

  it("should defer insertion when the user abandoned the field", async () => {
    fetchJob.mockResolvedValue({
      job: jobView({ status: "done", raw: "hello" }),
    });
    inline = createInline();
    field.focus();
    await inline.start();
    field.dispatchEvent(
      new FocusEvent("focusout", { relatedTarget: document.body }),
    );
    await inline.stop();
    await flush();

    expect(field.value).toBe("");
    expect(inline.pendingInsert.value).toBe("hello");

    inline.insertPending();
    expect(field.value).toBe("hello");
    expect(inline.pendingInsert.value).toBeNull();
  });

  it("should reject recording when dictation is unavailable", async () => {
    recommendationStore.config = {
      ...recommendationStore.config!,
      dictationSttConfigured: false,
    };
    inline = createInline();
    const started = await inline.start();
    expect(started).toBe(false);
    expect(inline.error.value).toContain("not available");
  });

  it("should surface the job expiry (404)", async () => {
    fetchJob.mockResolvedValue({ notFound: true });
    inline = createInline();
    await inline.start();
    await inline.stop();
    await flush();

    expect(inline.error.value).toContain("expired");
    expect(inline.phase.value).toBe("idle");
  });

  it("should adopt the running job on 409 without submitting a second one", async () => {
    uploadJob.mockResolvedValue({ conflictJobId: "job-running" });
    inline = createInline();
    await inline.start();
    await inline.stop();
    await flush();

    expect(inline.conflictJobId.value).toBe("job-running");
    expect(inline.error.value).toContain("already running");
    expect(fetchJob).not.toHaveBeenCalled();
    expect(uploadJob).toHaveBeenCalledTimes(1);
  });

  it("should promote the job to the full dialog without another upload", async () => {
    uploadJob.mockResolvedValue({ conflictJobId: "job-running" });
    inline = createInline();
    await inline.start();
    await inline.stop();
    await flush();
    uploadJob.mockClear();

    await inline.promote();

    expect(openJob).toHaveBeenCalledWith("job-running");
    expect(dictationStore.dialogOpen).toBe(true);
    expect(uploadJob).not.toHaveBeenCalled();
  });

  it("should submit exactly once when the max duration auto-stops", async () => {
    vi.useFakeTimers();
    configure(2);
    inline = createInline();
    await inline.start();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(uploadJob).toHaveBeenCalledTimes(1);
    expect(inline.isRecording.value).toBe(false);
  });

  it("should discard the recording on cancel before submission", async () => {
    inline = createInline();
    await inline.start();
    await inline.cancel();

    expect(uploadJob).not.toHaveBeenCalled();
    expect(inline.phase.value).toBe("idle");
  });

  it("should use and persist the selected language", async () => {
    dictationStore.setLanguage("fr");
    inline = createInline();
    expect(inline.language.value).toBe("fr");
    await inline.start();
    await inline.stop();

    expect(uploadJob.mock.calls[0]![2]).toBe("fr");
    expect(localStorage.getItem("dictation-language")).toBe("fr");
  });

  it("should pass the project scope and translation target to the upload", async () => {
    dictationStore.targetLanguage = "en";
    inline = createInline({ projectId: () => "project-7" });
    await inline.start();
    await inline.stop();

    const call = uploadJob.mock.calls[0]!;
    expect(call[4]).toBe("project-7");
    expect(call[5]).toBe("en");
  });

  it("should keep the audio while the transcript arrives (voice message)", async () => {
    const onKeepAudio = vi.fn(
      async (_recording: { blob: Blob; mimeType: string }) => undefined,
    );
    inline = createInline({ onKeepAudio });
    await inline.start({ keepAudio: true });
    expect(inline.recordingMode.value).toBe("voice-message");
    await inline.stop();
    await flush();

    expect(onKeepAudio).toHaveBeenCalledTimes(1);
    expect(onKeepAudio.mock.calls[0]![0].mimeType).toBe(
      "audio/webm;codecs=opus",
    );
    expect(uploadJob.mock.calls[0]![3]).toBe("inline");
  });

  it("should expose a permission error inline", async () => {
    stubMedia(false);
    inline = createInline();
    const started = await inline.start();

    expect(started).toBe(false);
    expect(inline.error.value).toContain("denied");
    expect(inline.phase.value).toBe("idle");
  });
});
