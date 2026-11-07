// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import api from "../utils/api";
import { useDictationStore, type DictationJobView } from "./dictation";

// vi.mock is hoisted above the imports by vitest
vi.mock("../utils/api", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

const mockApiPost = api.post as unknown as ReturnType<typeof vi.fn>;
const mockApiGet = api.get as unknown as ReturnType<typeof vi.fn>;

function jobView(overrides: Partial<DictationJobView> = {}): DictationJobView {
  return {
    jobId: "job-1",
    source: "dictation",
    status: "processing",
    stage: "transcribing",
    engine: "embedded",
    language: "fr",
    revision: 1,
    result: null,
    availability: {
      rawTranscript: false,
      polishedText: false,
      actions: false,
    },
    timings: {
      queueMs: 0,
      sttMs: null,
      polishMs: null,
      actionsMs: null,
      totalMs: null,
      audioDurationMs: null,
    },
    engineState: "ready",
    error: null,
    dateCreated: "2026-11-07T10:00:00.000Z",
    dateUpdated: "2026-11-07T10:00:00.000Z",
    ...overrides,
  };
}

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
    expect(store.revision).toBe(0);
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

  it("should honor a per-job language override", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-1" } });
    const store = useDictationStore();
    store.setLanguage("fr");

    await store.submitAudio(new Blob(["audio"]), "audio/webm", "de");
    expect(mockApiPost.mock.calls[0]![1].get("language")).toBe("de");
    // The user default is unchanged
    expect(store.language).toBe("fr");
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

  it("should apply a progressive job view (raw first, then polished)", () => {
    const store = useDictationStore();

    store.applyJob(
      jobView({
        revision: 2,
        stage: "polishing",
        result: {
          rawTranscript: "hello",
          polishedText: null,
          polished: false,
          actions: [],
          actionsAvailable: false,
        },
        availability: {
          rawTranscript: true,
          polishedText: false,
          actions: false,
        },
        timings: {
          queueMs: 5,
          sttMs: 4200,
          polishMs: null,
          actionsMs: null,
          totalMs: null,
          audioDurationMs: 9000,
        },
      }),
    );

    expect(store.revision).toBe(2);
    expect(store.stage).toBe("polishing");
    expect(store.hasRawTranscript).toBe(true);
    expect(store.hasPolishedText).toBe(false);
    expect(store.result?.polishedText).toBeNull();
    expect(store.timings?.sttMs).toBe(4200);

    store.applyJob(
      jobView({
        status: "done",
        stage: null,
        revision: 3,
        result: {
          rawTranscript: "hello",
          polishedText: "Hello!",
          polished: true,
          actions: [],
          actionsAvailable: true,
        },
        availability: {
          rawTranscript: true,
          polishedText: true,
          actions: true,
        },
      }),
    );
    expect(store.hasPolishedText).toBe(true);
    expect(store.result?.polishedText).toBe("Hello!");
    expect(store.isProcessing).toBe(false);
  });

  it("should long-poll with wait and the last revision", async () => {
    mockApiGet.mockResolvedValue({
      data: jobView({ revision: 4, status: "processing", stage: "polishing" }),
    });
    const store = useDictationStore();
    store.resumeFrom("job-1");
    store.revision = 3;

    const refreshed = await store.poll(true);

    expect(refreshed).toBe(true);
    expect(mockApiGet).toHaveBeenCalledWith("/dictation/job-1", {
      params: { wait: 1, since: 3 },
      timeout: 30000,
    });
    expect(store.revision).toBe(4);
    expect(store.stage).toBe("polishing");
  });

  it("should short-poll without wait parameters", async () => {
    mockApiGet.mockResolvedValue({ data: jobView() });
    const store = useDictationStore();
    store.resumeFrom("job-1");

    await store.poll();
    expect(mockApiGet).toHaveBeenCalledWith("/dictation/job-1", {
      params: undefined,
      timeout: undefined,
    });
  });

  it("should stop with an error when the job expired (404)", async () => {
    mockApiGet.mockRejectedValue({ response: { status: 404 } });
    const store = useDictationStore();
    store.resumeFrom("job-gone");

    const refreshed = await store.poll();
    expect(refreshed).toBe(false);
    expect(store.status).toBe("error");
    expect(store.error).toContain("expired");
  });

  it("should keep polling through transient errors", async () => {
    mockApiGet.mockRejectedValue(new Error("Network Error"));
    const store = useDictationStore();
    store.resumeFrom("job-1");

    const refreshed = await store.poll();
    expect(refreshed).toBe(false);
    expect(store.status).toBe("processing");
    expect(store.error).toBeNull();
  });

  it("should not poll without a job", async () => {
    const store = useDictationStore();
    await store.poll();
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it("should fetch recent jobs with a bounded source", async () => {
    const jobs = [jobView({ jobId: "job-2", status: "done" })];
    mockApiGet.mockResolvedValue({ data: { jobs } });
    const store = useDictationStore();

    await store.fetchRecentJobs(10);

    expect(mockApiGet).toHaveBeenCalledWith("/dictation/jobs", {
      params: { limit: 10, source: "dictation" },
    });
    expect(store.recentJobs).toEqual(jobs);
  });

  it("should open a persisted job and load its state", async () => {
    mockApiGet.mockResolvedValue({
      data: jobView({
        status: "done",
        revision: 5,
        result: {
          rawTranscript: "kept",
          polishedText: "Kept",
          polished: true,
          actions: [],
          actionsAvailable: true,
        },
        availability: {
          rawTranscript: true,
          polishedText: true,
          actions: true,
        },
      }),
    });
    const store = useDictationStore();

    await store.openJob("job-1");

    expect(mockApiGet).toHaveBeenCalledWith("/dictation/job-1", {
      params: undefined,
      timeout: undefined,
    });
    expect(store.jobId).toBe("job-1");
    expect(store.status).toBe("done");
    expect(store.hasRawTranscript).toBe(true);
  });

  it("should clear the current job on reset", () => {
    const store = useDictationStore();
    store.resumeFrom("job-1");
    store.result = {
      rawTranscript: "t",
      polishedText: "t",
      polished: true,
      actions: [],
      actionsAvailable: true,
    };
    store.revision = 2;
    store.stage = "actions";

    store.reset();
    expect(store.jobId).toBeNull();
    expect(store.result).toBeNull();
    expect(store.revision).toBe(0);
    expect(store.stage).toBeNull();
    expect(store.isProcessing).toBe(false);
  });
});
