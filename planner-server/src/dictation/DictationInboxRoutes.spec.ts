/* eslint-disable @typescript-eslint/no-explicit-any */
import Fastify, { FastifyInstance } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import {
  DictationInboxRoutes,
  InboxPreview,
  SplitChecklistItems,
} from "./DictationInboxRoutes";
import { AuthGetUserSession } from "../users/Auth";
import {
  DictationDataCountUnreadSince,
  DictationDataDelete,
  DictationDataGetForUser,
  DictationDataListInbox,
  DictationDataMarkConverted,
  DictationDataSetArchived,
  DictationJobRecord,
} from "./DictationData";
import { ProjectsDataGet } from "../projects/ProjectsData";
import {
  hasProjectPermission,
  isProjectItemVisible,
  isProjectVisible,
  projectMutationError,
} from "../projects/ProjectVisibility";
import {
  addComment,
  TasksDataAdd,
  TasksDataGet,
  TasksDataTouch,
  TasksDataUpdate,
} from "../tasks/TasksData";
import { NotesDataAdd } from "../notes/NotesData";
import { recordTaskUpdate } from "../tasks/TaskUpdates";
import * as fs from "fs-extra";

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
  AuthRateLimitKey: jest.fn(() => "user:test"),
}));

jest.mock("./DictationData", () => ({
  DictationDataGetForUser: jest.fn(),
  DictationDataListInbox: jest.fn(async () => ({ jobs: [], total: 0 })),
  DictationDataCountUnreadSince: jest.fn(async () => ({
    unread: 0,
    processing: 0,
  })),
  DictationDataSetArchived: jest.fn(async () => 1),
  DictationDataDelete: jest.fn(async () => 1),
  DictationDataMarkConverted: jest.fn(async () => undefined),
}));

jest.mock("./DictationTelemetry", () => ({
  DictationTelemetryRecordConversion: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

jest.mock("../projects/ProjectVisibility", () => ({
  isProjectVisible: jest.fn(() => true),
  hasProjectPermission: jest.fn(() => true),
  permissionDeniedMessage: jest.fn(() => "Permission denied"),
  projectMutationError: jest.fn(async () => null),
  isProjectItemVisible: jest.fn(async () => true),
}));

jest.mock("../tasks/TasksData", () => ({
  TasksDataAdd: jest.fn(async () => undefined),
  TasksDataGet: jest.fn(),
  TasksDataUpdate: jest.fn(async () => undefined),
  TasksDataTouch: jest.fn(async () => undefined),
  addComment: jest.fn(async () => undefined),
}));

jest.mock("../notes/NotesData", () => ({
  NotesDataAdd: jest.fn(async () => undefined),
}));

jest.mock("../tasks/TaskUpdates", () => ({
  recordTaskUpdate: jest.fn(async () => undefined),
}));

jest.mock("../users/UsersData", () => ({
  UsersDataGet: jest.fn(async () => ({ name: "User" })),
}));

jest.mock("fs-extra", () => ({
  remove: jest.fn(async () => undefined),
}));

const userSession = {
  isAuthenticated: true,
  userId: "user-1",
  userName: "User",
  role: "user" as const,
};

const project = {
  id: "project-1",
  name: "Project",
  visibility: "public",
  archived: false,
  statuses: ["Todo", "Done"],
};

function record(overrides: Partial<DictationJobRecord> = {}): DictationJobRecord {
  return {
    id: "job-1",
    userId: "user-1",
    source: "dictation",
    jobKind: "short",
    clientId: null,
    taskId: null,
    attachmentId: null,
    commentId: null,
    projectId: null,
    status: "done",
    stage: null,
    language: "en",
    targetLanguage: null,
    engine: "external",
    model: "whisper",
    rawTranscript: "hello **world**",
    polishedText: null,
    polished: false,
    segments: null,
    actions: [],
    actionsAvailable: false,
    error: null,
    audioDurationMs: 1000,
    queueMs: null,
    sttMs: null,
    polishMs: null,
    actionsMs: null,
    totalMs: null,
    revision: 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
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
    dateCreated: new Date().toISOString(),
    dateUpdated: new Date().toISOString(),
    ...overrides,
  };
}

describe("Dictation inbox helpers", () => {
  it("builds a plain bounded preview", () => {
    expect(InboxPreview(record({ rawTranscript: "# Title\n**hello**" }))).toBe(
      "Title hello",
    );
    expect(
      InboxPreview(record({ rawTranscript: "x".repeat(500) })),
    ).toHaveLength(200);
  });

  it("splits transcript lines into bounded checklist items", () => {
    expect(
      SplitChecklistItems("- one\n* two\n\n• three\nfour"),
    ).toEqual(["one", "two", "three", "four"]);
    expect(
      SplitChecklistItems(
        Array.from({ length: 40 }, (_, i) => `item ${i}`).join("\n"),
      ),
    ).toHaveLength(25);
    expect(SplitChecklistItems("   \n ")).toEqual([]);
  });
});

describe("DictationInboxRoutes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(fastifyRateLimit, { global: false });
    await new DictationInboxRoutes(1000).getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (DictationDataGetForUser as jest.Mock).mockResolvedValue(record());
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    (isProjectVisible as jest.Mock).mockReturnValue(true);
    (hasProjectPermission as jest.Mock).mockReturnValue(true);
    (isProjectItemVisible as jest.Mock).mockReturnValue(true);
    (projectMutationError as jest.Mock).mockResolvedValue(null);
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers 401 without a session", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(401);
  });

  it("lists a paginated inbox and rejects an unknown filter", async () => {
    (DictationDataListInbox as jest.Mock).mockResolvedValue({
      jobs: [record()],
      total: 3,
    });

    const res = await app.inject({
      method: "GET",
      url: "/?limit=1&offset=0&includeArchived=true",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      total: 3,
      hasMore: true,
      items: [
        {
          id: "job-1",
          preview: "hello world",
          progress: { segmentsDone: 0, segmentsTotal: 0, percent: 0 },
        },
      ],
    });
    expect(DictationDataListInbox).toHaveBeenCalledWith("user-1", {
      limit: 1,
      offset: 0,
      status: undefined,
      source: undefined,
      includeArchived: true,
    });

    const invalid = await app.inject({
      method: "GET",
      url: "/?status=nope",
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("reports unread and processing badge counts", async () => {
    (DictationDataCountUnreadSince as jest.Mock).mockResolvedValue({
      unread: 2,
      processing: 1,
    });
    const res = await app.inject({
      method: "GET",
      url: "/badge?since=2026-01-01T00:00:00.000Z",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unread: 2, processing: 1 });
  });

  it("archives and unarchives a job", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/job-1",
      payload: { archived: true },
    });
    expect(res.statusCode).toBe(200);
    expect(DictationDataSetArchived).toHaveBeenCalledWith(
      "job-1",
      "user-1",
      expect.any(String),
    );

    (DictationDataGetForUser as jest.Mock).mockResolvedValueOnce(null);
    const missing = await app.inject({
      method: "PATCH",
      url: "/missing",
      payload: { archived: true },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("refuses to delete a processing job and deletes a settled one", async () => {
    (DictationDataGetForUser as jest.Mock).mockResolvedValueOnce(
      record({ status: "processing", audioPath: "/data/a.wav" }),
    );
    const busy = await app.inject({ method: "DELETE", url: "/job-1" });
    expect(busy.statusCode).toBe(409);
    expect(DictationDataDelete).not.toHaveBeenCalled();

    (DictationDataGetForUser as jest.Mock).mockResolvedValueOnce(
      record({ audioPath: "/data/a.wav" }),
    );
    const res = await app.inject({ method: "DELETE", url: "/job-1" });
    expect(res.statusCode).toBe(200);
    expect(fs.remove).toHaveBeenCalledWith("/data/a.wav");
    expect(DictationDataDelete).toHaveBeenCalledWith("job-1", "user-1");
  });

  it("converts to a task with the project default status", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/job-1/convert",
      payload: { target: "task", projectId: "project-1" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type: "task" });
    const task = (TasksDataAdd as jest.Mock).mock.calls[0][0];
    expect(task).toMatchObject({
      projectId: "project-1",
      title: "hello **world**",
      description: "hello **world**",
      status: "Todo",
    });
    expect(recordTaskUpdate).toHaveBeenCalled();
    expect(DictationDataMarkConverted).toHaveBeenCalledWith(
      "job-1",
      "task",
      task.id,
    );
  });

  it("refuses a project the user cannot update", async () => {
    (hasProjectPermission as jest.Mock).mockReturnValue(false);
    const res = await app.inject({
      method: "POST",
      url: "/job-1/convert",
      payload: { target: "note", projectId: "project-1" },
    });
    expect(res.statusCode).toBe(403);
    expect(NotesDataAdd).not.toHaveBeenCalled();
  });

  it("converts to a note", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/job-1/convert",
      payload: {
        target: "note",
        projectId: "project-1",
        title: "My note",
        text: "Body",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(NotesDataAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        title: "My note",
        description: "Body",
      }),
    );
  });

  it("converts to a comment on a task", async () => {
    (TasksDataGet as jest.Mock).mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      checklist: [],
    });
    const res = await app.inject({
      method: "POST",
      url: "/job-1/convert",
      payload: { target: "comment", taskId: "task-1", text: "Nice work" },
    });
    expect(res.statusCode).toBe(201);
    expect(addComment).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ text: "Nice work", userId: "user-1" }),
    );
    expect(TasksDataTouch).toHaveBeenCalledWith("task-1");
  });

  it("appends checklist items to a task", async () => {
    (TasksDataGet as jest.Mock).mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      checklist: [{ text: "existing", done: true }],
    });
    const res = await app.inject({
      method: "POST",
      url: "/job-1/convert",
      payload: { target: "checklist", taskId: "task-1", text: "one\ntwo" },
    });
    expect(res.statusCode).toBe(201);
    const task = (TasksDataUpdate as jest.Mock).mock.calls[0][0];
    expect(task.checklist).toEqual([
      { text: "existing", done: true },
      { text: "one", done: false },
      { text: "two", done: false },
    ]);
  });

  it("requires a settled job and an unconverted one", async () => {
    (DictationDataGetForUser as jest.Mock).mockResolvedValueOnce(
      record({ status: "processing" }),
    );
    const busy = await app.inject({
      method: "POST",
      url: "/job-1/convert",
      payload: { target: "task", projectId: "project-1" },
    });
    expect(busy.statusCode).toBe(409);

    (DictationDataGetForUser as jest.Mock).mockResolvedValueOnce(
      record({ convertedAt: new Date().toISOString() }),
    );
    const converted = await app.inject({
      method: "POST",
      url: "/job-1/convert",
      payload: { target: "task", projectId: "project-1" },
    });
    expect(converted.statusCode).toBe(409);
  });

  it("rejects an unknown conversion target", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/job-1/convert",
      payload: { target: "spaceship" },
    });
    expect(res.statusCode).toBe(400);
  });
});