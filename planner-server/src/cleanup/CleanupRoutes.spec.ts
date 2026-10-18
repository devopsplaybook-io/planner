import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import { CleanupRoutes } from "./CleanupRoutes";
import { SettingsDataGet, SettingsDataSave } from "../settings/SettingsData";
import { ProjectsDataList } from "../projects/ProjectsData";
import { TasksDataDelete } from "../tasks/TasksData";
import {
  CleanupDataDeleteTaskAttachment,
  CleanupDataListDoneTasksOlderThan,
  CleanupDataListTaskAttachmentsOlderThan,
} from "./CleanupData";
import * as fs from "fs-extra";

jest.mock("fs-extra");

jest.mock("../users/Auth", () => ({
  AuthMustBeAdmin: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
  AuthGetUserSession: jest.fn(),
}));

jest.mock("../settings/SettingsData", () => ({
  SettingsDataGet: jest.fn(),
  SettingsDataSave: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataList: jest.fn(),
}));

jest.mock("../tasks/TasksData", () => ({
  TasksDataDelete: jest.fn(),
  deleteTaskAttachment: jest.fn(),
}));

jest.mock("./CleanupData", () => ({
  CleanupDataListDoneTasksOlderThan: jest.fn(),
  CleanupDataListTaskAttachmentsOlderThan: jest.fn(),
  CleanupDataDeleteTaskAttachment: jest.fn(),
}));

import { AuthMustBeAdmin } from "../users/Auth";

let app: FastifyInstance;

function deny(status: number): void {
  (AuthMustBeAdmin as jest.Mock).mockImplementation(async (_req, res) => {
    res.status(status).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  });
}

function allow(): void {
  (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
}

beforeAll(async () => {
  app = Fastify();
  await new CleanupRoutes().getRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  (fs.pathExists as jest.Mock).mockResolvedValue(true);
  (fs.remove as jest.Mock).mockResolvedValue(undefined);
  (ProjectsDataList as jest.Mock).mockResolvedValue([
    { id: "p1", name: "Home" },
    { id: "p2", name: "Work" },
  ]);
  allow();
});

describe("authorization", () => {
  const cases: [string, "GET" | "PUT" | "POST", string][] = [
    ["rules", "GET", "/rules"],
    ["rules", "PUT", "/rules"],
    ["preview", "POST", "/preview"],
  ];

  for (const [name, method, url] of cases) {
    it(`should reject an unauthenticated ${method} ${name} with 401`, async () => {
      deny(401);
      const res = await app.inject({ method, url, payload: { rules: [] } });
      expect(res.statusCode).toBe(401);
    });

    it(`should reject a non-admin ${method} ${name} with 403`, async () => {
      deny(403);
      const res = await app.inject({ method, url, payload: { rules: [] } });
      expect(res.statusCode).toBe(403);
    });
  }
});

describe("GET /rules", () => {
  it("should return the parsed stored rules", async () => {
    (SettingsDataGet as jest.Mock).mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            projectId: "p1",
            deleteDoneTasksOlderThanDays: 30,
            enabled: true,
          },
        ],
      }),
    );
    const res = await app.inject({ method: "GET", url: "/rules" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      rules: [
        {
          projectId: "p1",
          deleteDoneTasksOlderThanDays: 30,
          deleteAttachmentsOlderThanDays: undefined,
          deleteVoiceMessagesOlderThanDays: undefined,
          enabled: true,
        },
      ],
    });
  });

  it("should return an empty list when nothing is stored", async () => {
    (SettingsDataGet as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/rules" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rules: [] });
  });

  it("should tolerate a malformed stored document", async () => {
    (SettingsDataGet as jest.Mock).mockResolvedValue("{broken");
    const res = await app.inject({ method: "GET", url: "/rules" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rules: [] });
  });
});

describe("PUT /rules", () => {
  it("should validate and persist the canonical rules document", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/rules",
      payload: {
        rules: [
          {
            projectId: "p1",
            deleteDoneTasksOlderThanDays: 30,
            deleteVoiceMessagesOlderThanDays: 60,
            enabled: true,
          },
          { projectId: "p2" },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const saved = (SettingsDataSave as jest.Mock).mock.calls[0];
    expect(saved[0]).toBe("cleanup");
    expect(JSON.parse(saved[1])).toEqual({
      rules: [
        {
          projectId: "p1",
          deleteDoneTasksOlderThanDays: 30,
          deleteAttachmentsOlderThanDays: undefined,
          deleteVoiceMessagesOlderThanDays: 60,
          enabled: true,
        },
        {
          projectId: "p2",
          deleteDoneTasksOlderThanDays: undefined,
          deleteAttachmentsOlderThanDays: undefined,
          deleteVoiceMessagesOlderThanDays: undefined,
          enabled: false,
        },
      ],
    });
  });

  it("should reject an unknown project", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/rules",
      payload: { rules: [{ projectId: "p-gone", enabled: true }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Unknown project: p-gone");
    expect(SettingsDataSave).not.toHaveBeenCalled();
  });

  it("should reject invalid day thresholds", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/rules",
      payload: {
        rules: [{ projectId: "p1", deleteDoneTasksOlderThanDays: 0 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(SettingsDataSave).not.toHaveBeenCalled();
  });

  it("should reject a non-array rules body", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/rules",
      payload: { rules: { projectId: "p1" } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /preview", () => {
  function isoDaysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  it("should run the same engine on the edited rules without deleting", async () => {
    const cutoffBoundaries: string[] = [];
    (CleanupDataListDoneTasksOlderThan as jest.Mock).mockImplementation(
      async (_projectId: string, cutoff: string) => {
        cutoffBoundaries.push(cutoff);
        return [
          {
            id: "t-old",
            projectId: "p1",
            title: "Old done task",
            status: "Done",
            dateUpdated: isoDaysAgo(40),
          },
        ];
      },
    );
    (CleanupDataListTaskAttachmentsOlderThan as jest.Mock).mockResolvedValue([
      {
        id: "a-1",
        taskId: "t-old",
        fileName: "voice.webm",
        filePath: "/data/attachments/tasks/a-1",
        dateCreated: isoDaysAgo(100),
      },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/preview",
      payload: {
        rules: [
          {
            projectId: "p1",
            deleteDoneTasksOlderThanDays: 30,
            deleteAttachmentsOlderThanDays: 90,
            enabled: true,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({
      projectId: "p1",
      taskCount: 1,
      attachmentCount: 0,
      voiceMessageCount: 1,
    });
    expect(body.projects[0].taskSamples[0]).toMatchObject({
      id: "t-old",
      title: "Old done task",
    });
    expect(SettingsDataSave).not.toHaveBeenCalled();
    expect(TasksDataDelete).not.toHaveBeenCalled();
    expect(CleanupDataDeleteTaskAttachment).not.toHaveBeenCalled();
    expect(fs.remove).not.toHaveBeenCalled();
    expect(cutoffBoundaries).toHaveLength(1);
  });

  it("should reject invalid preview rules with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/preview",
      payload: { rules: [{ projectId: "nope", enabled: true }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Unknown project: nope");
  });
});
