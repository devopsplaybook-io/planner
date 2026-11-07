import Fastify, { FastifyInstance } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { Config } from "../Config";
import { DictationRoutes } from "./DictationRoutes";
import {
  AuthGetUserSession,
  AuthMustBeAuthenticated,
  AuthRateLimitKey,
} from "../users/Auth";
import { UsersDataGet } from "../users/UsersData";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { isProjectVisible } from "../projects/ProjectVisibility";
import { DictationDataGetForUser } from "./DictationData";
import {
  BuildActionPreviews,
  LoadDictationResolutionContext,
} from "./DictationResolution";
import {
  ApplyDictationActions,
  NormalizeActionSelections,
  ParseStoredActions,
  UndoDictationActions,
} from "./DictationActionApply";
import { DictationActionDataListForJob } from "./DictationActionData";
import { DictationAskQuestion } from "./DictationAsk";

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
  AuthRateLimitKey: jest.fn(() => "user:test"),
}));

jest.mock("./Dictation", () => ({
  DictationStartJob: jest.fn(),
  DictationGetJob: jest.fn(),
  DictationGetInFlightJobId: jest.fn(() => null),
  DictationGetRecentJobs: jest.fn(async () => []),
  DictationWaitForJob: jest.fn(),
}));

jest.mock("../users/UsersData", () => ({
  UsersDataGet: jest.fn(),
  UsersDataSetDictationTargetLanguage: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

jest.mock("../projects/ProjectVisibility", () => ({
  isProjectVisible: jest.fn(() => true),
}));

jest.mock("./DictationVocabularyData", () => ({
  DictationVocabularyResolveForPrompt: jest.fn(async () => []),
}));

jest.mock("./DictationData", () => ({
  DictationDataGetForUser: jest.fn(),
}));

jest.mock("./DictationResolution", () => ({
  LoadDictationResolutionContext: jest.fn(async () => ({})),
  BuildActionPreviews: jest.fn(() => []),
}));

jest.mock("./DictationActionApply", () => ({
  ApplyDictationActions: jest.fn(),
  NormalizeActionSelections: jest.fn(() => []),
  ParseStoredActions: jest.fn(() => []),
  UndoDictationActions: jest.fn(),
}));

jest.mock("./DictationActionData", () => ({
  DictationActionDataListForJob: jest.fn(async () => []),
}));

jest.mock("./DictationAsk", () => ({
  DICTATION_ASK_QUESTION_MAX_LENGTH: 500,
  DictationAskQuestion: jest.fn(),
}));

jest.mock("fs-extra", () => ({
  ensureDir: jest.fn(async () => undefined),
  remove: jest.fn(async () => undefined),
  createWriteStream: jest.fn(),
}));

const mockGetForUser = DictationDataGetForUser as jest.Mock;
const mockPreviews = BuildActionPreviews as jest.Mock;
const mockLoadContext = LoadDictationResolutionContext as jest.Mock;
const mockParseStored = ParseStoredActions as jest.Mock;
const mockNormalizeSelections = NormalizeActionSelections as jest.Mock;
const mockApply = ApplyDictationActions as jest.Mock;
const mockUndo = UndoDictationActions as jest.Mock;
const mockListForJob = DictationActionDataListForJob as jest.Mock;
const mockAsk = DictationAskQuestion as jest.Mock;

const userSession = {
  isAuthenticated: true,
  userId: "user-1",
  userName: "User",
  role: "user" as const,
};

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    userId: "user-1",
    source: "dictation",
    status: "done",
    actions: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("DictationRoutes structured actions and ask", () => {
  let app: FastifyInstance;
  let config: Config;

  beforeAll(async () => {
    config = new Config();
    config.DICTATION_ENABLED = true;
    config.RATE_LIMIT_DICTATION_ASK_MAX = 100;
    app = Fastify();
    await app.register(fastifyRateLimit, { global: false });
    await new DictationRoutes(config).getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (AuthMustBeAuthenticated as jest.Mock).mockResolvedValue(undefined);
    (AuthRateLimitKey as jest.Mock).mockReturnValue("user:test");
    (UsersDataGet as jest.Mock).mockResolvedValue(null);
    (ProjectsDataGet as jest.Mock).mockResolvedValue({ id: "proj-1" });
    (isProjectVisible as jest.Mock).mockReturnValue(true);
    mockGetForUser.mockResolvedValue(makeJob());
    mockParseStored.mockReturnValue([{ type: "create_task", title: "A" }]);
    mockPreviews.mockReturnValue([
      {
        index: 0,
        type: "create_task",
        status: "resolved",
        action: { type: "create_task", title: "A" },
        candidates: [],
        diff: [],
        target: null,
      },
    ]);
    mockListForJob.mockResolvedValue([]);
    mockNormalizeSelections.mockReturnValue([{ index: 0 }]);
    mockApply.mockResolvedValue({
      requestId: "req-1",
      alreadyApplied: false,
      results: [{ index: 0, type: "create_task", status: "applied", targetId: "task-1" }],
    });
    mockUndo.mockResolvedValue({ requestId: "req-1", results: [] });
    mockAsk.mockResolvedValue({
      intent: "due_today",
      answer: "1 open task is due today.",
      items: [],
      truncated: false,
      generatedBy: "deterministic",
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 401 on every action endpoint without a session", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/job-1/actions/preview",
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/job-1/actions" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/job-1/actions/apply",
          payload: { selections: [{ index: 0 }] },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/job-1/actions/undo",
          payload: { requestId: "req-1" },
        })
      ).statusCode,
    ).toBe(401);
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it("should answer 404 when the job is not owned or expired", async () => {
    mockGetForUser.mockResolvedValue(null);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/job-1/actions/preview",
        })
      ).statusCode,
    ).toBe(404);

    mockGetForUser.mockResolvedValue(
      makeJob({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    );
    const expired = await app.inject({
      method: "GET",
      url: "/job-1/actions",
    });
    expect(expired.statusCode).toBe(404);
    expect(mockGetForUser).toHaveBeenCalledWith("user-1", "job-1");
  });

  it("should preview the stored actions against visible data", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/job-1/actions/preview",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      jobId: "job-1",
      actions: [
        {
          index: 0,
          type: "create_task",
          status: "resolved",
          action: { type: "create_task", title: "A" },
          candidates: [],
          diff: [],
          target: null,
        },
      ],
    });
    expect(mockLoadContext).toHaveBeenCalledWith(userSession);
    expect(mockPreviews).toHaveBeenCalledWith(
      [{ type: "create_task", title: "A" }],
      {},
    );
  });

  it("should group applied actions by requestId without snapshots", async () => {
    mockListForJob.mockResolvedValue([
      {
        requestId: "req-1",
        actionIndex: 0,
        type: "create_task",
        status: "applied",
        targetId: "task-1",
        targetType: "task",
        undoneAt: null,
        error: null,
        dateCreated: "2026-01-01T00:00:00.000Z",
        beforeJson: '{"kind":"created"}',
      },
      {
        requestId: "req-2",
        actionIndex: 1,
        type: "update_task",
        status: "failed",
        targetId: null,
        targetType: null,
        undoneAt: null,
        error: "Task Not Found",
        dateCreated: "2026-01-02T00:00:00.000Z",
        beforeJson: null,
      },
    ]);
    const res = await app.inject({ method: "GET", url: "/job-1/actions" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      jobId: "job-1",
      batches: [
        {
          requestId: "req-1",
          dateCreated: "2026-01-01T00:00:00.000Z",
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
        {
          requestId: "req-2",
          dateCreated: "2026-01-02T00:00:00.000Z",
          actions: [
            {
              index: 1,
              type: "update_task",
              status: "failed",
              targetId: null,
              targetType: null,
              undoneAt: null,
              error: "Task Not Found",
            },
          ],
        },
      ],
    });
    expect(res.body).not.toContain("beforeJson");
  });

  it("should apply the allowlisted selections with the supplied requestId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/job-1/actions/apply",
      payload: {
        requestId: "req-1",
        selections: [{ index: 0, projectId: "proj-1" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockNormalizeSelections).toHaveBeenCalledWith([
      { index: 0, projectId: "proj-1" },
    ]);
    expect(mockApply).toHaveBeenCalledWith(
      userSession,
      expect.objectContaining({ id: "job-1" }),
      "req-1",
      [{ index: 0 }],
    );
    expect(res.json()).toEqual({
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
    });
  });

  it("should generate a requestId when the client omits it", async () => {
    mockApply.mockResolvedValue({
      requestId: "generated",
      alreadyApplied: false,
      results: [],
    });
    const res = await app.inject({
      method: "POST",
      url: "/job-1/actions/apply",
      payload: { selections: [{ index: 0 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(mockApply).toHaveBeenCalledWith(
      userSession,
      expect.anything(),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      [{ index: 0 }],
    );
  });

  it("should reject an apply without valid selections", async () => {
    mockNormalizeSelections.mockReturnValue([]);
    const res = await app.inject({
      method: "POST",
      url: "/job-1/actions/apply",
      payload: { selections: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("should undo one applied batch", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/job-1/actions/undo",
      payload: { requestId: "req-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUndo).toHaveBeenCalledWith(userSession, "job-1", "req-1");
  });

  it("should reject an undo without requestId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/job-1/actions/undo",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it("should answer a read-only question", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ask",
      payload: { question: "What is due today?", projectId: "proj-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockAsk).toHaveBeenCalledWith(
      config,
      userSession,
      "What is due today?",
      "proj-1",
    );
    expect(res.json()).toEqual({
      intent: "due_today",
      answer: "1 open task is due today.",
      items: [],
      truncated: false,
      generatedBy: "deterministic",
    });
  });

  it("should reject an invalid ask request", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/ask",
          payload: { question: "   " },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/ask",
          payload: { question: "x".repeat(501) },
        })
      ).statusCode,
    ).toBe(400);
    (isProjectVisible as jest.Mock).mockReturnValue(false);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/ask",
          payload: { question: "Summary", projectId: "proj-1" },
        })
      ).statusCode,
    ).toBe(404);
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it("should answer 404 when dictation is disabled", async () => {
    config.DICTATION_ENABLED = false;
    const res = await app.inject({
      method: "POST",
      url: "/ask",
      payload: { question: "What is due today?" },
    });
    expect(res.statusCode).toBe(404);
    expect(mockAsk).not.toHaveBeenCalled();
    config.DICTATION_ENABLED = true;
  });
});
