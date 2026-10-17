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
  DictationTranscribeAndPolish: jest.fn(),
}));
jest.mock("fs-extra");

const mockPathExists = (fs as any).pathExists as jest.Mock;
const mockRemove = (fs as any).remove as jest.Mock;

import { Config } from "../Config";
import {
  TaskVoiceCommentsEnqueue,
  TaskVoiceCommentsInit,
} from "./TaskVoiceComments";
import { DictationTranscribeAndPolish } from "../dictation/Dictation";
import { UsersDataGet } from "../users/UsersData";
import { TasksDataGet, addComment, TasksDataTouch } from "./TasksData";

const mockTranscribeAndPolish = DictationTranscribeAndPolish as jest.Mock;
const mockTasksDataGet = TasksDataGet as jest.Mock;
const mockAddComment = addComment as jest.Mock;
const mockTasksDataTouch = TasksDataTouch as jest.Mock;
const mockUsersDataGet = UsersDataGet as jest.Mock;

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
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
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
    ...overrides,
  };
}

describe("TaskVoiceComments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathExists.mockResolvedValue(true);
    mockRemove.mockResolvedValue(undefined);
  });

  // Runs before any other test: the module state is still uninitialized
  it("should be a no-op before initialization", async () => {
    TaskVoiceCommentsEnqueue(voiceRequest());
    await flush();
    expect(mockTranscribeAndPolish).not.toHaveBeenCalled();
    expect(mockAddComment).not.toHaveBeenCalled();
  });

  describe("with the feature initialized", () => {
    beforeEach(async () => {
      await TaskVoiceCommentsInit(enabledConfig());
      mockTranscribeAndPolish.mockResolvedValue({
        rawTranscript: "raw words",
        polishedText: "Polished text",
      });
      mockTasksDataGet.mockResolvedValue({ id: "task-1" });
    });

    it("should post the polished transcript as a comment attributed to the uploader", async () => {
      TaskVoiceCommentsEnqueue(
        voiceRequest({ userName: "Alice", requestedLanguage: "en" }),
      );
      await flush();

      expect(mockTranscribeAndPolish).toHaveBeenCalledWith(
        "/data/attachments/tasks/att-1.webm",
        "audio/webm",
        "en",
      );
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
    });

    it("should resolve the user name from the data layer when not provided", async () => {
      mockUsersDataGet.mockResolvedValue({ name: "Alice" });
      TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockUsersDataGet).toHaveBeenCalledWith("user-1");
      expect(mockAddComment.mock.calls[0][1].userName).toBe("Alice");
    });

    it("should normalize the language against the server default", async () => {
      const config = enabledConfig();
      config.DICTATION_LANGUAGE = "fr";
      await TaskVoiceCommentsInit(config);

      TaskVoiceCommentsEnqueue(voiceRequest({ fileName: "1.webm" }));
      await flush();
      expect(mockTranscribeAndPolish).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        "fr",
      );

      TaskVoiceCommentsEnqueue(
        voiceRequest({ fileName: "2.webm", requestedLanguage: "auto" }),
      );
      await flush();
      expect(mockTranscribeAndPolish).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        null,
      );
    });

    it("should not transcribe when dictation is disabled", async () => {
      const config = enabledConfig();
      config.DICTATION_ENABLED = false;
      await TaskVoiceCommentsInit(config);

      TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockTranscribeAndPolish).not.toHaveBeenCalled();
      expect(mockAddComment).not.toHaveBeenCalled();
    });

    it("should not transcribe when STT is not configured", async () => {
      const external = enabledConfig();
      external.STT_API_URL = "";
      await TaskVoiceCommentsInit(external);
      TaskVoiceCommentsEnqueue(voiceRequest({ userId: "user-ext" }));
      await flush();
      expect(mockTranscribeAndPolish).not.toHaveBeenCalled();

      const embedded = enabledConfig();
      embedded.STT_MODE = "embedded";
      embedded.STT_EMBEDDED_MODEL = "";
      await TaskVoiceCommentsInit(embedded);
      TaskVoiceCommentsEnqueue(voiceRequest({ userId: "user-emb" }));
      await flush();
      expect(mockTranscribeAndPolish).not.toHaveBeenCalled();
    });

    it("should ignore non-audio mimetypes", async () => {
      TaskVoiceCommentsEnqueue(voiceRequest({ mimeType: "application/pdf" }));
      await flush();

      expect(mockTranscribeAndPolish).not.toHaveBeenCalled();
      expect(mockAddComment).not.toHaveBeenCalled();
    });

    it("should never delete the attachment audio file, even on failure", async () => {
      mockTranscribeAndPolish.mockRejectedValue(new Error("STT upstream down"));
      TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockAddComment).not.toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("should not post a comment when the transcript is empty", async () => {
      mockTranscribeAndPolish.mockResolvedValue({
        rawTranscript: "",
        polishedText: "   ",
      });
      TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockAddComment).not.toHaveBeenCalled();
    });

    it("should drop the transcript when the task is gone before the job runs", async () => {
      mockTasksDataGet.mockResolvedValue(null);
      TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockTranscribeAndPolish).not.toHaveBeenCalled();
      expect(mockAddComment).not.toHaveBeenCalled();
    });

    it("should drop the transcript when the audio file is gone", async () => {
      mockPathExists.mockResolvedValue(false);
      TaskVoiceCommentsEnqueue(voiceRequest());
      await flush();

      expect(mockTranscribeAndPolish).not.toHaveBeenCalled();
      expect(mockAddComment).not.toHaveBeenCalled();
    });

    it("should run the jobs of one user sequentially", async () => {
      const first = deferred();
      const second = deferred();
      mockTranscribeAndPolish
        .mockReturnValueOnce(first.promise as never)
        .mockReturnValueOnce(second.promise as never);

      TaskVoiceCommentsEnqueue(voiceRequest({ fileName: "first.webm" }));
      TaskVoiceCommentsEnqueue(voiceRequest({ fileName: "second.webm" }));
      await flush();
      expect(mockTranscribeAndPolish).toHaveBeenCalledTimes(1);

      first.resolve({ rawTranscript: "a", polishedText: "A" });
      await flush();
      expect(mockTranscribeAndPolish).toHaveBeenCalledTimes(2);

      second.resolve({ rawTranscript: "b", polishedText: "B" });
      await flush();
      expect(mockAddComment).toHaveBeenCalledTimes(2);
      expect(mockAddComment.mock.calls[0][1].text).toContain("(first.webm)");
      expect(mockAddComment.mock.calls[1][1].text).toContain("(second.webm)");
    });

    it("should run the jobs of different users in parallel", async () => {
      const first = deferred();
      const second = deferred();
      mockTranscribeAndPolish
        .mockReturnValueOnce(first.promise as never)
        .mockReturnValueOnce(second.promise as never);

      TaskVoiceCommentsEnqueue(voiceRequest({ userId: "user-a" }));
      TaskVoiceCommentsEnqueue(voiceRequest({ userId: "user-b" }));
      await flush();
      expect(mockTranscribeAndPolish).toHaveBeenCalledTimes(2);

      first.resolve({ rawTranscript: "a", polishedText: "A" });
      second.resolve({ rawTranscript: "b", polishedText: "B" });
      await flush();
      expect(mockAddComment).toHaveBeenCalledTimes(2);
    });

    it("should skip transcriptions beyond the hourly rate limit", async () => {
      const config = enabledConfig();
      config.RATE_LIMIT_DICTATION_MAX = 2;
      await TaskVoiceCommentsInit(config);

      TaskVoiceCommentsEnqueue(voiceRequest({ userId: "rate-user", fileName: "1.webm" }));
      TaskVoiceCommentsEnqueue(voiceRequest({ userId: "rate-user", fileName: "2.webm" }));
      TaskVoiceCommentsEnqueue(voiceRequest({ userId: "rate-user", fileName: "3.webm" }));
      await flush();

      expect(mockTranscribeAndPolish).toHaveBeenCalledTimes(2);
      expect(mockAddComment).toHaveBeenCalledTimes(2);
    });
  });
});
