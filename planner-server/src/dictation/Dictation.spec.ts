import axios from "axios";
import * as fs from "fs-extra";

jest.mock("axios");
jest.mock("fs-extra");
jest.mock("./DictationData", () => {
  const jobs = new Map<string, any>();

  function now(): string {
    return new Date(Date.now()).toISOString();
  }

  function fill(input: any): any {
    const timestamp = now();
    return {
      taskId: null,
      attachmentId: null,
      commentId: null,
      jobKind: "short",
      clientId: null,
      projectId: null,
      archivedAt: null,
      transcriptSegments: null,
      summary: null,
      decisions: [],
      chunkPlan: null,
      segmentsDone: 0,
      segmentsTotal: 0,
      audioPath: null,
      audioRetained: false,
      audioDeletedAt: null,
      convertedAt: null,
      convertedType: null,
      convertedTargetId: null,
      stage: null,
      language: null,
      targetLanguage: null,
      model: null,
      rawTranscript: null,
      polishedText: null,
      polished: false,
      segments: null,
      actions: [],
      actionsAvailable: false,
      error: null,
      audioDurationMs: null,
      queueMs: null,
      sttMs: null,
      polishMs: null,
      actionsMs: null,
      totalMs: null,
      revision: 0,
      dateCreated: timestamp,
      dateUpdated: timestamp,
      ...input,
    };
  }

  const api = {
    __jobs: jobs,
    __reset: () => jobs.clear(),
    DictationDataCreate: jest.fn(async (input: any) => {
      jobs.set(input.id, fill(input));
    }),
    DictationDataGet: jest.fn(async (jobId: string) => jobs.get(jobId) ?? null),
    DictationDataGetForUser: jest.fn(
      async (userId: string, jobId: string) => {
        const job = jobs.get(jobId);
        return job && job.userId === userId ? job : null;
      },
    ),
    DictationDataUpdate: jest.fn(async (jobId: string, patch: any) => {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      Object.assign(job, patch);
      job.revision += 1;
      job.dateUpdated = now();
    }),
    DictationDataGetInFlightForUser: jest.fn(
      async (
        userId: string,
        source: string | string[] | undefined,
        jobKind?: string,
      ) => {
        const sources = Array.isArray(source) ? source : [source];
        return (
          [...jobs.values()]
            .filter(
              (job) =>
                job.userId === userId &&
                (source === undefined || sources.includes(job.source)) &&
                job.status === "processing" &&
                (!jobKind || job.jobKind === jobKind),
            )
            .pop() ?? null
        );
      },
    ),
    DictationDataListRecent: jest.fn(
      async (userId: string, source: string | undefined, limit: number) =>
        [...jobs.values()]
          .filter(
            (job) =>
              job.userId === userId &&
              (!source || job.source === source) &&
              Date.parse(job.expiresAt) >= Date.now(),
          )
          .sort((a, b) => (a.dateCreated < b.dateCreated ? 1 : -1))
          .slice(0, limit),
    ),
    DictationDataGetLatestByAttachment: jest.fn(async () => null),
    DictationDataDeleteExpired: jest.fn(async (at?: string) => {
      const threshold = at ?? now();
      let removed = 0;
      for (const [id, job] of jobs) {
        if (job.expiresAt < threshold) {
          jobs.delete(id);
          removed++;
        }
      }
      return removed;
    }),
    DictationDataMarkInterruptedBeforeStt: jest.fn(
      async (message: string, at?: string) => {
        let updated = 0;
        for (const job of jobs.values()) {
          if (job.status === "processing" && job.rawTranscript === null) {
            job.status = "error";
            job.stage = null;
            job.error = message;
            job.revision += 1;
            job.dateUpdated = at ?? now();
            updated++;
          }
        }
        return updated;
      },
    ),
    DictationDataListResumable: jest.fn(async () =>
      [...jobs.values()].filter(
        (job) =>
          job.status === "processing" && job.rawTranscript !== null,
      ),
    ),
    DictationDataListKeptAudio: jest.fn(async () =>
      [...jobs.values()].filter((job) => job.audioPath),
    ),
    DictationDataListResumableMeeting: jest.fn(async () =>
      [...jobs.values()].filter(
        (job) => job.status === "processing" && job.jobKind === "meeting",
      ),
    ),
    DictationDataSetAudioState: jest.fn(async (jobId: string, state: any) => {
      Object.assign(jobs.get(jobId) ?? {}, state);
    }),
  };
  return api;
});
jest.mock("./SttWhisperCpp", () => {
  class SttNoSpeechError extends Error {
    constructor() {
      super("No speech detected");
      this.name = "SttNoSpeechError";
    }
  }
  return {
    SttNoSpeechError,
    SttWhisperCppTranscribe: jest.fn(),
    SttWhisperCppPrepareModel: jest.fn(async () => undefined),
    SttWhisperCppGetStatus: jest.fn(() => ({
      state: "ready",
      model: "ggml-base",
      error: null,
    })),
    SttWhisperCppGetThreads: jest.fn(() => 1),
    SttWhisperCppCleanStalePartFiles: jest.fn(async () => 0),
  };
});

const mockAxios = axios as jest.Mocked<typeof axios>;
const mockReadFile = (fs as any).readFile as jest.Mock;
const mockRemove = (fs as any).remove as jest.Mock;
const mockData = jest.requireMock("./DictationData") as any;

import {
  DictationGetInFlightJobId,
  DictationGetJob,
  DictationGetRecentJobs,
  DictationInit,
  DictationPolishTranscript,
  DictationResumeJob,
  DictationStartJob,
  DictationSweepExpiredJobs,
  DictationTranscribeAndPolish,
  DictationTranscribeAudio,
  DictationWaitForJob,
} from "./Dictation";
import {
  SttNoSpeechError,
  SttWhisperCppTranscribe,
} from "./SttWhisperCpp";
import { Config } from "../Config";

const mockStt = SttWhisperCppTranscribe as jest.Mock;

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
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const sttResponse = (text: string) => ({ data: { text } });
const llmResponse = (content: string) => ({
  data: { choices: [{ message: { content } }] },
});

function externalConfig(): Config {
  const config = new Config();
  config.DICTATION_ENABLED = true;
  config.STT_MODE = "external";
  config.STT_API_URL = "https://stt.test";
  config.STT_API_KEY = "stt-key";
  config.STT_MODEL = "whisper-test";
  config.LLM_API_KEY = "llm-key";
  config.LLM_API_URL = "https://llm.test/chat";
  config.LLM_MODEL = "llm-test";
  return config;
}

describe("Dictation pipeline", () => {
  beforeEach(async () => {
    mockData.__reset();
    mockReadFile.mockResolvedValue(Buffer.from("fake audio"));
    mockRemove.mockResolvedValue(undefined);
    mockAxios.post.mockResolvedValue(llmResponse('{"text": "Hi"}') as never);
    await DictationInit(externalConfig());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  function queueStt(deferral: { promise: Promise<unknown> }) {
    mockAxios.post.mockImplementationOnce(() => deferral.promise as never);
  }

  it("should persist each stage and return the polished result with actions", async () => {
    const stt = deferred();
    const polish = deferred();
    const actions = deferred();
    queueStt(stt);
    mockAxios.post.mockImplementationOnce(() => polish.promise as never);
    mockAxios.post.mockImplementationOnce(() => actions.promise as never);

    const jobId = await DictationStartJob(
      "user-1",
      "/tmp/dictation/a1.audio",
      "audio/webm",
      "en",
    );

    let view = await DictationGetJob("user-1", jobId);
    expect(view).toMatchObject({
      jobId,
      status: "processing",
      stage: "transcribing",
      result: null,
      availability: {
        rawTranscript: false,
        polishedText: false,
        actions: false,
      },
    });

    stt.resolve(sttResponse("hello world"));
    await flush();
    view = await DictationGetJob("user-1", jobId);
    // The raw transcript is available before polish completes
    expect(view).toMatchObject({
      status: "processing",
      stage: "polishing",
      result: {
        rawTranscript: "hello world",
        polishedText: null,
        actions: [],
      },
      availability: {
        rawTranscript: true,
        polishedText: false,
        actions: false,
      },
    });

    polish.resolve(llmResponse('{"text": "Hello world!"}'));
    await flush();
    view = await DictationGetJob("user-1", jobId);
    expect(view).toMatchObject({
      status: "processing",
      stage: "actions",
      result: {
        rawTranscript: "hello world",
        polishedText: "Hello world!",
        polished: true,
      },
      availability: {
        rawTranscript: true,
        polishedText: true,
        actions: false,
      },
    });

    actions.resolve(
      llmResponse(
        '{"actions": [{"type": "create_task", "title": "Greet", "description": "Say hi", "priority": "high"}]}',
      ),
    );
    await flush();

    view = await DictationGetJob("user-1", jobId);
    expect(view).toMatchObject({
      jobId,
      source: "dictation",
      status: "done",
      stage: null,
      result: {
        rawTranscript: "hello world",
        polishedText: "Hello world!",
        polished: true,
        actions: [
          {
            type: "create_task",
            title: "Greet",
            description: "Say hi",
            priority: "high",
          },
        ],
        actionsAvailable: true,
      },
      error: null,
      timings: {
        queueMs: expect.any(Number),
        sttMs: expect.any(Number),
        polishMs: expect.any(Number),
        actionsMs: expect.any(Number),
        totalMs: expect.any(Number),
      },
    });
    expect(view!.revision).toBeGreaterThan(0);

    // Audio deleted right after the STT call
    expect(mockRemove).toHaveBeenCalledWith("/tmp/dictation/a1.audio");

    // STT call shape
    expect(mockAxios.post.mock.calls[0][0]).toBe(
      "https://stt.test/v1/audio/transcriptions",
    );
    const form = mockAxios.post.mock.calls[0][1] as FormData;
    expect(form.get("model")).toBe("whisper-test");
    expect(form.get("language")).toBe("en");
    expect(mockAxios.post.mock.calls[0][2]).toMatchObject({
      headers: { Authorization: "Bearer stt-key" },
    });
    // LLM call shape and length-scaled output budget
    expect(mockAxios.post.mock.calls[1][0]).toBe("https://llm.test/chat");
    expect(mockAxios.post.mock.calls[1][1]).toMatchObject({ max_tokens: 1000 });
    expect(mockAxios.post.mock.calls[1][2]).toMatchObject({
      headers: { Authorization: "Bearer llm-key" },
    });

    // Single-flight cleared after completion
    expect(await DictationGetInFlightJobId("user-1")).toBeNull();
  });

  it("should transcribe through the embedded engine when STT_MODE is embedded", async () => {
    const embeddedConfig = new Config();
    embeddedConfig.DICTATION_ENABLED = true;
    embeddedConfig.STT_MODE = "embedded";
    embeddedConfig.STT_EMBEDDED_MODEL = "ggml-base";
    embeddedConfig.LLM_API_KEY = "llm-key";
    embeddedConfig.LLM_API_URL = "https://llm.test/chat";
    embeddedConfig.LLM_MODEL = "llm-test";
    await DictationInit(embeddedConfig);

    mockStt.mockResolvedValueOnce({
      text: "embedded transcript",
      audioDurationMs: 3000,
      threads: 1,
      sttMs: 12,
    } as never);
    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"text": "Embedded!"}') as never,
    );
    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"actions": []}') as never,
    );

    const jobId = await DictationStartJob(
      "user-emb",
      "/tmp/dictation/e1.audio",
      "audio/webm",
      "en",
    );
    await flush();

    expect(await DictationGetJob("user-emb", jobId)).toMatchObject({
      status: "done",
      result: {
        rawTranscript: "embedded transcript",
        polishedText: "Embedded!",
        polished: true,
        actions: [],
        actionsAvailable: true,
      },
      timings: { audioDurationMs: 3000, sttMs: 12 },
    });
    expect(mockStt).toHaveBeenCalledWith(
      expect.objectContaining({ STT_MODE: "embedded" }),
      "/tmp/dictation/e1.audio",
      "audio/webm",
      "en",
      { prompt: null, priority: "interactive" },
    );
    // axios is used only for the LLM stages, never for the STT call
    expect(mockAxios.post).toHaveBeenCalledTimes(2);
    expect(mockAxios.post.mock.calls[0][0]).toBe("https://llm.test/chat");
    expect(mockRemove).toHaveBeenCalledWith("/tmp/dictation/e1.audio");
  });

  it("should persist and expose the confidence segments of the embedded engine", async () => {
    const embeddedConfig = new Config();
    embeddedConfig.DICTATION_ENABLED = true;
    embeddedConfig.STT_MODE = "embedded";
    embeddedConfig.STT_EMBEDDED_MODEL = "ggml-base";
    embeddedConfig.LLM_API_KEY = "llm-key";
    embeddedConfig.LLM_API_URL = "https://llm.test/chat";
    embeddedConfig.LLM_MODEL = "llm-test";
    await DictationInit(embeddedConfig);

    const segments = [
      { text: "hello", fromMs: 0, toMs: 400, confidence: 0.9 },
      { text: "world", fromMs: 400, toMs: 900, confidence: 0.3 },
    ];
    mockStt.mockResolvedValueOnce({
      text: "hello world",
      audioDurationMs: 900,
      threads: 1,
      sttMs: 5,
      segments,
    } as never);
    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"text": "Hello world!"}') as never,
    );
    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"actions": []}') as never,
    );

    const jobId = await DictationStartJob(
      "user-seg",
      "/tmp/dictation/seg.audio",
      "audio/webm",
      "en",
    );
    await flush();

    expect(await DictationGetJob("user-seg", jobId)).toMatchObject({
      status: "done",
      result: { segments },
    });
  });

  it("should forward the vocabulary prompt to the embedded engine", async () => {
    const embeddedConfig = new Config();
    embeddedConfig.DICTATION_ENABLED = true;
    embeddedConfig.STT_MODE = "embedded";
    embeddedConfig.STT_EMBEDDED_MODEL = "ggml-base";
    embeddedConfig.LLM_API_KEY = "";
    await DictationInit(embeddedConfig);

    mockStt.mockResolvedValueOnce({
      text: "hello",
      audioDurationMs: 500,
      threads: 1,
      sttMs: 5,
      segments: null,
    } as never);

    await DictationStartJob(
      "user-hot",
      "/tmp/dictation/hot.audio",
      "audio/webm",
      "en",
      "dictation",
      { prompt: "Vocabulary: Planner.", hotwordsCount: 1 },
    );
    await flush();

    expect(mockStt).toHaveBeenCalledWith(
      expect.objectContaining({ STT_MODE: "embedded" }),
      "/tmp/dictation/hot.audio",
      "audio/webm",
      "en",
      { prompt: "Vocabulary: Planner.", priority: "interactive" },
    );
  });

  it("should persist the target language and translate in the polish stage", async () => {
    const stt = deferred();
    queueStt(stt);
    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"text": "Bonjour"}') as never,
    );
    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"actions": []}') as never,
    );

    const jobId = await DictationStartJob(
      "user-translate",
      "/tmp/dictation/tr.audio",
      "audio/webm",
      "en",
      "dictation",
      { targetLanguage: "fr" },
    );
    expect(await DictationGetJob("user-translate", jobId)).toMatchObject({
      targetLanguage: "fr",
    });

    stt.resolve(sttResponse("hello"));
    await flush();

    const polishBody = mockAxios.post.mock.calls[1][1] as {
      messages: { content: string }[];
    };
    expect(polishBody.messages[1].content).toContain(
      'Translate the polished text into language code "fr"',
    );
    expect(await DictationGetJob("user-translate", jobId)).toMatchObject({
      status: "done",
      result: { polishedText: "Bonjour" },
    });
  });

  it("should omit the STT language parameter in auto mode", async () => {
    const stt = deferred();
    queueStt(stt);
    mockAxios.post.mockResolvedValueOnce(llmResponse('{"text": "Hello"}') as never);
    mockAxios.post.mockResolvedValueOnce(llmResponse('{"actions": []}') as never);

    await DictationStartJob(
      "user-auto",
      "/tmp/dictation/a2.audio",
      "audio/webm",
      null,
    );
    stt.resolve(sttResponse("hello"));
    await flush();

    const form = mockAxios.post.mock.calls[0][1] as FormData;
    expect(form.get("language")).toBeNull();
  });

  it("should surface an STT failure as an error job and delete the audio", async () => {
    const stt = deferred();
    queueStt(stt);

    const jobId = await DictationStartJob(
      "user-2",
      "/tmp/dictation/a3.audio",
      "audio/webm",
      null,
    );
    stt.reject(
      Object.assign(new Error("upstream down"), { response: { status: 500 } }),
    );
    await flush();

    expect(await DictationGetJob("user-2", jobId)).toMatchObject({
      jobId,
      status: "error",
      stage: null,
      result: null,
      error: "Dictation failed, please try again",
    });
    expect(mockRemove).toHaveBeenCalledWith("/tmp/dictation/a3.audio");
    expect(await DictationGetInFlightJobId("user-2")).toBeNull();
  });

  it("should map a no-speech recording to a dedicated error", async () => {
    mockAxios.post.mockRejectedValueOnce(new SttNoSpeechError() as never);

    const jobId = await DictationStartJob(
      "user-nospeech",
      "/tmp/dictation/a3b.audio",
      "audio/webm",
      null,
    );
    await flush();

    expect(await DictationGetJob("user-nospeech", jobId)).toMatchObject({
      status: "error",
      result: null,
      error: "No speech detected, please try again.",
    });
    expect(mockRemove).toHaveBeenCalledWith("/tmp/dictation/a3b.audio");
  });

  it("should fall back to the raw transcript when the polish call fails", async () => {
    const stt = deferred();
    queueStt(stt);
    mockAxios.post.mockRejectedValueOnce(
      Object.assign(new Error("bad request"), { response: { status: 400 } }),
    );
    mockAxios.post.mockRejectedValueOnce(
      Object.assign(new Error("bad request"), { response: { status: 400 } }),
    );

    const jobId = await DictationStartJob(
      "user-3",
      "/tmp/dictation/a4.audio",
      "audio/webm",
      null,
    );
    stt.resolve(sttResponse("raw transcript here"));
    await flush();

    expect(await DictationGetJob("user-3", jobId)).toMatchObject({
      status: "done",
      result: {
        rawTranscript: "raw transcript here",
        polishedText: "raw transcript here",
        polished: false,
        actions: [],
        actionsAvailable: false,
      },
    });
  });

  it("should skip action cards when the actions call fails", async () => {
    const stt = deferred();
    queueStt(stt);
    mockAxios.post.mockResolvedValueOnce(llmResponse('{"text": "Hello!"}') as never);
    mockAxios.post.mockRejectedValueOnce(
      Object.assign(new Error("bad request"), { response: { status: 400 } }),
    );

    const jobId = await DictationStartJob(
      "user-4",
      "/tmp/dictation/a5.audio",
      "audio/webm",
      null,
    );
    stt.resolve(sttResponse("hello"));
    await flush();

    expect(await DictationGetJob("user-4", jobId)).toMatchObject({
      status: "done",
      result: {
        rawTranscript: "hello",
        polishedText: "Hello!",
        polished: true,
        actions: [],
        actionsAvailable: false,
      },
    });
  });

  it("should keep the raw transcript when the LLM answers unparseable output", async () => {
    const stt = deferred();
    queueStt(stt);
    mockAxios.post.mockResolvedValueOnce(llmResponse("I cannot help with that") as never);
    mockAxios.post.mockResolvedValueOnce(llmResponse('{"actions": "nope"}') as never);

    const jobId = await DictationStartJob(
      "user-5",
      "/tmp/dictation/a6.audio",
      "audio/webm",
      null,
    );
    stt.resolve(sttResponse("hello"));
    await flush();

    expect(await DictationGetJob("user-5", jobId)).toMatchObject({
      status: "done",
      result: {
        rawTranscript: "hello",
        polishedText: "hello",
        polished: false,
        actionsAvailable: false,
      },
    });
  });

  it("should allow only one job in flight per user", async () => {
    const stt = deferred();
    queueStt(stt);

    const jobId = await DictationStartJob(
      "user-6",
      "/tmp/dictation/a7.audio",
      "audio/webm",
      null,
    );
    expect(await DictationGetInFlightJobId("user-6")).toBe(jobId);
    expect(await DictationGetInFlightJobId("user-6")).toBe(jobId);

    stt.resolve(sttResponse("hello"));
    await flush();
    expect(await DictationGetInFlightJobId("user-6")).toBeNull();
  });

  it("should never expose another user's job", async () => {
    const stt = deferred();
    queueStt(stt);

    const jobId = await DictationStartJob(
      "user-7",
      "/tmp/dictation/a8.audio",
      "audio/webm",
      null,
    );
    expect(await DictationGetJob("user-8", jobId)).toBeNull();
    expect(await DictationGetJob("user-7", "unknown-job")).toBeNull();

    stt.resolve(sttResponse("hello"));
    await flush();
  });

  it("should list the recent jobs of a user", async () => {
    const stt = deferred();
    queueStt(stt);
    mockAxios.post.mockResolvedValue(llmResponse('{"text": "Hello"}') as never);

    const jobId = await DictationStartJob(
      "user-recent",
      "/tmp/dictation/r1.audio",
      "audio/webm",
      null,
    );
    stt.resolve(sttResponse("hello"));
    await flush();

    const jobs = await DictationGetRecentJobs("user-recent", 20, "dictation");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ jobId, status: "done" });
    expect(await DictationGetRecentJobs("someone-else")).toEqual([]);
  });

  it("should expire jobs after the TTL", async () => {
    const stt = deferred();
    queueStt(stt);
    mockAxios.post.mockResolvedValue(llmResponse('{"text": "Hello"}') as never);

    const jobId = await DictationStartJob(
      "user-9",
      "/tmp/dictation/a9.audio",
      "audio/webm",
      null,
    );
    stt.resolve(sttResponse("hello"));
    await flush();
    expect(await DictationGetJob("user-9", jobId)).not.toBeNull();

    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await DictationSweepExpiredJobs()).toBeGreaterThanOrEqual(1);
    expect(await DictationGetJob("user-9", jobId)).toBeNull();
  });

  it("should long-poll until a stage is persisted", async () => {
    const stt = deferred();
    const polish = deferred();
    queueStt(stt);
    mockAxios.post.mockImplementationOnce(() => polish.promise as never);
    mockAxios.post.mockResolvedValueOnce(llmResponse('{"actions": []}') as never);

    const jobId = await DictationStartJob(
      "user-wait",
      "/tmp/dictation/w1.audio",
      "audio/webm",
      null,
    );
    const initial = await DictationGetJob("user-wait", jobId);
    const waiting = DictationWaitForJob(
      "user-wait",
      jobId,
      initial!.revision,
      5000,
    );

    stt.resolve(sttResponse("hello"));
    const view = await waiting;
    expect(view).toMatchObject({
      status: "processing",
      stage: "polishing",
    });
    expect(view!.revision).toBeGreaterThan(initial!.revision);

    polish.resolve(llmResponse('{"text": "Hello!"}'));
    await flush();
    expect(await DictationGetInFlightJobId("user-wait")).toBeNull();
  });

  it("should stop waiting after the timeout when nothing changes", async () => {
    const stt = deferred();
    queueStt(stt);

    const jobId = await DictationStartJob(
      "user-timeout",
      "/tmp/dictation/w2.audio",
      "audio/webm",
      null,
    );
    const initial = await DictationGetJob("user-timeout", jobId);
    const view = await DictationWaitForJob(
      "user-timeout",
      jobId,
      initial!.revision,
      30,
    );
    expect(view).toMatchObject({
      jobId,
      status: "processing",
      stage: "transcribing",
    });
    expect(view!.revision).toBe(initial!.revision);

    stt.resolve(sttResponse("hello"));
    await flush();
  });

  it("should return null from the long-poll for an unknown job", async () => {
    await expect(
      DictationWaitForJob("user-unknown", "missing", 0, 10),
    ).resolves.toBeNull();
  });

  it("should resume polish and actions of a job interrupted after STT", async () => {
    // Simulates a crash after STT: the record exists with its raw transcript
    // but the audio is gone
    await mockData.DictationDataCreate({
      id: "crash-job",
      userId: "user-resume",
      source: "dictation",
      status: "processing",
      stage: "polishing",
      language: "en",
      engine: "external",
      model: "whisper-test",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await mockData.DictationDataUpdate("crash-job", {
      rawTranscript: "recovered transcript",
    });

    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"text": "Recovered transcript."}') as never,
    );
    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"actions": []}') as never,
    );

    await DictationResumeJob("crash-job");

    expect(await DictationGetJob("user-resume", "crash-job")).toMatchObject({
      status: "done",
      result: {
        rawTranscript: "recovered transcript",
        polishedText: "Recovered transcript.",
        polished: true,
        actionsAvailable: true,
      },
    });
  });

  it("should mark jobs interrupted before STT as errors at startup", async () => {
    await mockData.DictationDataCreate({
      id: "interrupted-job",
      userId: "user-startup",
      source: "dictation",
      status: "processing",
      stage: "transcribing",
      language: null,
      engine: "external",
      model: "whisper-test",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await DictationInit(externalConfig());

    expect(await DictationGetJob("user-startup", "interrupted-job")).toMatchObject({
      status: "error",
      stage: null,
      error: "Interrupted, please record again.",
    });
  });

  it("should treat voice comment jobs interrupted after STT as retryable errors", async () => {
    await mockData.DictationDataCreate({
      id: "voice-crash",
      userId: "user-voice",
      source: "voice_comment",
      status: "processing",
      stage: "polishing",
      language: null,
      engine: "external",
      model: "whisper-test",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await mockData.DictationDataUpdate("voice-crash", {
      rawTranscript: "hello",
    });

    await DictationResumeJob("voice-crash");

    expect(await DictationGetJob("user-voice", "voice-crash")).toMatchObject({
      status: "error",
      error: "Transcription interrupted, please retry.",
    });
  });

  it("should persist the inline source and expose it in the job view", async () => {
    const stt = deferred();
    queueStt(stt);

    const jobId = await DictationStartJob(
      "user-inline",
      "/tmp/dictation/inline.audio",
      "audio/webm",
      "en",
      "inline",
    );

    expect(await DictationGetJob("user-inline", jobId)).toMatchObject({
      jobId,
      source: "inline",
      status: "processing",
    });
    expect(await DictationGetInFlightJobId("user-inline")).toBe(jobId);

    stt.resolve(sttResponse("inline text"));
    await flush();
  });

  it("should recover a processing inline job from the database", async () => {
    await mockData.DictationDataCreate({
      id: "inline-in-flight",
      userId: "user-inline-db",
      source: "inline",
      status: "processing",
      stage: "transcribing",
      language: null,
      engine: "external",
      model: "whisper-test",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    expect(await DictationGetInFlightJobId("user-inline-db")).toBe(
      "inline-in-flight",
    );
  });

  it("should resume polish and actions of an inline job interrupted after STT", async () => {
    await mockData.DictationDataCreate({
      id: "inline-crash",
      userId: "user-inline-resume",
      source: "inline",
      status: "processing",
      stage: "polishing",
      language: "en",
      engine: "external",
      model: "whisper-test",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await mockData.DictationDataUpdate("inline-crash", {
      rawTranscript: "inline recovered",
    });

    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"text": "Inline recovered."}') as never,
    );
    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"actions": []}') as never,
    );

    await DictationResumeJob("inline-crash");

    expect(await DictationGetJob("user-inline-resume", "inline-crash")).toMatchObject({
      source: "inline",
      status: "done",
      result: {
        rawTranscript: "inline recovered",
        polishedText: "Inline recovered.",
        polished: true,
      },
    });
  });

  it("should resume with the persisted target language", async () => {
    await mockData.DictationDataCreate({
      id: "translated-crash",
      userId: "user-translate-resume",
      source: "dictation",
      status: "processing",
      stage: "polishing",
      language: "en",
      targetLanguage: "fr",
      engine: "external",
      model: "whisper-test",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await mockData.DictationDataUpdate("translated-crash", {
      rawTranscript: "hello",
    });

    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"text": "Bonjour"}') as never,
    );
    mockAxios.post.mockResolvedValueOnce(
      llmResponse('{"actions": []}') as never,
    );

    await DictationResumeJob("translated-crash");

    const polishBody = mockAxios.post.mock.calls[0][1] as {
      messages: { content: string }[];
    };
    expect(polishBody.messages[1].content).toContain(
      'Translate the polished text into language code "fr"',
    );
    expect(
      await DictationGetJob("user-translate-resume", "translated-crash"),
    ).toMatchObject({
      status: "done",
      targetLanguage: "fr",
      result: { polishedText: "Bonjour" },
    });
  });

  // ==================== Shared STT / polish stages ====================
  describe("shared STT and polish stages", () => {
    it("should transcribe through the external endpoint without deleting the audio", async () => {
      mockAxios.post.mockResolvedValueOnce(sttResponse("hello world") as never);

      const transcript = await DictationTranscribeAudio(
        "/tmp/dictation/x1.audio",
        "audio/webm",
        "en",
      );

      expect(transcript).toMatchObject({
        text: "hello world",
        audioDurationMs: null,
        threads: 0,
        sttMs: expect.any(Number),
      });
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post.mock.calls[0][0]).toBe(
        "https://stt.test/v1/audio/transcriptions",
      );
      expect(mockRemove).not.toHaveBeenCalledWith("/tmp/dictation/x1.audio");
    });

    it("should transcribe through the embedded engine without deleting the audio", async () => {
      const embeddedConfig = new Config();
      embeddedConfig.DICTATION_ENABLED = true;
      embeddedConfig.STT_MODE = "embedded";
      embeddedConfig.STT_EMBEDDED_MODEL = "ggml-base";
      await DictationInit(embeddedConfig);
      mockStt.mockResolvedValueOnce({
        text: "embedded transcript",
        audioDurationMs: 2500,
        threads: 1,
        sttMs: 40,
      } as never);

      const transcript = await DictationTranscribeAudio(
        "/tmp/dictation/x2.audio",
        "audio/webm",
        null,
      );

      expect(transcript).toMatchObject({
        text: "embedded transcript",
        audioDurationMs: 2500,
      });
      expect(mockStt).toHaveBeenCalledWith(
        expect.objectContaining({ STT_MODE: "embedded" }),
        "/tmp/dictation/x2.audio",
        "audio/webm",
        null,
        { prompt: null, priority: "interactive" },
      );
      expect(mockRemove).not.toHaveBeenCalledWith("/tmp/dictation/x2.audio");
    });

    it("should polish a transcript and report it as polished", async () => {
      mockAxios.post.mockResolvedValueOnce(llmResponse('{"text": "Hello!"}') as never);

      const result = await DictationPolishTranscript("hello", null);

      expect(result).toEqual({ polishedText: "Hello!", polished: true });
    });

    it("should scale the output budget with the transcript length", async () => {
      mockAxios.post.mockResolvedValueOnce(llmResponse('{"text": "Done"}') as never);

      await DictationPolishTranscript("x".repeat(10000), null);

      expect(mockAxios.post.mock.calls[0][1]).toMatchObject({
        max_tokens: 4000,
      });
    });

    it("should fall back to the raw transcript when the polish call fails", async () => {
      mockAxios.post.mockRejectedValueOnce(
        Object.assign(new Error("bad request"), {
          response: { status: 400 },
        }) as never,
      );

      const result = await DictationPolishTranscript("hello", null);

      expect(result).toEqual({ polishedText: "hello", polished: false });
    });

    it("should keep the raw transcript when the polish response is unparseable", async () => {
      mockAxios.post.mockResolvedValueOnce(llmResponse("garbage") as never);

      const result = await DictationPolishTranscript("hello", null);

      expect(result).toEqual({ polishedText: "hello", polished: false });
    });

    it("should skip polishing when no LLM key is configured", async () => {
      const noLlmConfig = new Config();
      noLlmConfig.DICTATION_ENABLED = true;
      noLlmConfig.STT_API_URL = "https://stt.test";
      noLlmConfig.STT_API_KEY = "stt-key";
      noLlmConfig.LLM_API_KEY = "";
      await DictationInit(noLlmConfig);

      const result = await DictationPolishTranscript("hello", null);

      expect(result).toEqual({ polishedText: "hello", polished: false });
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it("should transcribe and polish without deleting the audio file", async () => {
      mockAxios.post.mockResolvedValueOnce(sttResponse("hello world") as never);
      mockAxios.post.mockResolvedValueOnce(
        llmResponse('{"text": "Hello world!"}') as never,
      );

      const result = await DictationTranscribeAndPolish(
        "/tmp/dictation/x3.audio",
        "audio/webm",
        "en",
      );

      expect(result).toMatchObject({
        rawTranscript: "hello world",
        polishedText: "Hello world!",
        polished: true,
        sttMs: expect.any(Number),
        polishMs: expect.any(Number),
      });
      expect(mockRemove).not.toHaveBeenCalledWith("/tmp/dictation/x3.audio");
    });

    it("should send the vocabulary prompt to the external endpoint", async () => {
      mockAxios.post.mockResolvedValueOnce(sttResponse("hello") as never);

      await DictationTranscribeAudio(
        "/tmp/dictation/x4.audio",
        "audio/webm",
        "en",
        { prompt: "Vocabulary: Planner." },
      );

      const form = mockAxios.post.mock.calls[0][1] as FormData;
      expect(form.get("prompt")).toBe("Vocabulary: Planner.");
      expect(form.get("language")).toBe("en");
    });

    it("should retry without the prompt when the endpoint rejects it", async () => {
      mockAxios.post
        .mockRejectedValueOnce(
          Object.assign(new Error("bad request"), {
            response: { status: 400 },
          }) as never,
        )
        .mockResolvedValueOnce(sttResponse("hello") as never);

      const transcript = await DictationTranscribeAudio(
        "/tmp/dictation/x5.audio",
        "audio/webm",
        "en",
        { prompt: "Vocabulary: Planner." },
      );

      expect(transcript).toMatchObject({ text: "hello", segments: null });
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
      const retried = mockAxios.post.mock.calls[1][1] as FormData;
      expect(retried.get("prompt")).toBeNull();
    });

    it("should not retry a failure that is not a prompt rejection", async () => {
      mockAxios.post.mockRejectedValueOnce(
        Object.assign(new Error("upstream down"), {
          response: { status: 500 },
        }) as never,
      );

      await expect(
        DictationTranscribeAudio("/tmp/dictation/x6.audio", "audio/webm", "en", {
          prompt: "Vocabulary: Planner.",
        }),
      ).rejects.toThrow("upstream down");
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
    });

    it("should ask the polish stage to translate when a target differs", async () => {
      mockAxios.post.mockResolvedValueOnce(
        llmResponse('{"text": "Bonjour"}') as never,
      );

      const result = await DictationPolishTranscript("hello", "en", "fr");

      expect(result).toEqual({ polishedText: "Bonjour", polished: true });
      const body = mockAxios.post.mock.calls[0][1] as {
        messages: { content: string }[];
      };
      expect(body.messages[1].content).toContain(
        'Translate the polished text into language code "fr"',
      );
    });

    it("should not translate when the target equals the source language", async () => {
      mockAxios.post.mockResolvedValueOnce(
        llmResponse('{"text": "Hello"}') as never,
      );

      await DictationPolishTranscript("hello", "en", "en");

      const body = mockAxios.post.mock.calls[0][1] as {
        messages: { content: string }[];
      };
      expect(body.messages[1].content).not.toContain("Translate the polished");
    });

    it("should keep voice comments in their spoken language", async () => {
      mockAxios.post.mockResolvedValueOnce(sttResponse("hello") as never);
      mockAxios.post.mockResolvedValueOnce(
        llmResponse('{"text": "Hello!"}') as never,
      );

      const result = await DictationTranscribeAndPolish(
        "/tmp/dictation/x7.audio",
        "audio/webm",
        "en",
      );

      expect(result).toMatchObject({ rawTranscript: "hello", segments: null });
      const body = mockAxios.post.mock.calls[1][1] as {
        messages: { content: string }[];
      };
      expect(body.messages[1].content).not.toContain("Translate the polished");
    });
  });
});
