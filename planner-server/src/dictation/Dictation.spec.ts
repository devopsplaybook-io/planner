import axios from "axios";
import * as fs from "fs-extra";

jest.mock("axios");
jest.mock("fs-extra");

const mockAxios = axios as jest.Mocked<typeof axios>;
const mockReadFile = (fs as any).readFile as jest.Mock;
const mockRemove = (fs as any).remove as jest.Mock;

import {
  DictationGetInFlightJobId,
  DictationGetJob,
  DictationInit,
  DictationStartJob,
  DictationSweepExpiredJobs,
} from "./Dictation";
import { Config } from "../Config";

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

const sttResponse = (text: string) => ({ data: { text } });
const llmResponse = (content: string) => ({
  data: { choices: [{ message: { content } }] },
});

describe("Dictation pipeline", () => {
  beforeEach(async () => {
    mockReadFile.mockResolvedValue(Buffer.from("fake audio"));
    mockRemove.mockResolvedValue(undefined);
    // Default LLM answer for calls not explicitly queued in a test
    mockAxios.post.mockResolvedValue(
      llmResponse('{"text": "Hi"}') as never,
    );

    const config = new Config();
    config.DICTATION_ENABLED = true;
    config.STT_API_URL = "https://stt.test";
    config.STT_API_KEY = "stt-key";
    config.STT_MODEL = "whisper-test";
    config.LLM_API_KEY = "llm-key";
    config.LLM_API_URL = "https://llm.test/chat";
    config.LLM_MODEL = "llm-test";
    await DictationInit(config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  function queueStt(deferral: { promise: Promise<unknown> }) {
    mockAxios.post.mockImplementationOnce(() => deferral.promise as never);
  }

  it("should run the three stages and return the polished result with actions", async () => {
    const stt = deferred();
    const polish = deferred();
    const actions = deferred();
    queueStt(stt);
    mockAxios.post.mockImplementationOnce(() => polish.promise as never);
    mockAxios.post.mockImplementationOnce(() => actions.promise as never);

    const jobId = DictationStartJob("user-1", "/tmp/dictation/a1.audio", "audio/webm", "en");

    let view = DictationGetJob("user-1", jobId);
    expect(view).toMatchObject({ status: "processing", stage: "transcribing" });

    stt.resolve(sttResponse("hello world"));
    await flush();
    view = DictationGetJob("user-1", jobId);
    expect(view).toMatchObject({ status: "processing", stage: "polishing" });

    polish.resolve(llmResponse('{"text": "Hello world!"}'));
    await flush();
    view = DictationGetJob("user-1", jobId);
    expect(view).toMatchObject({ status: "processing", stage: "actions" });

    actions.resolve(
      llmResponse(
        '{"actions": [{"type": "create_task", "title": "Greet", "description": "Say hi", "priority": "high"}]}',
      ),
    );
    await flush();

    view = DictationGetJob("user-1", jobId);
    expect(view).toEqual({
      jobId,
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
    });

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
    // LLM call shape
    expect(mockAxios.post.mock.calls[1][0]).toBe("https://llm.test/chat");
    expect(mockAxios.post.mock.calls[1][2]).toMatchObject({
      headers: { Authorization: "Bearer llm-key" },
    });

    // Single-flight cleared after completion
    expect(DictationGetInFlightJobId("user-1")).toBeNull();
  });

  it("should omit the STT language parameter in auto mode", async () => {
    const stt = deferred();
    queueStt(stt);
    mockAxios.post.mockResolvedValueOnce(llmResponse('{"text": "Hello"}') as never);
    mockAxios.post.mockResolvedValueOnce(llmResponse('{"actions": []}') as never);

    DictationStartJob("user-auto", "/tmp/dictation/a2.audio", "audio/webm", null);
    stt.resolve(sttResponse("hello"));
    await flush();

    const form = mockAxios.post.mock.calls[0][1] as FormData;
    expect(form.get("language")).toBeNull();
  });

  it("should surface an STT failure as an error job and delete the audio", async () => {
    const stt = deferred();
    queueStt(stt);

    const jobId = DictationStartJob("user-2", "/tmp/dictation/a3.audio", "audio/webm", null);
    stt.reject(Object.assign(new Error("upstream down"), { response: { status: 500 } }));
    await flush();

    expect(DictationGetJob("user-2", jobId)).toEqual({
      jobId,
      status: "error",
      stage: null,
      result: null,
      error: "Dictation failed, please try again",
    });
    expect(mockRemove).toHaveBeenCalledWith("/tmp/dictation/a3.audio");
    expect(DictationGetInFlightJobId("user-2")).toBeNull();
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

    const jobId = DictationStartJob("user-3", "/tmp/dictation/a4.audio", "audio/webm", null);
    stt.resolve(sttResponse("raw transcript here"));
    await flush();

    const view = DictationGetJob("user-3", jobId);
    expect(view).toMatchObject({
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

    const jobId = DictationStartJob("user-4", "/tmp/dictation/a5.audio", "audio/webm", null);
    stt.resolve(sttResponse("hello"));
    await flush();

    const view = DictationGetJob("user-4", jobId);
    expect(view).toMatchObject({
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

    const jobId = DictationStartJob("user-5", "/tmp/dictation/a6.audio", "audio/webm", null);
    stt.resolve(sttResponse("hello"));
    await flush();

    expect(DictationGetJob("user-5", jobId)).toMatchObject({
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

    const jobId = DictationStartJob("user-6", "/tmp/dictation/a7.audio", "audio/webm", null);
    expect(DictationGetInFlightJobId("user-6")).toBe(jobId);
    expect(DictationGetInFlightJobId("user-6")).toBe(jobId);

    stt.resolve(sttResponse("hello"));
    await flush();
    expect(DictationGetInFlightJobId("user-6")).toBeNull();
  });

  it("should never expose another user's job", async () => {
    const stt = deferred();
    queueStt(stt);

    const jobId = DictationStartJob("user-7", "/tmp/dictation/a8.audio", "audio/webm", null);
    expect(DictationGetJob("user-8", jobId)).toBeNull();
    expect(DictationGetJob("user-7", "unknown-job")).toBeNull();

    stt.resolve(sttResponse("hello"));
    await flush();
  });

  it("should expire jobs after the TTL", async () => {
    const stt = deferred();
    queueStt(stt);
    mockAxios.post.mockResolvedValue(llmResponse('{"text": "Hello"}') as never);
    mockAxios.post.mockResolvedValue(llmResponse('{"actions": []}') as never);

    const jobId = DictationStartJob("user-9", "/tmp/dictation/a9.audio", "audio/webm", null);
    stt.resolve(sttResponse("hello"));
    await flush();
    expect(DictationGetJob("user-9", jobId)).not.toBeNull();

    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 60 * 60 * 1000);
    expect(DictationSweepExpiredJobs()).toBeGreaterThanOrEqual(1);
    expect(DictationGetJob("user-9", jobId)).toBeNull();
  });
});
