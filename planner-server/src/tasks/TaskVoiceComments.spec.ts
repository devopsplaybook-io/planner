import * as fs from "fs-extra";

jest.mock("./TasksData", () => ({
  TasksDataGet: jest.fn(),
  TasksDataTouch: jest.fn(),
  addComment: jest.fn(),
}));
jest.mock("../users/UsersData", () => ({
  UsersDataGet: jest.fn(),
}));
jest.mock("../dictation/Dictation", () => ({
  DictationTranscribeAudio: jest.fn(),
  DictationPolishTranscript: jest.fn(),
  DictationNotifyJobChange: jest.fn(),
}));
jest.mock("../dictation/SttWhisperCpp", () => {
  class SttNoSpeechError extends Error {
    constructor() {
      super("No speech detected");
      this.name = "SttNoSpeechError";
    }
  }
  return { SttNoSpeechError };
});
jest.mock("../dictation/DictationData", () => {
  const jobs = new Map<string, any>();
  const stamp = () => new Date(Date.now()).toISOString();
  return {
    __jobs: jobs,
    __reset: () => jobs.clear(),
    DictationDataCreate: jest.fn(async (input: any) => {
      const timestamp = stamp();
      jobs.set(input.id, {
        taskId: null,
        attachmentId: null,
        commentId: null,
        stage: null,
        language: null,
        model: null,
        rawTranscript: null,
        polishedText: null,
        polished: false,
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
      });
    }),
    DictationDataGet: jest.fn(async (jobId: string) => jobs.get(jobId) ?? null),
    DictationDataUpdate: jest.fn(async (jobId: string, patch: any) => {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      Object.assign(job, patch);
      job.revision += 1;
      job.dateUpdated = stamp();
    }),
    DictationDataGetLatestByAttachment: jest.fn(
      async (attachmentId: string) =>
        [...jobs.values()]
          .filter((job) => job.attachmentId === attachmentId)
          .pop() ?? null,
    ),
  };
});
jest.mock("./TaskUpdates", () => ({
  recordTaskUpdate: jest.fn(),
}));
jest.mock("fs-extra");

const mockPathExists = (fs as any).pathExists as jest.Mock;
const mockRemove = (fs as any).remove as jest.Mock;
const mockData = jest.requireMock("../dictation/DictationData") as any;

import { Config } from "../Config";
import {
  TaskVoiceCommentsCanConsumeRateLimit,
  TaskVoiceCommentsEnqueue,
  TaskVoiceCommentsGetLatest,
  TaskVoiceCommentsInit,
  TaskVoiceCommentsQueueCount,
  TaskVoiceCommentsRateLimitedUsers,
  TaskVoiceCommentsSweep,
} from "./TaskVoiceComments";
import {
  DictationPolishTranscript,
  DictationTranscribeAudio,
} from "../dictation/Dictation";
import { SttNoSpeechError } from "../dictation/SttWhisperCpp";
import { UsersDataGet } from "../users/UsersData";
import { TasksDataGet, addComment, TasksDataTouch } from "./TasksData";
import { recordTaskUpdate } from "./TaskUpdates";

const mockTranscribeAudio = DictationTranscribeAudio as jest.Mock;
const mockPolish = DictationPolishTranscript as jest.Mock;
const mockTasksDataGet = TasksDataGet as jest.Mock;
const mockAddComment = addComment as jest.Mock;
const mockTasksDataTouch = TasksDataTouch as jest.Mock;
const mockUsersDataGet = UsersDataGet as jest.Mock;
const mockRecordTaskUpdate = recordTaskUpdate as jest.Mock;

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
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

function enabledConfig(): Config {
  const config = new Config();
  config.DICTATION_ENABLED = true;
  config.STT_MODE = "external";
  config.STT_API_URL = "https://stt.test";
  config.STT_API_KEY = "stt-key";
  config.STT_MODEL = "whisper-test";
  config.DICTATION_LANGUAGE = "auto";
  config.RATE_LIMIT_DICTATION_MAX = 30;
  return config;
}

function voiceRequest(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-1",
    userId: "user-1",
    fileName: "voice-message.webm",
    filePath: "/data/attachments/tasks/att-1.webm",
    mimeType: "audio/webm",
    attachmentId: "att-1",
    ...overrides,
  };
}

describe("TaskVoiceComments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockData.__reset();
    mockPathExists.mockResolvedValue(true);
    mockRemove.mockResolvedValue(undefined);
    mockTranscribeAudio.mockResolvedValue({
      text: "raw words",
      audioDurationMs: 1200,
      threads: 0,
      sttMs: 5,
    });
    mockPolish.mockResolvedValue({ polishedText: "Polished text", polished: true });
    mockTasksDataGet.mockResolvedValue({ id: "task-1", comments: [] });
    mockUsersDataGet.mockResolvedValue({ name: "Alice" });
  });

  // Runs before any other test: the module state is still uninitialized
  it("should be a no-op before initialization", async () => {
    await expect(TaskVoiceCommentsEnqueue(voiceRequest())).resolves.toEqual({
      queued: false,
      rateLimited: false,
    });
    await flush();
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
    expect(mockAddComment).not.toHaveBeenCalled();
  });

  describe("with the feature initialized", () => {
    beforeEach(async () => {
      await TaskVoiceCommentsInit(enabledConfig());
    });

    it("should persist a job and post the polished transcript as a comment", async () => {
      const result = await TaskVoiceCommentsEnqueue(
        voiceRequest({ userName: "Alice", requestedLanguage: "en" }),
      );
      await flush();

      expect(result).toEqual({
        queued: true,
        rateLimited: false,
        jobId: expect.any(String),
      });
      expect(mockTranscribeAudio).toHaveBeenCalledWith(
        "/data/attachments/tasks/att-1.webm",
        "audio/webm",
        "en",
      );
      expect(mockPolish).toHaveBeenCalledWith("raw words", "en");
      expect(mockAddComment).toHaveBeenCalledTimes(1);
      const [taskId, comment] = mockAddComment.mock.calls[0];
      expect(taskId).toBe("task-1");
      expect(comment.userId).toBe("user-1");
      expect(comment.userName).toBe("Alice");
      expect(comment.text).toBe(
        "**Voice message transcript** (voice-message.webm):\n\nPolished text",
      );
      expect(comment.id).toBeDefined();
      expect(comment.dateCreated).toBeDefined();
      expect(mockTasksDataTouch).toHaveBeenCalledWith("task-1");
      // Same activity entry and assignee push as a normally posted comment
      expect(mockRecordTaskUpdate).toHaveBeenCalledWith(
        "task-1",
        "user-1",
        "New comment",
      );

      const job = mockData.__jobs.get(result.jobId);
      expect(job).toMatchObject({
        source: "voice_comment",
        taskId: "task-1",
        attachmentId: "att-1",
        status: "done",
        stage: null,
        rawTranscript: "raw words",
        polishedText: "Polished text",
        polished: true,
        commentId: comment.id,
        language: "en",
      });
    });

    it("should resolve the user name from the data layer when not provided", async () => {
      await TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockUsersDataGet).toHaveBeenCalledWith("user-1");
      expect(mockAddComment.mock.calls[0][1].userName).toBe("Alice");
    });

    it("should not post a duplicate transcript comment on resume", async () => {
      mockTasksDataGet.mockResolvedValue({
        id: "task-1",
        comments: [
          {
            id: "existing-comment",
            text: "**Voice message transcript** (voice-message.webm):\n\nOld",
          },
        ],
      });
      await TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockAddComment).not.toHaveBeenCalled();
    });

    it("should normalize the language against the server default", async () => {
      const config = enabledConfig();
      config.DICTATION_LANGUAGE = "fr";
      await TaskVoiceCommentsInit(config);

      await TaskVoiceCommentsEnqueue(
        voiceRequest({ fileName: "1.webm", attachmentId: "att-lang-1" }),
      );
      await flush();
      expect(mockTranscribeAudio).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        "fr",
      );

      await TaskVoiceCommentsEnqueue(
        voiceRequest({
          fileName: "2.webm",
          attachmentId: "att-lang-2",
          requestedLanguage: "auto",
        }),
      );
      await flush();
      expect(mockTranscribeAudio).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        null,
      );
    });

    it("should not transcribe when dictation is disabled", async () => {
      const config = enabledConfig();
      config.DICTATION_ENABLED = false;
      await TaskVoiceCommentsInit(config);

      const result = await TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(result).toEqual({ queued: false, rateLimited: false });
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
      expect(mockAddComment).not.toHaveBeenCalled();
    });

    it("should not transcribe when STT is not configured", async () => {
      const external = enabledConfig();
      external.STT_API_URL = "";
      await TaskVoiceCommentsInit(external);
      await TaskVoiceCommentsEnqueue(voiceRequest({ userId: "user-ext" }));
      await flush();
      expect(mockTranscribeAudio).not.toHaveBeenCalled();

      const embedded = enabledConfig();
      embedded.STT_MODE = "embedded";
      embedded.STT_EMBEDDED_MODEL = "";
      await TaskVoiceCommentsInit(embedded);
      await TaskVoiceCommentsEnqueue(voiceRequest({ userId: "user-emb" }));
      await flush();
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });

    it("should ignore non-audio mimetypes", async () => {
      const result = await TaskVoiceCommentsEnqueue(
        voiceRequest({ mimeType: "application/pdf" }),
      );
      await flush();

      expect(result).toEqual({ queued: false, rateLimited: false });
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
      expect(mockAddComment).not.toHaveBeenCalled();
    });

    it("should report a failed transcription and never delete the audio file", async () => {
      mockTranscribeAudio.mockRejectedValue(new Error("STT upstream down"));
      const result = await TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(result.queued).toBe(true);
      expect(mockAddComment).not.toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
      expect(mockData.__jobs.get(result.jobId)).toMatchObject({
        status: "error",
        error: "Transcription failed, please try again.",
      });
    });

    it("should map a no-speech failure to a dedicated message", async () => {
      mockTranscribeAudio.mockRejectedValue(new SttNoSpeechError());
      const result = await TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockData.__jobs.get(result.jobId)).toMatchObject({
        status: "error",
        error: "No speech detected, please try again.",
      });
    });

    it("should not post a comment when the transcript is empty", async () => {
      mockTranscribeAudio.mockResolvedValue({
        text: "   ",
        audioDurationMs: null,
        threads: 0,
        sttMs: 1,
      });
      mockPolish.mockResolvedValue({ polishedText: "   ", polished: true });
      const result = await TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockAddComment).not.toHaveBeenCalled();
      expect(mockData.__jobs.get(result.jobId)).toMatchObject({
        status: "error",
        error: "No speech detected, please try again.",
      });
    });

    it("should drop the transcript when the task is gone before the job runs", async () => {
      mockTasksDataGet.mockResolvedValue(null);
      const result = await TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockTranscribeAudio).not.toHaveBeenCalled();
      expect(mockAddComment).not.toHaveBeenCalled();
      expect(mockData.__jobs.get(result.jobId)).toMatchObject({
        status: "error",
        error: "Task Not Found",
      });
    });

    it("should drop the transcript when the audio file is gone", async () => {
      mockPathExists.mockResolvedValue(false);
      const result = await TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockTranscribeAudio).not.toHaveBeenCalled();
      expect(mockAddComment).not.toHaveBeenCalled();
      expect(mockData.__jobs.get(result.jobId)).toMatchObject({
        status: "error",
        error: "Audio file not found",
      });
    });

    it("should run the jobs of one user sequentially", async () => {
      const first = deferred();
      const second = deferred();
      mockTranscribeAudio
        .mockReturnValueOnce(first.promise as never)
        .mockReturnValueOnce(second.promise as never);

      await TaskVoiceCommentsEnqueue(
        voiceRequest({ fileName: "first.webm", attachmentId: "att-seq-1" }),
      );
      await TaskVoiceCommentsEnqueue(
        voiceRequest({ fileName: "second.webm", attachmentId: "att-seq-2" }),
      );
      await flush();
      expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);

      first.resolve({
        text: "a",
        audioDurationMs: null,
        threads: 0,
        sttMs: 1,
      });
      await flush();
      expect(mockTranscribeAudio).toHaveBeenCalledTimes(2);

      second.resolve({
        text: "b",
        audioDurationMs: null,
        threads: 0,
        sttMs: 1,
      });
      await flush();
      expect(mockAddComment).toHaveBeenCalledTimes(2);
      expect(mockAddComment.mock.calls[0][1].text).toContain("(first.webm)");
      expect(mockAddComment.mock.calls[1][1].text).toContain("(second.webm)");
    });

    it("should run the jobs of different users in parallel", async () => {
      const first = deferred();
      const second = deferred();
      mockTranscribeAudio
        .mockReturnValueOnce(first.promise as never)
        .mockReturnValueOnce(second.promise as never);

      await TaskVoiceCommentsEnqueue(
        voiceRequest({ userId: "user-a", attachmentId: "att-par-a" }),
      );
      await TaskVoiceCommentsEnqueue(
        voiceRequest({ userId: "user-b", attachmentId: "att-par-b" }),
      );
      await flush();
      expect(mockTranscribeAudio).toHaveBeenCalledTimes(2);

      first.resolve({ text: "a", audioDurationMs: null, threads: 0, sttMs: 1 });
      second.resolve({ text: "b", audioDurationMs: null, threads: 0, sttMs: 1 });
      await flush();
      expect(mockAddComment).toHaveBeenCalledTimes(2);
    });

    it("should report and skip transcriptions beyond the hourly rate limit", async () => {
      const config = enabledConfig();
      config.RATE_LIMIT_DICTATION_MAX = 2;
      await TaskVoiceCommentsInit(config);

      await expect(
        TaskVoiceCommentsEnqueue(
          voiceRequest({ userId: "rate-user", fileName: "1.webm" }),
        ),
      ).resolves.toMatchObject({ queued: true, rateLimited: false });
      await expect(
        TaskVoiceCommentsEnqueue(
          voiceRequest({ userId: "rate-user", fileName: "2.webm" }),
        ),
      ).resolves.toMatchObject({ queued: true, rateLimited: false });
      // The slot is consumed at enqueue time so the caller can report the skip
      await expect(
        TaskVoiceCommentsEnqueue(
          voiceRequest({ userId: "rate-user", fileName: "3.webm" }),
        ),
      ).resolves.toEqual({ queued: false, rateLimited: true });
      await flush();

      expect(mockTranscribeAudio).toHaveBeenCalledTimes(2);
      expect(mockAddComment).toHaveBeenCalledTimes(2);
      expect(TaskVoiceCommentsCanConsumeRateLimit("rate-user")).toBe(false);
    });

    it("should drop the user queue entry once the jobs settled", async () => {
      await TaskVoiceCommentsEnqueue(voiceRequest({ userId: "queue-user" }));
      await flush();

      expect(TaskVoiceCommentsQueueCount()).toBe(0);
    });

    it("should drop the user queue entry after a failing job", async () => {
      mockTranscribeAudio.mockRejectedValueOnce(new Error("STT down"));
      await TaskVoiceCommentsEnqueue(voiceRequest({ userId: "queue-fail-user" }));
      await flush();

      expect(TaskVoiceCommentsQueueCount()).toBe(0);
    });

    it("should sweep expired rate-limit entries while keeping fresh ones", async () => {
      const config = enabledConfig();
      config.RATE_LIMIT_DICTATION_MAX = 1;
      await TaskVoiceCommentsInit(config);

      const windowMs = 60 * 60 * 1000;
      const base = Date.now() - 3 * windowMs;
      const dateSpy = jest.spyOn(Date, "now").mockReturnValue(base);

      const usersBefore = TaskVoiceCommentsRateLimitedUsers();
      await TaskVoiceCommentsEnqueue(
        voiceRequest({ userId: "sweep-old", attachmentId: "att-sweep-old" }),
      );
      await flush();

      dateSpy.mockReturnValue(base + windowMs + 1000);
      await TaskVoiceCommentsEnqueue(
        voiceRequest({ userId: "sweep-fresh", attachmentId: "att-sweep-new" }),
      );
      await flush();
      expect(TaskVoiceCommentsRateLimitedUsers()).toBe(usersBefore + 2);

      expect(TaskVoiceCommentsSweep(base + windowMs + 1000)).toBe(1);
      expect(TaskVoiceCommentsRateLimitedUsers()).toBe(usersBefore + 1);

      // The fresh entry still enforces the hourly limit for that user
      await TaskVoiceCommentsEnqueue(
        voiceRequest({ userId: "sweep-fresh", attachmentId: "att-sweep-3" }),
      );
      await flush();
      expect(mockTranscribeAudio).toHaveBeenCalledTimes(2);

      dateSpy.mockRestore();
    });

    it("should expose the latest transcription status of an attachment", async () => {
      const result = await TaskVoiceCommentsEnqueue(
        voiceRequest({ attachmentId: "att-status" }),
      );
      await flush();

      expect(await TaskVoiceCommentsGetLatest("att-status")).toMatchObject({
        attachmentId: "att-status",
        status: "done",
        stage: null,
        error: null,
      });
      expect(
        await TaskVoiceCommentsGetLatest("att-status"),
      ).toMatchObject({ status: "done" });
      expect(result.jobId).toBeDefined();
      expect(await TaskVoiceCommentsGetLatest("att-unknown")).toBeNull();
    });
  });
});
