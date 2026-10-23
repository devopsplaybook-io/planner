/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import webpush from "web-push";
import { Config } from "../Config";
import {
  DbUtilsClose,
  DbUtilsExecSQL,
  DbUtilsInit,
} from "../utils/DbUtils";
import { RunMigrations } from "../DbMigrations";
import { UsersDataSetNotificationDigest } from "../users/UsersData";
import { Task } from "../model/Task";
import {
  NotificationsCheckAndSend,
  NotificationsInit,
  NotificationsTaskUpdated,
} from "./Notifications";

/**
 * Integration tests of the due-date reminder pipeline against a real SQLite
 * database (no DB mocks): assignee-only audience, project visibility filter,
 * overdue dedup per day and the daily digest consolidation. web-push is
 * mocked to capture the pushed payloads.
 */

jest.mock("web-push", () => ({
  sendNotification: jest.fn(async () => undefined),
  setVapidDetails: jest.fn(),
  generateVAPIDKeys: jest.fn(() => ({
    publicKey: "test-public-key",
    privateKey: "test-private-key",
  })),
}));

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

const sendNotificationMock = webpush.sendNotification as unknown as jest.Mock;

const dir = path.join(os.tmpdir(), `planner-notifications-${Date.now()}`);
const now = new Date().toISOString();

// Reference runs: 2026-10-15 and 2026-10-16 at 10:00 local (after the 9:00 gate)
const day1 = new Date(2026, 9, 15, 10, 0);
const day2 = new Date(2026, 9, 16, 10, 0);
const today = "2026-10-15";
const past = "2026-10-10";

async function insertUser(id: string, role = "user"): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO users (id, name, passwordEncrypted, role, dateCreated, tokenVersion) VALUES (?,?,?,?,?,0)",
    [id, `user-${id}`, "x", role, now],
  );
}

async function insertProject(
  id: string,
  visibility = "public",
): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO projects (id, name, description, isDefault, statuses, dateCreated, visibility) VALUES (?,?,?,?,?,?,?)",
    [id, `project-${id}`, "", 0, '["To Do", "Done"]', now, visibility],
  );
}

async function insertProjectUser(
  projectId: string,
  userId: string,
): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO project_users (projectId, userId) VALUES (?,?)",
    [projectId, userId],
  );
}

async function insertTask(
  id: string,
  projectId: string,
  dueDate: string,
  status = "To Do",
): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO tasks (id, projectId, title, description, status, priority, dueDate, checklist, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, projectId, `task-${id}`, "", status, "medium", dueDate, "[]", now, now],
  );
}

async function insertAssignee(taskId: string, userId: string): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
    [taskId, userId],
  );
}

async function insertSubscription(userId: string): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO push_subscriptions (userId, endpoint, keys, dateCreated) VALUES (?,?,?,?)",
    [
      userId,
      `https://push.example/${userId}`,
      JSON.stringify({ p256dh: "p256dh", auth: "auth" }),
      now,
    ],
  );
}

function callsTo(userId: string): any[] {
  return sendNotificationMock.mock.calls.filter((call: any[]) =>
    (call[0] as { endpoint: string }).endpoint.includes(userId),
  );
}

function payloadOf(call: any[]): any {
  return JSON.parse(call[1] as string);
}

describe("due date reminders (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();
    await NotificationsInit(config);
  });

  beforeEach(() => {
    sendNotificationMock.mockClear();
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should send nothing to a subscribed non-assignee", async () => {
    await insertUser("u-na-assignee");
    await insertUser("u-na-subscriber");
    await insertProject("p-na");
    await insertTask("t-na", "p-na", today);
    await insertAssignee("t-na", "u-na-assignee");
    await insertSubscription("u-na-subscriber");

    await NotificationsCheckAndSend(day1);

    expect(callsTo("u-na-subscriber")).toHaveLength(0);
  });

  it("should not remind an assignee who cannot see a restricted project", async () => {
    await insertUser("u-res");
    await insertProject("p-res", "restricted");
    await insertTask("t-res", "p-res", today);
    await insertAssignee("t-res", "u-res");
    await insertSubscription("u-res");

    await NotificationsCheckAndSend(day1);

    expect(callsTo("u-res")).toHaveLength(0);
  });

  it("should remind an assignee with project membership once", async () => {
    await insertUser("u-member");
    await insertProject("p-member", "restricted");
    await insertProjectUser("p-member", "u-member");
    await insertTask("t-member", "p-member", today);
    await insertAssignee("t-member", "u-member");
    await insertSubscription("u-member");

    await NotificationsCheckAndSend(day1);

    const calls = callsTo("u-member");
    expect(calls).toHaveLength(1);
    const payload = payloadOf(calls[0]);
    expect(payload.title).toBe("Task due today");
    expect(payload.body).toBe("task-t-member");
    expect(payload.url).toBe("/?taskId=t-member");
  });

  it("should remind an admin assignee of a restricted project they are not a member of", async () => {
    await insertUser("u-admin", "admin");
    await insertProject("p-admin", "restricted");
    await insertTask("t-admin", "p-admin", today);
    await insertAssignee("t-admin", "u-admin");
    await insertSubscription("u-admin");

    await NotificationsCheckAndSend(day1);

    expect(callsTo("u-admin")).toHaveLength(1);
  });

  it("should not remind for unassigned tasks", async () => {
    await insertUser("u-any");
    await insertProject("p-unassigned");
    await insertTask("t-unassigned", "p-unassigned", today);
    await insertSubscription("u-any");

    await NotificationsCheckAndSend(day1);

    expect(sendNotificationMock.mock.calls).toHaveLength(0);
  });

  it("should remind an assignee of a public project", async () => {
    await insertUser("u-pub");
    await insertProject("p-pub-assignee");
    await insertTask("t-pub-assignee", "p-pub-assignee", today);
    await insertAssignee("t-pub-assignee", "u-pub");
    await insertSubscription("u-pub");

    await NotificationsCheckAndSend(day1);

    expect(callsTo("u-pub")).toHaveLength(1);
  });

  it("should send an overdue reminder once per day and again the next day", async () => {
    await insertUser("u-overdue");
    await insertProject("p-overdue");
    await insertTask("t-overdue", "p-overdue", past);
    await insertAssignee("t-overdue", "u-overdue");
    await insertSubscription("u-overdue");

    await NotificationsCheckAndSend(day1);
    expect(callsTo("u-overdue")).toHaveLength(1);
    expect(payloadOf(callsTo("u-overdue")[0]).title).toBe("Task overdue");

    // Same day: the reminder was already claimed
    await NotificationsCheckAndSend(day1);
    expect(callsTo("u-overdue")).toHaveLength(1);

    // Next day: overdue reminders repeat
    await NotificationsCheckAndSend(day2);
    expect(callsTo("u-overdue")).toHaveLength(2);
  });

  it("should send one consolidated digest push to digest users and none per task", async () => {
    await insertUser("u-digest");
    await insertUser("u-immediate");
    await insertProject("p-digest");
    await insertTask("t-digest-today", "p-digest", today);
    await insertTask("t-digest-overdue", "p-digest", past);
    await insertAssignee("t-digest-today", "u-digest");
    await insertAssignee("t-digest-today", "u-immediate");
    await insertAssignee("t-digest-overdue", "u-digest");
    await insertSubscription("u-digest");
    await insertSubscription("u-immediate");
    await UsersDataSetNotificationDigest("u-digest", true);

    await NotificationsCheckAndSend(day1);

    // The immediate user gets the regular per-task push only
    const immediateCalls = callsTo("u-immediate");
    expect(immediateCalls).toHaveLength(1);
    expect(payloadOf(immediateCalls[0]).title).toBe("Task due today");

    // The digest user gets exactly one consolidated push, no per-task pushes
    const digestCalls = callsTo("u-digest");
    expect(digestCalls).toHaveLength(1);
    const payload = payloadOf(digestCalls[0]);
    expect(payload.title).toBe("Your task reminders");
    expect(payload.body).toBe(
      "Overdue: task-t-digest-overdue — Due today: task-t-digest-today",
    );
    expect(payload.url).toBe("/");
    expect(payload.tag).toBe("task-digest-2026-10-15");
  });
});

describe("task update notifications (integration)", () => {
  const updateDir = path.join(
    os.tmpdir(),
    `planner-notifications-update-${Date.now()}`,
  );

  beforeAll(async () => {
    await fs.remove(updateDir);
    await fs.ensureDir(updateDir);
    const config = new Config();
    config.DATA_DIR = updateDir;
    await DbUtilsInit(config);
    await RunMigrations();
    await NotificationsInit(config);
  });

  beforeEach(() => {
    sendNotificationMock.mockClear();
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(updateDir);
  });

  function makeTask(
    id: string,
    projectId: string,
    assigneeIds: string[],
  ): Task {
    const task = new Task();
    task.id = id;
    task.projectId = projectId;
    task.title = `title-${id}`;
    task.assignees = assigneeIds.map((userId) => ({ userId }));
    return task;
  }

  it("should push a public-project update to its assignee with the unchanged payload", async () => {
    await insertUser("u-tu-pub");
    await insertProject("p-tu-pub");
    await insertSubscription("u-tu-pub");

    await NotificationsTaskUpdated(
      makeTask("t-tu-pub", "p-tu-pub", ["u-tu-pub"]),
      "actor-1",
      "Actor",
      "Status changed",
    );

    const calls = callsTo("u-tu-pub");
    expect(calls).toHaveLength(1);
    expect(payloadOf(calls[0])).toEqual({
      title: "Task updated by Actor",
      body: "title-t-tu-pub — Status changed",
      url: "/?taskId=t-tu-pub",
      tag: "task-t-tu-pub-update",
    });
  });

  it("should not push a restricted-project update to a non-member assignee", async () => {
    await insertUser("u-tu-hidden");
    await insertProject("p-tu-hidden", "restricted");
    await insertSubscription("u-tu-hidden");

    await NotificationsTaskUpdated(
      makeTask("t-tu-hidden", "p-tu-hidden", ["u-tu-hidden"]),
      "actor-1",
      "Actor",
      "Status changed",
    );

    expect(callsTo("u-tu-hidden")).toHaveLength(0);
  });

  it("should push a restricted-project update to a member assignee", async () => {
    await insertUser("u-tu-member");
    await insertProject("p-tu-member", "restricted");
    await insertProjectUser("p-tu-member", "u-tu-member");
    await insertSubscription("u-tu-member");

    await NotificationsTaskUpdated(
      makeTask("t-tu-member", "p-tu-member", ["u-tu-member"]),
      "actor-1",
      "Actor",
      "Status changed",
    );

    expect(callsTo("u-tu-member")).toHaveLength(1);
  });

  it("should push a restricted-project update to an admin non-member", async () => {
    await insertUser("u-tu-admin", "admin");
    await insertProject("p-tu-admin", "restricted");
    await insertSubscription("u-tu-admin");

    await NotificationsTaskUpdated(
      makeTask("t-tu-admin", "p-tu-admin", ["u-tu-admin"]),
      "actor-1",
      "Actor",
      "Status changed",
    );

    expect(callsTo("u-tu-admin")).toHaveLength(1);
  });

  it("should never push the update to the actor", async () => {
    await insertUser("u-tu-actor");
    await insertProject("p-tu-actor");
    await insertSubscription("u-tu-actor");

    await NotificationsTaskUpdated(
      makeTask("t-tu-actor", "p-tu-actor", ["u-tu-actor"]),
      "u-tu-actor",
      "Actor",
      "Status changed",
    );

    expect(callsTo("u-tu-actor")).toHaveLength(0);
  });

  it("should not push after the assignee's membership was revoked", async () => {
    await insertUser("u-tu-revoked");
    await insertProject("p-tu-revoked", "restricted");
    await insertProjectUser("p-tu-revoked", "u-tu-revoked");
    await insertSubscription("u-tu-revoked");
    await DbUtilsExecSQL(
      "DELETE FROM project_users WHERE projectId = ? AND userId = ?",
      ["p-tu-revoked", "u-tu-revoked"],
    );

    await NotificationsTaskUpdated(
      makeTask("t-tu-revoked", "p-tu-revoked", ["u-tu-revoked"]),
      "actor-1",
      "Actor",
      "Status changed",
    );

    expect(callsTo("u-tu-revoked")).toHaveLength(0);
  });
});
