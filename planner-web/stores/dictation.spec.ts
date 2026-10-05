// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import api from "../utils/api";
import { useDictationStore } from "./dictation";

// vi.mock is hoisted above the imports by vitest
vi.mock("../utils/api", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

const mockApiPost = api.post as unknown as ReturnType<typeof vi.fn>;
const mockApiGet = api.get as unknown as ReturnType<typeof vi.fn>;

describe("dictation store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("should upload the audio as multipart and store the jobId", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-1" } });
    const store = useDictationStore();

    const blob = new Blob(["audio"], { type: "audio/webm" });
    await store.submitAudio(blob, "audio/webm");

    expect(store.jobId).toBe("job-1");
    expect(store.status).toBe("processing");
    expect(store.error).toBeNull();
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    const [url, form] = mockApiPost.mock.calls[0]!;
    expect(url).toBe("/dictation");
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("language")).toBe("auto");
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("dictation.webm");
  });

  it("should send the configured language with the upload", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-1" } });
    const store = useDictationStore();
    store.setLanguage("fr");
    expect(localStorage.getItem("dictation-language")).toBe("fr");

    await store.submitAudio(new Blob(["audio"]), "audio/webm");
    expect(mockApiPost.mock.calls[0]![1].get("language")).toBe("fr");
  });

  it("should resume polling when a job is already in flight (409)", async () => {
    mockApiPost.mockRejectedValue({
      response: { status: 409, data: { jobId: "job-running" } },
    });
    const store = useDictationStore();

    await store.submitAudio(new Blob(["audio"]), "audio/webm");

    expect(store.jobId).toBe("job-running");
    expect(store.status).toBe("processing");
    expect(store.error).toBeNull();
  });

  it("should surface an upload failure as an error state", async () => {
    mockApiPost.mockRejectedValue({
      response: { status: 400, data: { error: "Invalid: an audio file is expected" } },
    });
    const store = useDictationStore();

    await store.submitAudio(new Blob(["audio"]), "audio/webm");

    expect(store.jobId).toBeNull();
    expect(store.status).toBe("error");
    expect(store.error).toBe("Invalid: an audio file is expected");
  });

  it("should poll the job and update stage and result", async () => {
    mockApiGet.mockResolvedValue({
      data: {
        jobId: "job-1",
        status: "processing",
        stage: "transcribing",
        result: null,
        error: null,
      },
    });
    const store = useDictationStore();
    store.resumeFrom("job-1");

    await store.poll();
    expect(store.status).toBe("processing");
    expect(store.stage).toBe("transcribing");
    expect(mockApiGet).toHaveBeenCalledWith("/dictation/job-1");

    mockApiGet.mockResolvedValue({
      data: {
        jobId: "job-1",
        status: "done",
        stage: null,
        result: {
          rawTranscript: "hello",
          polishedText: "Hello!",
          polished: true,
          actions: [],
          actionsAvailable: true,
        },
        error: null,
      },
    });
    await store.poll();
    expect(store.status).toBe("done");
    expect(store.result?.polishedText).toBe("Hello!");
    expect(store.isProcessing).toBe(false);
  });

  it("should stop with an error when the job expired (404)", async () => {
    mockApiGet.mockRejectedValue({ response: { status: 404 } });
    const store = useDictationStore();
    store.resumeFrom("job-gone");

    await store.poll();
    expect(store.status).toBe("error");
    expect(store.error).toContain("expired");
  });

  it("should keep polling through transient errors", async () => {
    mockApiGet.mockRejectedValue(new Error("Network Error"));
    const store = useDictationStore();
    store.resumeFrom("job-1");

    await store.poll();
    expect(store.status).toBe("processing");
    expect(store.error).toBeNull();
  });

  it("should not poll without a job", async () => {
    const store = useDictationStore();
    await store.poll();
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it("should clear the state on reset", () => {
    const store = useDictationStore();
    store.resumeFrom("job-1");
    store.result = {
      rawTranscript: "t",
      polishedText: "t",
      polished: true,
      actions: [],
      actionsAvailable: true,
    };

    store.reset();
    expect(store.jobId).toBeNull();
    expect(store.result).toBeNull();
    expect(store.isProcessing).toBe(false);
  });
});
