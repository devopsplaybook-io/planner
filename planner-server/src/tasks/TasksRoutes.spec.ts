import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import { parseDoneSince, parseProjectIds, TasksRoutes } from "./TasksRoutes";
import { TasksDataAdd, TasksDataDelete, TasksDataGet, TasksDataList, TasksDataUpdate, addAssignee, addComment, addLabel, addTaskAttachment, clearLabels, deleteTaskAttachment, getTaskAttachment, removeAssignee } from "./TasksData";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { TaskImproveText } from "./TaskImprove";
import { Task } from "../model/Task";
import { Project } from "../model/Project";

jest.mock("fs-extra");

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

jest.mock("./TaskImprove", () => ({
  TaskImproveText: jest.fn(),
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

describe("parseProjectIds", () => {
  it("should return undefined for absent, null, empty or whitespace-only values", () => {
    expect(parseProjectIds(undefined)).toBeUndefined();
    expect(parseProjectIds(null)).toBeUndefined();
    expect(parseProjectIds("")).toBeUndefined();
    expect(parseProjectIds("   ")).toBeUndefined();
    expect(parseProjectIds(" , , ")).toBeUndefined();
  });

  it("should return a single id", () => {
    expect(parseProjectIds("proj-1")).toEqual(["proj-1"]);
  });

  it("should split on commas and trim each id", () => {
    expect(parseProjectIds(" proj-1 ,proj-2,  proj-3  ")).toEqual([
      "proj-1",
      "proj-2",
      "proj-3",
    ]);
  });

  it("should drop empty segments and de-duplicate ids", () => {
    expect(parseProjectIds("proj-1,,proj-1,proj-2")).toEqual([
      "proj-1",
      "proj-2",
    ]);
  });

  it("should ignore a non-string value", () => {
    expect(parseProjectIds(42)).toBeUndefined();
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

  it("should forward a search term to the data layer", async () => {
    await app.inject({ method: "GET", url: "/?q=report" });
    expect(TasksDataList).toHaveBeenCalledWith({
      projectId: undefined,
      doneSince: undefined,
      q: "report",
      visibleTo: { userId: "user-1" },
    });
  });

  it("should ignore a whitespace-only search term", async () => {
    await app.inject({ method: "GET", url: "/?q=%20%20" });
    expect(TasksDataList).toHaveBeenCalledWith({
      projectId: undefined,
      doneSince: undefined,
      q: undefined,
      visibleTo: { userId: "user-1" },
    });
  });

  it("should forward the projectIds subtree filter to the data layer", async () => {
    await app.inject({
      method: "GET",
      url: "/?projectIds=proj-1,proj-2",
    });
    expect(TasksDataList).toHaveBeenCalledWith({
      projectId: undefined,
      projectIds: ["proj-1", "proj-2"],
      doneSince: undefined,
      q: undefined,
      visibleTo: { userId: "user-1" },
    });
  });

  it("should not set projectIds when the param is absent", async () => {
    await app.inject({ method: "GET", url: "/" });
    expect(TasksDataList).toHaveBeenCalledWith(
      expect.not.objectContaining({ projectIds: expect.anything() }),
    );
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

  it("should replace the checklist when a reduced one is sent", async () => {
    const task = makeTask(publicProject);
    task.checklist = [
      { text: "First", done: false },
      { text: "Second", done: true },
    ];
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { checklist: [{ text: "Second", done: true }] },
    });
    expect(res.statusCode).toBe(201);
    expect(task.checklist).toEqual([{ text: "Second", done: true }]);
    expect(TasksDataUpdate).toHaveBeenCalledWith(task);
    expect(res.json().checklist).toEqual([{ text: "Second", done: true }]);
  });

  it("should accept an empty checklist and remove every item", async () => {
    const task = makeTask(publicProject);
    task.checklist = [{ text: "Only", done: false }];
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { checklist: [] },
    });
    expect(res.statusCode).toBe(201);
    expect(task.checklist).toEqual([]);
    expect(TasksDataUpdate).toHaveBeenCalledWith(task);
    expect(res.json().checklist).toEqual([]);
  });

  // ==================== PROJECT CHANGE ====================
  it("should move a task to a visible target project", async () => {
    const from = makeProject("public", []);
    const to = makeProject("public", []);
    to.name = "Target";
    const task = makeTask(from);
    task.status = "To Do";
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === to.id ? to : from,
    );

    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { projectId: to.id },
    });

    expect(res.statusCode).toBe(201);
    expect(task.projectId).toBe(to.id);
    expect(task.status).toBe("To Do");
    expect(TasksDataUpdate).toHaveBeenCalledWith(task);
    expect(res.json()).toMatchObject({ projectId: to.id });
  });

  it("should reset the status to the target project's first status when the target does not use it", async () => {
    const from = makeProject("public", []);
    const to = makeProject("public", []);
    to.name = "Target";
    to.statuses = ["Backlog", "Blocked", "Done"];
    const task = makeTask(from);
    task.status = "In Progress";
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === to.id ? to : from,
    );

    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { projectId: to.id },
    });

    expect(res.statusCode).toBe(201);
    expect(task.projectId).toBe(to.id);
    expect(task.status).toBe("Backlog");
  });

  it("should keep the status when the target project uses it", async () => {
    const from = makeProject("public", []);
    const to = makeProject("public", []);
    to.statuses = ["Backlog", "In Progress", "Done"];
    const task = makeTask(from);
    task.status = "In Progress";
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === to.id ? to : from,
    );

    await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { projectId: to.id },
    });

    expect(task.status).toBe("In Progress");
  });

  it("should reject moving a task to a project the user cannot see", async () => {
    const from = makeProject("public", []);
    const task = makeTask(from);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === hiddenProject.id ? hiddenProject : from,
    );

    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { projectId: hiddenProject.id },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Project Not Found" });
    expect(TasksDataUpdate).not.toHaveBeenCalled();
    expect(task.projectId).toBe(from.id);
  });

  it("should reject moving a task to a missing project", async () => {
    const from = makeProject("public", []);
    const task = makeTask(from);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === "missing" ? null : from,
    );

    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { projectId: "missing" },
    });

    expect(res.statusCode).toBe(404);
    expect(TasksDataUpdate).not.toHaveBeenCalled();
    expect(task.projectId).toBe(from.id);
  });

  it("should treat a project change to the current project as a no-op", async () => {
    const from = makeProject("public", []);
    const task = makeTask(from);
    task.title = "Original";
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(from);

    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { projectId: from.id, title: "Renamed" },
    });

    expect(res.statusCode).toBe(201);
    expect(task.projectId).toBe(from.id);
    expect(task.title).toBe("Renamed");
    expect(TasksDataUpdate).toHaveBeenCalledTimes(1);
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

  // ==================== CLONE ====================
  it("should clone a task into the first status of its project", async () => {
    const project = makeProject("public", []);
    project.statuses = ["Backlog", "In Progress", "Done"];
    const task = makeTask(project);
    task.title = "Source";
    task.description = "Desc";
    task.priority = "high";
    task.dueDate = "2026-10-01";
    task.status = "Done";
    task.labels = ["bug"];
    task.assignees = [{ userId: "user-2" }];
    task.checklist = [{ text: "step", done: true }];
    task.comments = [
      {
        id: "c1",
        userId: "user-1",
        text: "hi",
        dateCreated: "2026-09-01T00:00:00.000Z",
      },
    ];
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);

    const res = await app.inject({ method: "POST", url: `/${task.id}/clone` });

    expect(res.statusCode).toBe(201);
    expect(TasksDataAdd).toHaveBeenCalledTimes(1);
    const clone = (TasksDataAdd as jest.Mock).mock.calls[0][0] as Task;
    expect(clone.id).not.toBe(task.id);
    expect(clone.status).toBe("Backlog");
    expect(clone.title).toBe("Source");
    expect(clone.description).toBe("Desc");
    expect(clone.priority).toBe("high");
    expect(clone.dueDate).toBe("2026-10-01");
    expect(clone.labels).toEqual(["bug"]);
    expect(clone.assignees).toEqual([{ userId: "user-2" }]);
    expect(clone.checklist).toEqual([{ text: "step", done: true }]);
    expect(clone.comments).toEqual([]);
  });

  it("should answer the clone response with the copied attachments", async () => {
    const project = makeProject("public", []);
    const task = makeTask(project);
    task.attachments = [
      {
        id: "att-1",
        fileName: "spec.pdf",
        filePath: "/data/attachments/tasks/att-1.pdf",
        dateCreated: "2026-09-01T00:00:00.000Z",
      },
    ];
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.pathExists.mockResolvedValue(true);

    const res = await app.inject({ method: "POST", url: `/${task.id}/clone` });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].fileName).toBe("spec.pdf");
    expect(body.attachments[0].filePath).toContain("/data/attachments/tasks/");
    expect(addTaskAttachment).toHaveBeenCalledTimes(1);
  });

  it("should reject cloning a task the user cannot see", async () => {
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({ method: "POST", url: `/${task.id}/clone` });
    expect(res.statusCode).toBe(404);
    expect(TasksDataAdd).not.toHaveBeenCalled();
  });

  // ==================== IMPROVE ====================
  it("should return the improved text", async () => {
    (TaskImproveText as jest.Mock).mockResolvedValue({
      title: "Better title",
      description: "Better description",
    });
    const res = await app.inject({
      method: "POST",
      url: "/improve",
      payload: { title: "Old", description: "Old description" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      title: "Better title",
      description: "Better description",
    });
    expect(TaskImproveText).toHaveBeenCalledWith("Old", "Old description");
  });

  it("should reject improve with an empty title and description", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/improve",
      payload: { title: "  ", description: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(TaskImproveText).not.toHaveBeenCalled();
  });

  it("should answer 502 when the LLM response cannot be used", async () => {
    (TaskImproveText as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/improve",
      payload: { title: "Old", description: "Old description" },
    });
    expect(res.statusCode).toBe(502);
  });

  it("should answer 502 when the LLM request fails", async () => {
    (TaskImproveText as jest.Mock).mockRejectedValue(new Error("boom"));
    const res = await app.inject({
      method: "POST",
      url: "/improve",
      payload: { title: "Old", description: "Old description" },
    });
    expect(res.statusCode).toBe(502);
  });
});

describe("TasksRoutes archived project guard", () => {
  let app: FastifyInstance;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  const archivedProject = new Project();
  archivedProject.name = "Archived";
  archivedProject.archived = true;

  const activeProject = new Project();
  activeProject.name = "Active";

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

  it("should reject creating a task in an archived project", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: archivedProject.id, title: "New" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Project is archived");
    expect(TasksDataAdd).not.toHaveBeenCalled();
  });

  it("should reject cloning a task from an archived project", async () => {
    const task = makeTask(archivedProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({ method: "POST", url: `/${task.id}/clone` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Project is archived");
    expect(TasksDataAdd).not.toHaveBeenCalled();
  });

  it("should reject updating a task in an archived project", async () => {
    const task = makeTask(archivedProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { title: "Changed" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Project is archived");
    expect(TasksDataUpdate).not.toHaveBeenCalled();
  });

  it("should reject moving a task into an archived project", async () => {
    const task = makeTask(activeProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockImplementation(
      async (id: string) => (id === archivedProject.id ? archivedProject : activeProject),
    );
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { projectId: archivedProject.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Project is archived");
    expect(TasksDataUpdate).not.toHaveBeenCalled();
  });

  it("should reject adding a comment to a task in an archived project", async () => {
    const task = makeTask(archivedProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/comments`,
      payload: { text: "Hello" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Project is archived");
    expect(addComment).not.toHaveBeenCalled();
  });

  it("should reject adding an assignee to a task in an archived project", async () => {
    const task = makeTask(archivedProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/assignees`,
      payload: { userId: "user-2" },
    });
    expect(res.statusCode).toBe(400);
    expect(addAssignee).not.toHaveBeenCalled();
  });

  it("should reject updating the labels of a task in an archived project", async () => {
    const task = makeTask(archivedProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/labels`,
      payload: { labels: ["urgent"] },
    });
    expect(res.statusCode).toBe(400);
    expect(clearLabels).not.toHaveBeenCalled();
  });

  it("should still read a task in an archived project", async () => {
    const task = makeTask(archivedProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({ method: "GET", url: `/${task.id}` });
    expect(res.statusCode).toBe(200);
  });

  it("should reject deleting an attachment of a task in an archived project", async () => {
    const task = makeTask(archivedProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    (getTaskAttachment as jest.Mock).mockResolvedValue({
      id: "att-1",
      fileName: "f.pdf",
      filePath: "/data/attachments/tasks/att-1.pdf",
      dateCreated: "2026-09-01T00:00:00.000Z",
      taskId: task.id,
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/${task.id}/attachments/att-1`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Project is archived");
    expect(deleteTaskAttachment).not.toHaveBeenCalled();
  });

  it("should still delete a task in an archived project", async () => {
    const task = makeTask(archivedProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({ method: "DELETE", url: `/${task.id}` });
    expect(res.statusCode).toBe(201);
    expect(TasksDataDelete).toHaveBeenCalledWith(task.id);
  });
});
