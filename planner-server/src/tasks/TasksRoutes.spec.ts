import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import { parseDoneSince, TasksRoutes } from "./TasksRoutes";
import { TasksDataAdd, TasksDataDelete, TasksDataGet, TasksDataList, TasksDataUpdate, addAssignee, addComment, addLabel, clearLabels, removeAssignee } from "./TasksData";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { Task } from "../model/Task";
import { Project } from "../model/Project";

jest.mock("./TasksData", () => ({
  TasksDataAdd: jest.fn(),
  TasksDataDelete: jest.fn(),
  TasksDataGet: jest.fn(),
  TasksDataList: jest.fn(async () => []),
  TasksDataTouch: jest.fn(),
  TasksDataUpdate: jest.fn(),
  addAssignee: jest.fn(),
  removeAssignee: jest.fn(),
  addComment: jest.fn(),
  deleteComment: jest.fn(),
  getComment: jest.fn(),
  updateComment: jest.fn(),
  clearLabels: jest.fn(),
  addLabel: jest.fn(),
  addTaskAttachment: jest.fn(),
  deleteTaskAttachment: jest.fn(),
  getTaskAttachment: jest.fn(),
}));

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
  AuthMustBeAdmin: jest.fn(),
}));

jest.mock("../users/UsersData", () => ({
  UsersDataGet: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

jest.mock("../notifications/Notifications", () => ({
  NotificationsTaskUpdated: jest.fn(),
}));

describe("parseDoneSince", () => {
  it("should return undefined for absent, null or empty values", () => {
    expect(parseDoneSince(undefined)).toBeUndefined();
    expect(parseDoneSince(null)).toBeUndefined();
    expect(parseDoneSince("")).toBeUndefined();
  });

  it("should accept a full ISO 8601 timestamp and normalize it", () => {
    expect(parseDoneSince("2026-08-14T10:30:00.000Z")).toBe(
      "2026-08-14T10:30:00.000Z",
    );
    expect(parseDoneSince("2026-08-14")).toBe("2026-08-14T00:00:00.000Z");
  });

  it("should normalize non-UTC offsets to UTC", () => {
    expect(parseDoneSince("2026-08-14T10:30:00+02:00")).toBe(
      "2026-08-14T08:30:00.000Z",
    );
  });

  it("should reject garbage values", () => {
    expect(() => parseDoneSince("garbage")).toThrow();
    expect(() => parseDoneSince("not a date")).toThrow();
    expect(() => parseDoneSince("2026-13-45")).toThrow();
  });
});

describe("TasksRoutes project visibility", () => {
  let app: FastifyInstance;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  const adminSession = {
    isAuthenticated: true,
    userId: "admin-1",
    userName: "Admin",
    role: "admin" as const,
  };

  function makeProject(visibility: string, userAccess: string[]): Project {
    const project = new Project();
    project.name = "P";
    project.visibility = visibility;
    project.userAccess = userAccess;
    return project;
  }

  const publicProject = makeProject("public", []);
  const memberProject = makeProject("restricted", ["user-1"]);
  const hiddenProject = makeProject("restricted", ["user-2"]);

  function makeTask(project: Project): Task {
    const task = new Task();
    task.projectId = project.id;
    task.title = "Task";
    return task;
  }

  beforeAll(async () => {
    app = Fastify();
    await new TasksRoutes().getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (AuthMustBeAuthenticated as jest.Mock).mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== LIST ====================
  it("should scope the list to visible projects for non-admins", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(TasksDataList).toHaveBeenCalledWith({
      projectId: undefined,
      doneSince: undefined,
      visibleTo: { userId: "user-1" },
    });
  });

  it("should not scope the list for admins", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    await app.inject({ method: "GET", url: "/" });
    expect(TasksDataList).toHaveBeenCalledWith({
      projectId: undefined,
      doneSince: undefined,
      visibleTo: undefined,
    });
  });

  it("should reject the list for unauthenticated requests", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(403);
    expect(TasksDataList).not.toHaveBeenCalled();
  });

  // ==================== GET BY ID ====================
  it("should return a task from a public project", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({ method: "GET", url: `/${task.id}` });
    expect(res.statusCode).toBe(200);
  });

  it("should return a task from a restricted project to a member", async () => {
    const task = makeTask(memberProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(memberProject);
    const res = await app.inject({ method: "GET", url: `/${task.id}` });
    expect(res.statusCode).toBe(200);
  });

  it("should return 404 for a task from a restricted project the user cannot see", async () => {
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({ method: "GET", url: `/${task.id}` });
    expect(res.statusCode).toBe(404);
  });

  it("should return any task to an admin without loading the project", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    const res = await app.inject({ method: "GET", url: `/${task.id}` });
    expect(res.statusCode).toBe(200);
    expect(ProjectsDataGet).not.toHaveBeenCalled();
  });

  it("should return 404 for a missing task", async () => {
    (TasksDataGet as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/missing" });
    expect(res.statusCode).toBe(404);
  });

  // ==================== CREATE ====================
  it("should reject task creation in a restricted project the user cannot see", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: hiddenProject.id, title: "Sneaky" },
    });
    expect(res.statusCode).toBe(404);
    expect(TasksDataAdd).not.toHaveBeenCalled();
  });

  it("should create a task in a restricted project for a member", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(memberProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: memberProject.id, title: "Mine" },
    });
    expect(res.statusCode).toBe(201);
    expect(TasksDataAdd).toHaveBeenCalledTimes(1);
  });

  // ==================== UPDATE / DELETE ====================
  it("should reject task update for a user who cannot see the task", async () => {
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { title: "Hacked" },
    });
    expect(res.statusCode).toBe(404);
    expect(TasksDataUpdate).not.toHaveBeenCalled();
  });

  it("should reject task deletion for a user who cannot see the task", async () => {
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({ method: "DELETE", url: `/${task.id}` });
    expect(res.statusCode).toBe(404);
    expect(TasksDataDelete).not.toHaveBeenCalled();
  });

  // ==================== SUB-RESOURCES ====================
  it("should reject comments on a task the user cannot see", async () => {
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/comments`,
      payload: { text: "hi" },
    });
    expect(res.statusCode).toBe(404);
    expect(addComment).not.toHaveBeenCalled();
  });

  it("should reject assignee changes on a task the user cannot see", async () => {
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/assignees`,
      payload: { userId: "user-2" },
    });
    expect(res.statusCode).toBe(404);
    expect(addAssignee).not.toHaveBeenCalled();
  });

  it("should reject label changes on a task the user cannot see", async () => {
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/labels`,
      payload: { labels: ["urgent"] },
    });
    expect(res.statusCode).toBe(404);
    expect(clearLabels).not.toHaveBeenCalled();
    expect(addLabel).not.toHaveBeenCalled();
  });

  it("should reject assignee removal on a task the user cannot see", async () => {
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "DELETE",
      url: `/${task.id}/assignees/user-2`,
    });
    expect(res.statusCode).toBe(404);
    expect(removeAssignee).not.toHaveBeenCalled();
  });
});
