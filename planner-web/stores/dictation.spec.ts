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
    put: vi.fn(),
  },
}));

const mockApiPost = api.post as unknown as ReturnType<typeof vi.fn>;
const mockApiGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockApiPut = api.put as unknown as ReturnType<typeof vi.fn>;

function jobView(overrides: Partial<DictationJobView> = {}): DictationJobView {
  return {
    jobId: "job-1",
    source: "dictation",
    status: "processing",
    stage: "transcribing",
    engine: "embedded",
    language: "fr",
    targetLanguage: null,
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
          segments: null,
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
          segments: null,
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

  it("should apply the job translation target and confidence segments", () => {
    const store = useDictationStore();

    store.applyJob(
      jobView({
        status: "done",
        stage: null,
        targetLanguage: "en",
        engine: "embedded",
        result: {
          rawTranscript: "bonjour",
          polishedText: "Hello",
          polished: true,
          actions: [],
          actionsAvailable: false,
          segments: [
            { text: "bonjour", fromMs: 0, toMs: 900, confidence: 0.4 },
          ],
        },
      }),
    );

    expect(store.jobTargetLanguage).toBe("en");
    expect(store.engine).toBe("embedded");
    expect(store.result?.segments?.[0]?.confidence).toBe(0.4);

    store.resetJob();
    expect(store.jobTargetLanguage).toBeNull();
    expect(store.engine).toBeNull();
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
          segments: null,
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
      segments: null,
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

describe("dictation store helpers", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("should submit an inline job with its own source", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-9" } });
    const store = useDictationStore();

    const result = await store.uploadJob(
      new Blob(["audio"]),
      "audio/webm",
      "fr",
      "inline",
    );

    expect(result).toEqual({ jobId: "job-9" });
    const [url, form] = mockApiPost.mock.calls[0]!;
    expect(url).toBe("/dictation");
    expect(form.get("language")).toBe("fr");
    expect(form.get("source")).toBe("inline");
    expect(form.get("file").name).toBe("dictation.webm");
  });

  it("should send the project scope and the translation target", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-9" } });
    const store = useDictationStore();

    await store.uploadJob(
      new Blob(["audio"]),
      "audio/webm",
      "fr",
      "inline",
      "project-1",
      "en",
    );

    const [, form] = mockApiPost.mock.calls[0]!;
    expect(form.get("projectId")).toBe("project-1");
    expect(form.get("targetLanguage")).toBe("en");
  });

  it("should always send a target language, disabling it when off", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-9" } });
    const store = useDictationStore();

    await store.uploadJob(new Blob(["audio"]), "audio/webm", "fr");

    const [, form] = mockApiPost.mock.calls[0]!;
    expect(form.get("targetLanguage")).toBe("");
    expect(form.get("projectId")).toBeNull();
  });

  it("should fall back to the stored translation target", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-9" } });
    const store = useDictationStore();
    store.targetLanguage = "de";

    await store.uploadJob(new Blob(["audio"]), "audio/webm");

    const [, form] = mockApiPost.mock.calls[0]!;
    expect(form.get("targetLanguage")).toBe("de");
  });

  it("should leave the source out for dialog dictation", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-9" } });
    const store = useDictationStore();

    await store.uploadJob(new Blob(["audio"]), "audio/webm", "fr");

    const [, form] = mockApiPost.mock.calls[0]!;
    expect(form.get("source")).toBeNull();
  });

  it("should fall back to the persisted language", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-9" } });
    const store = useDictationStore();
    store.setLanguage("de");

    await store.uploadJob(new Blob(["audio"]), "audio/webm");

    const [, form] = mockApiPost.mock.calls[0]!;
    expect(form.get("language")).toBe("de");
  });

  it("should report a running job on 409", async () => {
    mockApiPost.mockRejectedValue({
      response: { status: 409, data: { jobId: "job-running" } },
    });
    const store = useDictationStore();

    const result = await store.uploadJob(
      new Blob(["audio"]),
      "audio/webm",
      "auto",
      "inline",
    );

    expect(result).toEqual({ conflictJobId: "job-running" });
  });

  it("should return the server error message on failure", async () => {
    mockApiPost.mockRejectedValue({
      response: { status: 400, data: { error: "Invalid: an audio file is expected" } },
    });
    const store = useDictationStore();

    const result = await store.uploadJob(new Blob(["audio"]), "audio/webm");

    expect(result).toEqual({
      error: "Invalid: an audio file is expected",
      offline: false,
      status: 400,
    });
  });

  it("should fall back to a generic upload error", async () => {
    mockApiPost.mockRejectedValue(new Error("Network Error"));
    const store = useDictationStore();

    const result = await store.uploadJob(new Blob(["audio"]), "audio/webm");

    expect(result.error).toBe("The dictation could not be uploaded.");
  });

  it("should fetch one job with long-poll parameters", async () => {
    mockApiGet.mockResolvedValue({ data: jobView({ revision: 7 }) });
    const store = useDictationStore();

    const result = await store.fetchJob("job-1", { wait: true, since: 6 });

    expect(mockApiGet).toHaveBeenCalledWith("/dictation/job-1", {
      params: { wait: 1, since: 6 },
      timeout: 30000,
    });
    expect(result.job?.revision).toBe(7);
  });

  it("should fetch one job without wait parameters", async () => {
    mockApiGet.mockResolvedValue({ data: jobView() });
    const store = useDictationStore();

    await store.fetchJob("job-1");

    expect(mockApiGet).toHaveBeenCalledWith("/dictation/job-1", {
      params: undefined,
      timeout: undefined,
    });
  });

  it("should report an expired job as notFound", async () => {
    mockApiGet.mockRejectedValue({ response: { status: 404 } });
    const store = useDictationStore();

    expect(await store.fetchJob("job-gone")).toEqual({ notFound: true });
  });

  it("should report transient failures without notFound", async () => {
    mockApiGet.mockRejectedValue(new Error("Network Error"));
    const store = useDictationStore();

    expect(await store.fetchJob("job-1")).toEqual({});
  });
});

describe("dictation store preferences", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("should load the stored translation target", async () => {
    mockApiGet.mockResolvedValue({ data: { targetLanguage: "en" } });
    const store = useDictationStore();

    await store.fetchPreferences();

    expect(mockApiGet).toHaveBeenCalledWith("/dictation/preferences");
    expect(store.targetLanguage).toBe("en");
    expect(localStorage.getItem("dictation-target-language")).toBe("en");
  });

  it("should keep the local fallback when the preference cannot load", async () => {
    localStorage.setItem("dictation-target-language", "fr");
    mockApiGet.mockRejectedValue(new Error("Network Error"));
    const store = useDictationStore();

    await store.fetchPreferences();
    expect(store.targetLanguage).toBe("fr");
  });

  it("should save a target language and clear it when off", async () => {
    mockApiPut.mockResolvedValue({ data: { targetLanguage: "de" } });
    const store = useDictationStore();

    expect(await store.setTargetLanguage("de")).toEqual({});
    expect(mockApiPut).toHaveBeenCalledWith("/dictation/preferences", {
      targetLanguage: "de",
    });
    expect(store.targetLanguage).toBe("de");

    mockApiPut.mockResolvedValue({ data: { targetLanguage: null } });
    expect(await store.setTargetLanguage(null)).toEqual({});
    expect(store.targetLanguage).toBe("");
    expect(localStorage.getItem("dictation-target-language")).toBeNull();
  });

  it("should roll back an optimistic preference the server refuses", async () => {
    localStorage.setItem("dictation-target-language", "fr");
    mockApiPut.mockRejectedValue({
      response: { data: { error: "Invalid: targetLanguage" } },
    });
    const store = useDictationStore();

    const result = await store.setTargetLanguage("xx");

    expect(result.error).toBe("Invalid: targetLanguage");
    expect(store.targetLanguage).toBe("fr");
    expect(localStorage.getItem("dictation-target-language")).toBe("fr");
  });

  it("should preview the stored actions", async () => {
    mockApiPost.mockResolvedValue({
      data: {
        jobId: "job-1",
        actions: [
          {
            index: 0,
            type: "create_task",
            action: { type: "create_task", title: "Buy milk" },
            status: "resolved",
            target: null,
            candidates: [],
            diff: [],
          },
        ],
      },
    });
    const store = useDictationStore();

    const result = await store.previewActions("job-1");

    expect(result).toEqual({});
    expect(mockApiPost).toHaveBeenCalledWith(
      "/dictation/job-1/actions/preview",
    );
    expect(store.hasStructuredActions).toBe(true);
    expect(store.previews[0]?.type).toBe("create_task");
    expect(store.previewLoading).toBe(false);
  });

  it("should surface a preview failure", async () => {
    mockApiPost.mockRejectedValue({
      response: { data: { error: "Dictation Job Not Found" } },
    });
    const store = useDictationStore();

    const result = await store.previewActions("job-1");

    expect(result.error).toBe("Dictation Job Not Found");
    expect(store.previews).toEqual([]);
    expect(store.previewError).toBe("Dictation Job Not Found");
    expect(store.previewLoading).toBe(false);
  });

  it("should apply selections and refresh the applied batches", async () => {
    mockApiPost.mockResolvedValue({
      data: {
        requestId: "req-1",
        alreadyApplied: false,
        results: [
          {
            index: 0,
            type: "create_task",
            status: "applied",
            targetId: "task-1",
          },
        ],
      },
    });
    mockApiGet.mockResolvedValue({
      data: {
        jobId: "job-1",
        batches: [
          {
            requestId: "req-1",
            dateCreated: "2026-11-07T10:00:00.000Z",
            actions: [
              {
                index: 0,
                type: "create_task",
                status: "applied",
                targetId: "task-1",
                targetType: "task",
                undoneAt: null,
                error: null,
              },
            ],
          },
        ],
      },
    });
    const store = useDictationStore();

    const result = await store.applyActions("job-1", "req-1", [
      { index: 0, projectId: "proj-1" },
    ]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/dictation/job-1/actions/apply",
      {
        requestId: "req-1",
        selections: [{ index: 0, projectId: "proj-1" }],
      },
    );
    expect(mockApiGet).toHaveBeenCalledWith("/dictation/job-1/actions");
    expect(result.outcome?.results[0]?.status).toBe("applied");
    expect(store.applyResults).toHaveLength(1);
    expect(store.lastRequestId).toBe("req-1");
    expect(store.latestBatch?.requestId).toBe("req-1");
  });

  it("should surface an apply failure", async () => {
    mockApiPost.mockRejectedValue({
      response: { data: { error: "Missing: selections" } },
    });
    const store = useDictationStore();

    const result = await store.applyActions("job-1", "req-1", []);

    expect(result.error).toBe("Missing: selections");
    expect(store.applyResults).toEqual([]);
  });

  it("should undo a batch and refresh the applied list", async () => {
    mockApiPost.mockResolvedValue({
      data: {
        requestId: "req-1",
        results: [{ index: 0, type: "create_task", status: "undone" }],
      },
    });
    mockApiGet.mockResolvedValue({ data: { jobId: "job-1", batches: [] } });
    const store = useDictationStore();

    const result = await store.undoActions("job-1", "req-1");

    expect(mockApiPost).toHaveBeenCalledWith(
      "/dictation/job-1/actions/undo",
      { requestId: "req-1" },
    );
    expect(mockApiGet).toHaveBeenCalledWith("/dictation/job-1/actions");
    expect(result.outcome?.results[0]?.status).toBe("undone");
    expect(store.appliedBatches).toEqual([]);
  });

  it("should ask a read-only question with an optional project", async () => {
    mockApiPost.mockResolvedValue({
      data: {
        intent: "due_today",
        answer: "1 open task is due today.",
        items: [],
        truncated: false,
        generatedBy: "deterministic",
      },
    });
    const store = useDictationStore();

    const result = await store.ask("What is due today?", "proj-1");

    expect(mockApiPost).toHaveBeenCalledWith("/dictation/ask", {
      question: "What is due today?",
      projectId: "proj-1",
    });
    expect(result.answer?.intent).toBe("due_today");
    expect(store.askAnswer?.answer).toBe("1 open task is due today.");
    expect(store.askLoading).toBe(false);
    expect(store.askError).toBe("");
  });

  it("should surface an ask failure without an answer", async () => {
    mockApiPost.mockRejectedValue({
      response: { data: { error: "Dictation Not Available" } },
    });
    const store = useDictationStore();

    const result = await store.ask("What is due today?");

    expect(result.error).toBe("Dictation Not Available");
    expect(store.askAnswer).toBeNull();
    expect(store.askError).toBe("Dictation Not Available");
    expect(store.askLoading).toBe(false);
  });

  it("should clear the action and ask state when the job resets", () => {
    const store = useDictationStore();
    store.jobId = "job-1";
    store.previews = [
      {
        index: 0,
        type: "create_task",
        action: { type: "create_task", title: "A" },
        status: "resolved",
        target: null,
        candidates: [],
        diff: [],
      },
    ];
    store.applyResults = [
      { index: 0, type: "create_task", status: "applied" },
    ];
    store.askAnswer = {
      intent: "unknown",
      answer: "No.",
      items: [],
      truncated: false,
      generatedBy: "deterministic",
    };

    store.resetJob();

    expect(store.previews).toEqual([]);
    expect(store.applyResults).toEqual([]);
    expect(store.askAnswer).toBeNull();
    expect(store.jobId).toBeNull();
  });
});
