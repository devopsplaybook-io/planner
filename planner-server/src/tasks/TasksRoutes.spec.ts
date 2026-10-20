import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { Readable, Writable } from "stream";
import {
  isCancelTaskRequest,
  parseAssigneeUserId,
  parseDoneSince,
  parseFields,
  parseLimit,
  parseOffset,
  parseProjectIds,
  resolveTaskStatus,
  MAX_LABEL_LENGTH,
  TASKS_DEFAULT_LIMIT,
  TasksRoutes,
  validateDependencies,
  validateLabelList,
} from "./TasksRoutes";
import {
  TasksDataAdd,
  TasksDataDelete,
  TasksDataGet,
  TasksDataList,
  TasksDataUpdate,
  addAssignee,
  addComment,
  addTaskAttachment,
  deleteTaskAttachment,
  getComment,
  getTaskAttachment,
  removeAssignee,
  replaceLabels,
  replaceDependencies,
  MutateTaskLabels,
  TasksDataTouch,
  updateComment,
} from "./TasksData";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import { UsersDataGet } from "../users/UsersData";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { TaskImproveText } from "./TaskImprove";
import { TaskVoiceCommentsEnqueue } from "./TaskVoiceComments";
import { TaskActivityDataAdd, TaskActivityDataList } from "./TaskActivityData";
import { Task } from "../model/Task";
import { Project, ProjectUserAccess } from "../model/Project";

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
  replaceLabels: jest.fn(),
  replaceDependencies: jest.fn(),
  MutateTaskLabels: jest.fn(),
  addDependency: jest.fn(),
  addTaskAttachment: jest.fn(),
  deleteTaskAttachment: jest.fn(),
  getTaskAttachment: jest.fn(),
}));

jest.mock("./TaskImprove", () => ({
  TaskImproveText: jest.fn(),
}));

jest.mock("./TaskVoiceComments", () => ({
  TaskVoiceCommentsEnqueue: jest.fn(),
}));

jest.mock("./TaskActivityData", () => ({
  TaskActivityDataAdd: jest.fn(),
  TaskActivityDataList: jest.fn(async () => []),
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

describe("parseFields", () => {
  it("should return undefined for absent, null, empty or whitespace-only values", () => {
    expect(parseFields(undefined)).toBeUndefined();
    expect(parseFields(null)).toBeUndefined();
    expect(parseFields("")).toBeUndefined();
    expect(parseFields("   ")).toBeUndefined();
  });

  it("should return undefined for the wildcard value", () => {
    expect(parseFields("*")).toBeUndefined();
    expect(parseFields(" * ")).toBeUndefined();
  });

  it("should ignore a non-string value", () => {
    expect(parseFields(42)).toBeUndefined();
  });

  it("should split on commas, trim and de-duplicate known field names", () => {
    expect(parseFields(" id , title ,id ")).toEqual(
      new Set(["id", "title"]),
    );
  });

  it("should silently ignore unknown field names", () => {
    expect(parseFields("id,bogus,title")).toEqual(
      new Set(["id", "title"]),
    );
  });

  it("should return undefined when no requested name is known", () => {
    expect(parseFields("bogus,other")).toBeUndefined();
    expect(parseFields(" , ")).toBeUndefined();
  });
});

describe("parseAssigneeUserId", () => {
  it("should return undefined for absent, null, empty or whitespace-only values", () => {
    expect(parseAssigneeUserId(undefined)).toBeUndefined();
    expect(parseAssigneeUserId(null)).toBeUndefined();
    expect(parseAssigneeUserId("")).toBeUndefined();
    expect(parseAssigneeUserId("   ")).toBeUndefined();
  });

  it("should return the trimmed user id", () => {
    expect(parseAssigneeUserId("user-1")).toBe("user-1");
    expect(parseAssigneeUserId(" user-1 ")).toBe("user-1");
  });

  it("should ignore a non-string value", () => {
    expect(parseAssigneeUserId(42)).toBeUndefined();
  });
});

describe("validateLabelList", () => {
  it("should reject a payload that is not an array of strings", () => {
    for (const value of [undefined, null, "urgent", 42, {}, [1], [{}], [[]]]) {
      expect(() => validateLabelList(value)).toThrow(
        "Invalid: labels (must be an array of strings)",
      );
    }
  });

  it("should accept an empty array", () => {
    expect(validateLabelList([])).toEqual([]);
  });

  it("should trim names and preserve the stored case", () => {
    expect(validateLabelList([" urgent ", "Bug"])).toEqual(["urgent", "Bug"]);
  });

  it("should de-duplicate names preserving the first occurrence", () => {
    expect(validateLabelList(["a", "b", "a", " b "])).toEqual(["a", "b"]);
  });

  it("should treat labels as case-sensitive", () => {
    expect(validateLabelList(["Agent:", "agent:"])).toEqual([
      "Agent:",
      "agent:",
    ]);
  });

  it("should reject trimmed-empty names", () => {
    for (const value of [[""], ["   "], ["ok", "  "]]) {
      expect(() => validateLabelList(value)).toThrow(
        "label names must be non-empty",
      );
    }
  });

  it("should accept a name of exactly the maximum length", () => {
    const name = "x".repeat(MAX_LABEL_LENGTH);
    expect(validateLabelList([name])).toEqual([name]);
  });

  it("should reject names longer than the maximum", () => {
    const name = "x".repeat(MAX_LABEL_LENGTH + 1);
    expect(() => validateLabelList([name])).toThrow(
      `at most ${MAX_LABEL_LENGTH} characters`,
    );
  });

  it("should name the field in the error message", () => {
    expect(() => validateLabelList("nope", "add")).toThrow(
      "Invalid: add (must be an array of strings)",
    );
  });
});

describe("parseLimit", () => {
  it("should default when absent or empty", () => {
    expect(parseLimit(undefined)).toBe(TASKS_DEFAULT_LIMIT);
    expect(parseLimit(null)).toBe(TASKS_DEFAULT_LIMIT);
    expect(parseLimit("")).toBe(TASKS_DEFAULT_LIMIT);
  });

  it("should accept positive integers", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("250")).toBe(250);
  });

  it("should reject zero, negatives and non-integers", () => {
    expect(() => parseLimit("0")).toThrow();
    expect(() => parseLimit("-5")).toThrow();
    expect(() => parseLimit("1.5")).toThrow();
    expect(() => parseLimit("abc")).toThrow();
  });
});

describe("parseOffset", () => {
  it("should default to 0 when absent or empty", () => {
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset(null)).toBe(0);
    expect(parseOffset("")).toBe(0);
  });

  it("should accept non-negative integers", () => {
    expect(parseOffset("0")).toBe(0);
    expect(parseOffset("40")).toBe(40);
  });

  it("should reject negatives and non-integers", () => {
    expect(() => parseOffset("-1")).toThrow();
    expect(() => parseOffset("2.5")).toThrow();
    expect(() => parseOffset("abc")).toThrow();
  });
});

describe("resolveTaskStatus", () => {
  function projectWithStatuses(statuses: string[]): Project {
    const project = new Project();
    project.statuses = statuses;
    return project;
  }

  it("should return the requested status when the project uses it", () => {
    const project = projectWithStatuses(["Backlog", "In Progress", "Done"]);
    expect(resolveTaskStatus(project, "In Progress")).toBe("In Progress");
  });

  it("should return the project's first status when no status is requested", () => {
    const project = projectWithStatuses(["Backlog", "In Progress", "Done"]);
    expect(resolveTaskStatus(project)).toBe("Backlog");
    expect(resolveTaskStatus(project, undefined)).toBe("Backlog");
    expect(resolveTaskStatus(project, "")).toBe("Backlog");
  });

  it("should return the project's first status when the requested status is not in the project's list", () => {
    const project = projectWithStatuses(["Backlog", "In Progress", "Done"]);
    expect(resolveTaskStatus(project, "To Do")).toBe("Backlog");
  });

  it("should fall back to the requested status, then To Do, for a project with an empty statuses list", () => {
    const project = projectWithStatuses([]);
    expect(resolveTaskStatus(project, "Done")).toBe("Done");
    expect(resolveTaskStatus(project)).toBe("To Do");
  });
});

describe("validateDependencies", () => {
  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  const publicProject = new Project();
  publicProject.name = "P";
  publicProject.visibility = "public";

  function makeTask(id: string): Task {
    const task = new Task();
    task.id = id;
    task.projectId = publicProject.id;
    task.title = "Task";
    return task;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
  });

  it("should reject a payload that is not an array of strings", async () => {
    const task = makeTask("task-1");
    (TasksDataGet as jest.Mock).mockResolvedValue(null);
    for (const dependencies of [undefined, null, "task-2", 42, [1, 2], [{}]]) {
      const validation = await validateDependencies(
        task,
        dependencies,
        userSession,
      );
      expect(validation.errorStatus).toBe(400);
      expect(validation.errorMessage).toContain("dependencies");
    }
  });

  it("should reject a self-reference", async () => {
    const task = makeTask("task-1");
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    const validation = await validateDependencies(
      task,
      ["task-1"],
      userSession,
    );
    expect(validation.errorStatus).toBe(400);
    expect(validation.errorMessage).toContain("itself");
  });

  it("should resolve the ids of a valid creation payload", async () => {
    (TasksDataGet as jest.Mock).mockResolvedValue(makeTask("task-2"));
    const validation = await validateDependencies(
      null,
      ["task-2"],
      userSession,
    );
    expect(validation.ids).toEqual(["task-2"]);
  });

  it("should answer 404 for a missing or invisible dependency", async () => {
    const task = makeTask("task-1");
    (TasksDataGet as jest.Mock).mockResolvedValue(null);
    const validation = await validateDependencies(
      task,
      ["missing-task"],
      userSession,
    );
    expect(validation.errorStatus).toBe(404);
    expect(validation.errorMessage).toBe("Task Not Found");
  });

  it("should trim ids, drop empty and duplicate entries", async () => {
    const task = makeTask("task-1");
    (TasksDataGet as jest.Mock).mockResolvedValue(makeTask("task-2"));
    const validation = await validateDependencies(
      task,
      [" task-2 ", "", "task-2", "task-2"],
      userSession,
    );
    expect(validation.ids).toEqual(["task-2"]);
    expect(TasksDataGet).toHaveBeenCalledTimes(1);
  });

  it("should keep the given order after deduplication", async () => {
    const task = makeTask("task-1");
    (TasksDataGet as jest.Mock).mockResolvedValue(makeTask("task-9"));
    const validation = await validateDependencies(
      task,
      ["task-3", "task-2", "task-3"],
      userSession,
    );
    expect(validation.ids).toEqual(["task-3", "task-2"]);
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

  function makeProject(
    visibility: string,
    userAccess: ProjectUserAccess[],
  ): Project {
    const project = new Project();
    project.name = "P";
    project.visibility = visibility;
    project.userAccess = userAccess;
    return project;
  }

  const publicProject = makeProject("public", []);
  const memberProject = makeProject("restricted", [
    { userId: "user-1", permission: "all" },
  ]);
  const hiddenProject = makeProject("restricted", [
    { userId: "user-2", permission: "all" },
  ]);

  function makeTask(project: Project): Task {
    const task = new Task();
    task.projectId = project.id;
    task.title = "Task";
    return task;
  }

  beforeAll(async () => {
    app = Fastify();
    // The attachment upload route reads multipart parts; register the
    // plugin so POST /:id/attachments can be exercised end-to-end
    await app.register(fastifyMultipart);
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
    expect(TasksDataList).toHaveBeenCalledWith(
      {
        projectId: undefined,
        projectIds: undefined,
        doneSince: undefined,
        q: undefined,
        assigneeUserId: undefined,
        labels: undefined,
        limit: TASKS_DEFAULT_LIMIT,
        offset: 0,
        visibleTo: { userId: "user-1" },
      },
      undefined,
    );
  });

  it("should not scope the list for admins", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    await app.inject({ method: "GET", url: "/" });
    expect(TasksDataList).toHaveBeenCalledWith(
      {
        projectId: undefined,
        projectIds: undefined,
        doneSince: undefined,
        q: undefined,
        assigneeUserId: undefined,
        labels: undefined,
        limit: TASKS_DEFAULT_LIMIT,
        offset: 0,
        visibleTo: undefined,
      },
      undefined,
    );
  });

  it("should reject the list for unauthenticated requests with 401", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(401);
    expect(TasksDataList).not.toHaveBeenCalled();
  });

  it("should forward a search term to the data layer", async () => {
    await app.inject({ method: "GET", url: "/?q=report" });
    expect(TasksDataList).toHaveBeenCalledWith(
      {
        projectId: undefined,
        projectIds: undefined,
        doneSince: undefined,
        q: "report",
        assigneeUserId: undefined,
        labels: undefined,
        limit: TASKS_DEFAULT_LIMIT,
        offset: 0,
        visibleTo: { userId: "user-1" },
      },
      undefined,
    );
  });

  it("should ignore a whitespace-only search term", async () => {
    await app.inject({ method: "GET", url: "/?q=%20%20" });
    expect(TasksDataList).toHaveBeenCalledWith(
      {
        projectId: undefined,
        projectIds: undefined,
        doneSince: undefined,
        q: undefined,
        assigneeUserId: undefined,
        labels: undefined,
        limit: TASKS_DEFAULT_LIMIT,
        offset: 0,
        visibleTo: { userId: "user-1" },
      },
      undefined,
    );
  });

  it("should forward the projectIds subtree filter to the data layer", async () => {
    await app.inject({
      method: "GET",
      url: "/?projectIds=proj-1,proj-2",
    });
    expect(TasksDataList).toHaveBeenCalledWith(
      {
        projectId: undefined,
        projectIds: ["proj-1", "proj-2"],
        doneSince: undefined,
        q: undefined,
        assigneeUserId: undefined,
        labels: undefined,
        limit: TASKS_DEFAULT_LIMIT,
        offset: 0,
        visibleTo: { userId: "user-1" },
      },
      undefined,
    );
  });

  it("should not set projectIds when the param is absent", async () => {
    await app.inject({ method: "GET", url: "/" });
    expect(TasksDataList).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: undefined }),
      undefined,
    );
  });

  it("should forward limit and offset for pagination", async () => {
    await app.inject({ method: "GET", url: "/?limit=5&offset=10" });
    expect(TasksDataList).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, offset: 10 }),
      undefined,
    );
  });

  it("should answer 400 for an invalid limit or offset", async () => {
    for (const url of ["/?limit=0", "/?limit=abc", "/?limit=-1", "/?offset=-1", "/?offset=1.5"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(400);
    }
    expect(TasksDataList).not.toHaveBeenCalled();
  });

  it("should answer 400 for an invalid doneSince", async () => {
    const res = await app.inject({ method: "GET", url: "/?doneSince=garbage" });
    expect(res.statusCode).toBe(400);
    expect(TasksDataList).not.toHaveBeenCalled();
  });

  it("should forward a normalized doneSince", async () => {
    await app.inject({ method: "GET", url: "/?doneSince=2026-08-14" });
    expect(TasksDataList).toHaveBeenCalledWith(
      expect.objectContaining({ doneSince: "2026-08-14T00:00:00.000Z" }),
      undefined,
    );
  });

  it("should forward the assigneeUserId filter to the data layer", async () => {
    await app.inject({ method: "GET", url: "/?assigneeUserId=user-2" });
    expect(TasksDataList).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeUserId: "user-2" }),
      undefined,
    );
  });

  it("should forward the parsed labels filter to the data layer", async () => {
    await app.inject({ method: "GET", url: "/?labels=urgent,ui" });
    expect(TasksDataList).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["urgent", "ui"] }),
      undefined,
    );
  });

  it("should ignore an empty or whitespace-only labels param", async () => {
    for (const url of ["/?labels=", "/?labels=%20,%20", "/?labels=,"]) {
      await app.inject({ method: "GET", url });
      expect(TasksDataList).toHaveBeenLastCalledWith(
        expect.objectContaining({ labels: undefined }),
        undefined,
      );
    }
  });

  it("should compose the labels filter with q and doneSince", async () => {
    await app.inject({
      method: "GET",
      url: "/?labels=urgent&q=report&doneSince=2026-08-14",
    });
    expect(TasksDataList).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: ["urgent"],
        q: "report",
        doneSince: "2026-08-14T00:00:00.000Z",
      }),
      undefined,
    );
  });

  it("should return only the requested fields when fields is sent", async () => {
    const task = makeTask(publicProject);
    (TasksDataList as jest.Mock).mockResolvedValue([task]);
    const res = await app.inject({
      method: "GET",
      url: `/?fields=id,title&projectId=${publicProject.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(TasksDataList).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: publicProject.id }),
      new Set(["id", "title"]),
    );
    expect(res.json()).toEqual([{ id: task.id, title: task.title }]);
  });

  it("should keep the full shape when fields is a wildcard, unknown-only or absent", async () => {
    const task = makeTask(publicProject);
    (TasksDataList as jest.Mock).mockResolvedValue([task]);
    for (const url of ["/", "/?fields=*", "/?fields=bogus"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(TasksDataList).toHaveBeenLastCalledWith(
        expect.anything(),
        undefined,
      );
      expect(res.json()[0]).toEqual(task.toTransportJson());
    }
  });

  it("should keep the by-id endpoint on the full shape regardless of fields", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "GET",
      url: `/${task.id}?fields=id,title`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(task.toTransportJson());
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

  it("should trim and de-duplicate the labels given at creation", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        projectId: publicProject.id,
        title: "New",
        labels: [" urgent ", "bug", "urgent"],
      },
    });
    expect(res.statusCode).toBe(201);
    expect((TasksDataAdd as jest.Mock).mock.calls[0][0].labels).toEqual([
      "urgent",
      "bug",
    ]);
  });

  it("should reject invalid labels at creation with 400", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    for (const labels of ["urgent", [1], [""], ["x".repeat(MAX_LABEL_LENGTH + 1)]]) {
      const res = await app.inject({
        method: "POST",
        url: "/",
        payload: { projectId: publicProject.id, title: "New", labels },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("labels");
    }
    expect(TasksDataAdd).not.toHaveBeenCalled();
  });

  it("should reject creating a task with a status outside the project catalog", async () => {
    const project = makeProject("public", []);
    project.statuses = ["To Do", "Done"];
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: project.id, title: "New", status: "Nonsense" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("status");
    expect(TasksDataAdd).not.toHaveBeenCalled();
  });

  it("should create a task with a status from the project catalog", async () => {
    const project = makeProject("public", []);
    project.statuses = ["To Do", "Done"];
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: project.id, title: "New", status: "Done" },
    });
    expect(res.statusCode).toBe(201);
    expect((TasksDataAdd as jest.Mock).mock.calls[0][0].status).toBe("Done");
  });

  it("should start a task without a status in the first status of a project without To Do", async () => {
    const project = makeProject("public", []);
    project.statuses = ["Backlog", "In Progress", "Done"];
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: project.id, title: "New" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("Backlog");
    expect((TasksDataAdd as jest.Mock).mock.calls[0][0].status).toBe("Backlog");
  });

  it("should start a task without a status in To Do for a standard project", async () => {
    const project = makeProject("public", []);
    project.statuses = ["To Do", "In Progress", "Done"];
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: project.id, title: "New" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("To Do");
    expect((TasksDataAdd as jest.Mock).mock.calls[0][0].status).toBe("To Do");
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

  // ==================== STATUS VALIDATION ====================
  it("should reject updating a task to a status outside the project catalog", async () => {
    const project = makeProject("public", []);
    project.statuses = ["To Do", "Done"];
    const task = makeTask(project);
    task.status = "To Do";
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);

    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { status: "Nonsense" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("status");
    expect(TasksDataUpdate).not.toHaveBeenCalled();
    expect(task.status).toBe("To Do");
  });

  it("should accept updating a task to a status from the project catalog", async () => {
    const project = makeProject("public", []);
    project.statuses = ["To Do", "Done"];
    const task = makeTask(project);
    task.status = "To Do";
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);

    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { status: "Done" },
    });

    expect(res.statusCode).toBe(201);
    expect(task.status).toBe("Done");
    expect(TasksDataUpdate).toHaveBeenCalledWith(task);
  });

  it("should validate the status against the move target project", async () => {
    const from = makeProject("public", []);
    from.statuses = ["To Do"];
    const to = makeProject("public", []);
    to.statuses = ["Backlog", "Done"];
    const task = makeTask(from);
    task.status = "To Do";
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === to.id ? to : from,
    );

    const rejected = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { projectId: to.id, status: "Nonsense" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(task.projectId).toBe(from.id);

    const accepted = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { projectId: to.id, status: "Done" },
    });
    expect(accepted.statusCode).toBe(201);
    expect(task.projectId).toBe(to.id);
    expect(task.status).toBe("Done");
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
    expect(replaceLabels).not.toHaveBeenCalled();
  });

  it("should replace the labels atomically with a single call", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/labels`,
      payload: { labels: ["urgent", "bug"] },
    });

    expect(res.statusCode).toBe(201);
    expect(replaceLabels).toHaveBeenCalledTimes(1);
    expect(replaceLabels).toHaveBeenCalledWith(task.id, ["urgent", "bug"]);
  });

  it("should accept an empty labels array as clearing all labels", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/labels`,
      payload: { labels: [] },
    });

    expect(res.statusCode).toBe(201);
    expect(replaceLabels).toHaveBeenCalledWith(task.id, []);
  });

  it("should answer 400 when labels is not an array of strings", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    for (const labels of [null, "urgent", [1, 2], [{}], [["nested"]]]) {
      const res = await app.inject({
        method: "POST",
        url: `/${task.id}/labels`,
        payload: { labels },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("labels");
    }
    expect(replaceLabels).not.toHaveBeenCalled();
  });

  it("should trim and de-duplicate the replacement labels", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/labels`,
      payload: { labels: [" urgent ", "bug", "urgent"] },
    });

    expect(res.statusCode).toBe(201);
    expect(replaceLabels).toHaveBeenCalledWith(task.id, ["urgent", "bug"]);
  });

  it("should reject trimmed-empty or too long replacement labels with 400", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    for (const labels of [[""], ["  "], ["x".repeat(MAX_LABEL_LENGTH + 1)]]) {
      const res = await app.inject({
        method: "POST",
        url: `/${task.id}/labels`,
        payload: { labels },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("labels");
    }
    expect(replaceLabels).not.toHaveBeenCalled();
  });

  // ==================== LABELS (PATCH, atomic) ====================
  it("should add and remove labels atomically and return the full list", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (MutateTaskLabels as jest.Mock).mockResolvedValue({
      labels: ["bug", "urgent"],
      changed: true,
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/${task.id}/labels`,
      payload: { add: [" urgent "], remove: ["stale"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ labels: ["bug", "urgent"], changed: true });
    expect(MutateTaskLabels).toHaveBeenCalledTimes(1);
    expect(MutateTaskLabels).toHaveBeenCalledWith(task.id, ["urgent"], [
      "stale",
    ]);
    expect(TasksDataTouch).toHaveBeenCalledWith(task.id);
    expect(TaskActivityDataAdd).toHaveBeenCalledWith(
      task.id,
      "user-1",
      "Labels updated",
    );
  });

  it("should treat an absent add or remove list as empty", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (MutateTaskLabels as jest.Mock).mockResolvedValue({
      labels: ["urgent"],
      changed: true,
    });

    await app.inject({
      method: "PATCH",
      url: `/${task.id}/labels`,
      payload: { add: ["urgent"] },
    });
    expect(MutateTaskLabels).toHaveBeenLastCalledWith(task.id, ["urgent"], []);

    await app.inject({
      method: "PATCH",
      url: `/${task.id}/labels`,
      payload: { remove: ["urgent"] },
    });
    expect(MutateTaskLabels).toHaveBeenLastCalledWith(task.id, [], ["urgent"]);

    await app.inject({
      method: "PATCH",
      url: `/${task.id}/labels`,
      payload: {},
    });
    expect(MutateTaskLabels).toHaveBeenLastCalledWith(task.id, [], []);
  });

  it("should skip the touch and the activity entry when nothing changed", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (MutateTaskLabels as jest.Mock).mockResolvedValue({
      labels: ["urgent"],
      changed: false,
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/${task.id}/labels`,
      payload: { add: ["urgent"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ labels: ["urgent"], changed: false });
    expect(TasksDataTouch).not.toHaveBeenCalled();
    expect(TaskActivityDataAdd).not.toHaveBeenCalled();
  });

  it("should keep quiet mutations out of the activity feed but still touch the task", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (MutateTaskLabels as jest.Mock).mockResolvedValue({
      labels: ["agent:running"],
      changed: true,
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/${task.id}/labels`,
      payload: { add: ["agent:running"], quiet: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      labels: ["agent:running"],
      changed: true,
    });
    expect(TasksDataTouch).toHaveBeenCalledWith(task.id);
    expect(TaskActivityDataAdd).not.toHaveBeenCalled();
  });

  it("should answer 400 for invalid PATCH label payloads", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ add: "urgent" }, "add"],
      [{ add: [1] }, "add"],
      [{ add: [""] }, "add"],
      [{ add: ["x".repeat(MAX_LABEL_LENGTH + 1)] }, "add"],
      [{ remove: "stale" }, "remove"],
      [{ remove: ["  "] }, "remove"],
      [{ remove: [{}] }, "remove"],
      [{ quiet: "yes" }, "quiet"],
      [{ quiet: 1 }, "quiet"],
    ];
    for (const [payload, field] of cases) {
      const res = await app.inject({
        method: "PATCH",
        url: `/${task.id}/labels`,
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain(field);
    }
    expect(MutateTaskLabels).not.toHaveBeenCalled();
  });

  it("should answer 404 for a PATCH on a task the user cannot see", async () => {
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "PATCH",
      url: `/${task.id}/labels`,
      payload: { add: ["urgent"] },
    });
    expect(res.statusCode).toBe(404);
    expect(MutateTaskLabels).not.toHaveBeenCalled();
  });

  it("should require the update permission for PATCH", async () => {
    for (const [permission, expected] of [
      ["view", 403],
      ["comment", 403],
      ["update", 200],
      ["all", 200],
    ] as const) {
      (MutateTaskLabels as jest.Mock).mockResolvedValue({
        labels: [],
        changed: false,
      });
      const project = makeProject("restricted", [
        { userId: "user-1", permission },
      ]);
      const task = makeTask(project);
      (TasksDataGet as jest.Mock).mockResolvedValue(task);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      const res = await app.inject({
        method: "PATCH",
        url: `/${task.id}/labels`,
        payload: { add: ["urgent"] },
      });
      expect(res.statusCode).toBe(expected);
    }
  });

  it("should reject an unauthenticated PATCH with 401", async () => {
    // Mirror the real guard: it answers 401 itself, then throws so the
    // route handler stops
    (AuthMustBeAuthenticated as jest.Mock).mockImplementation(
      async (_req: unknown, res: { status: (code: number) => { send: (body: unknown) => void } }) => {
        res.status(401).send({ error: "Access Denied" });
        throw new Error("Access Denied");
      },
    );
    const res = await app.inject({
      method: "PATCH",
      url: "/task-1/labels",
      payload: { add: ["urgent"] },
    });
    expect(res.statusCode).toBe(401);
    expect(MutateTaskLabels).not.toHaveBeenCalled();
  });

  // ==================== DEPENDENCIES ====================
  it("should create a task with dependencies", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(makeTask(publicProject));
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        projectId: publicProject.id,
        title: "Blocked task",
        dependencies: ["task-dep-1", "task-dep-1", " task-dep-2 "],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(TasksDataAdd).toHaveBeenCalledTimes(1);
    const created = (TasksDataAdd as jest.Mock).mock.calls[0][0] as Task;
    expect(created.dependencies).toEqual([
      { taskId: "task-dep-1" },
      { taskId: "task-dep-2" },
    ]);
  });

  it("should answer 404 when a created task references an invisible dependency", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        projectId: publicProject.id,
        title: "Blocked task",
        dependencies: ["missing-task"],
      },
    });
    expect(res.statusCode).toBe(404);
    expect(TasksDataAdd).not.toHaveBeenCalled();
  });

  it("should replace the dependencies atomically with a single call", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/dependencies`,
      payload: { dependencies: ["task-dep-1", "task-dep-2"] },
    });

    expect(res.statusCode).toBe(201);
    expect(replaceDependencies).toHaveBeenCalledTimes(1);
    expect(replaceDependencies).toHaveBeenCalledWith(task.id, [
      "task-dep-1",
      "task-dep-2",
    ]);
    expect(TasksDataTouch).toHaveBeenCalledWith(task.id);
  });

  it("should accept an empty dependencies array as clearing all dependencies", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/dependencies`,
      payload: { dependencies: [] },
    });

    expect(res.statusCode).toBe(201);
    expect(replaceDependencies).toHaveBeenCalledWith(task.id, []);
  });

  it("should answer 400 when dependencies is not an array of task ids", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    for (const dependencies of [null, "task-2", [1, 2], [{}]]) {
      const res = await app.inject({
        method: "POST",
        url: `/${task.id}/dependencies`,
        payload: { dependencies },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("dependencies");
    }
    expect(replaceDependencies).not.toHaveBeenCalled();
  });

  it("should answer 400 when a task is made to depend on itself", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/dependencies`,
      payload: { dependencies: [task.id] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("itself");
    expect(replaceDependencies).not.toHaveBeenCalled();
  });

  it("should answer 404 when a dependency task is not visible to the user", async () => {
    const task = makeTask(publicProject);
    const hiddenDependency = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === task.id ? task : hiddenDependency,
    );
    (ProjectsDataGet as jest.Mock).mockImplementation(async (projectId) =>
      projectId === hiddenProject.id ? hiddenProject : publicProject,
    );

    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/dependencies`,
      payload: { dependencies: [hiddenDependency.id] },
    });

    expect(res.statusCode).toBe(404);
    expect(replaceDependencies).not.toHaveBeenCalled();
  });

  it("should reject dependency changes on a task the user cannot see", async () => {
    const task = makeTask(hiddenProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/dependencies`,
      payload: { dependencies: ["task-dep-1"] },
    });
    expect(res.statusCode).toBe(404);
    expect(replaceDependencies).not.toHaveBeenCalled();
  });

  it("should reject updating the dependencies of a task in an archived project", async () => {
    const task = makeTask(publicProject);
    const archivedProject = makeProject("public", []);
    archivedProject.archived = true;
    task.projectId = archivedProject.id;
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);

    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/dependencies`,
      payload: { dependencies: ["task-dep-1"] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Project is archived");
    expect(replaceDependencies).not.toHaveBeenCalled();
  });

  // ==================== ATTACHMENTS ====================
  it("should answer 401 for attachment downloads without a session", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({
      method: "GET",
      url: "/task-1/attachments/att-1",
    });
    expect(res.statusCode).toBe(401);
    expect(getTaskAttachment).not.toHaveBeenCalled();
  });

  it("should serve a raster image inline with a sandbox CSP", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (getTaskAttachment as jest.Mock).mockResolvedValue({
      id: "att-1",
      taskId: task.id,
      fileName: "photo.png",
      filePath: "/data/attachments/tasks/att-1.png",
      dateCreated: "2026-09-01T00:00:00.000Z",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.createReadStream.mockReturnValue(Readable.from(["fake-bytes"]));

    const res = await app.inject({
      method: "GET",
      url: `/${task.id}/attachments/att-1?inline=true`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(res.headers["content-security-policy"]).toBe("sandbox");
  });

  it("should serve PDF files inline without a sandbox CSP", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (getTaskAttachment as jest.Mock).mockResolvedValue({
      id: "att-pdf",
      taskId: task.id,
      fileName: "spec.pdf",
      filePath: "/data/attachments/tasks/att-pdf.pdf",
      dateCreated: "2026-10-18T00:00:00.000Z",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.createReadStream.mockReturnValue(Readable.from(["pdf-bytes"]));

    const res = await app.inject({
      method: "GET",
      url: `/${task.id}/attachments/att-pdf?inline=true`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("inline");
    // A sandbox CSP blocks the browser's built-in PDF viewer
    expect(res.headers["content-security-policy"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("should always force SVG files to download, even with inline=true", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (getTaskAttachment as jest.Mock).mockResolvedValue({
      id: "att-2",
      taskId: task.id,
      fileName: "logo.svg",
      filePath: "/data/attachments/tasks/att-2.svg",
      dateCreated: "2026-09-01T00:00:00.000Z",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.createReadStream.mockReturnValue(Readable.from(["<svg/>"]));

    const res = await app.inject({
      method: "GET",
      url: `/${task.id}/attachments/att-2?inline=true`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).not.toContain("inline");
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  it("should serve non-image files as attachments", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (getTaskAttachment as jest.Mock).mockResolvedValue({
      id: "att-3",
      taskId: task.id,
      fileName: "spec.pdf",
      filePath: "/data/attachments/tasks/att-3.pdf",
      dateCreated: "2026-09-01T00:00:00.000Z",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.createReadStream.mockReturnValue(Readable.from(["pdf"]));

    const res = await app.inject({
      method: "GET",
      url: `/${task.id}/attachments/att-3`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
  });

  it("should serve audio attachments inline with audio content types", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.createReadStream.mockReturnValue(Readable.from(["audio-bytes"]));

    for (const [fileName, mimeType] of [
      ["voice-message.webm", "audio/webm"],
      ["voice-message.m4a", "audio/mp4"],
    ]) {
      const task = makeTask(publicProject);
      (TasksDataGet as jest.Mock).mockResolvedValue(task);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
      (getTaskAttachment as jest.Mock).mockResolvedValue({
        id: "att-audio",
        taskId: task.id,
        fileName,
        filePath: `/data/attachments/tasks/att-audio.${fileName.split(".").pop()}`,
        dateCreated: "2026-10-17T00:00:00.000Z",
      });

      const res = await app.inject({
        method: "GET",
        url: `/${task.id}/attachments/att-audio?inline=true`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain(mimeType);
      expect(res.headers["content-disposition"]).toContain("inline");
      expect(res.headers["content-security-policy"]).toBe("sandbox");
    }
  });

  it("should enqueue a voice comment job when an audio attachment is uploaded", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.ensureDir.mockResolvedValue(undefined);
    mockFs.createWriteStream.mockReturnValue(
      new Writable({ write(_chunk, _enc, cb) { cb(); } }),
    );

    const boundary = "----jestformboundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="voice-message.webm"',
      "Content-Type: audio/webm",
      "",
      "fake-audio-bytes",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/attachments?language=fr`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      fileName: "voice-message.webm",
    });
    expect(addTaskAttachment).toHaveBeenCalledTimes(1);
    expect(TaskVoiceCommentsEnqueue).toHaveBeenCalledTimes(1);
    expect(TaskVoiceCommentsEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.id,
        userId: "user-1",
        userName: "User",
        fileName: "voice-message.webm",
        mimeType: "audio/webm",
        requestedLanguage: "fr",
      }),
    );
  });

  it("should not enqueue a voice comment job for non-audio attachments", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.ensureDir.mockResolvedValue(undefined);
    mockFs.createWriteStream.mockReturnValue(
      new Writable({ write(_chunk, _enc, cb) { cb(); } }),
    );

    const boundary = "----jestformboundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="notes.pdf"',
      "Content-Type: application/pdf",
      "",
      "fake-pdf-bytes",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/attachments`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().fileName).toBe("notes.pdf");
    expect(TaskVoiceCommentsEnqueue).not.toHaveBeenCalled();
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
    task.dependencies = [
      { taskId: "task-dep-1", title: "Dependency", status: "Done" },
    ];
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
    expect(clone.dependencies).toEqual([{ taskId: "task-dep-1" }]);
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
    expect(replaceLabels).not.toHaveBeenCalled();
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

describe("TasksRoutes update feed (activity)", () => {
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

  function makeTask(project: Project): Task {
    const task = new Task();
    task.projectId = project.id;
    task.title = "Task";
    return task;
  }

  function makeProject(
    visibility: string,
    userAccess: ProjectUserAccess[],
  ): Project {
    const project = new Project();
    project.name = "P";
    project.visibility = visibility;
    project.userAccess = userAccess;
    return project;
  }

  const publicProject = makeProject("public", []);

  beforeAll(async () => {
    app = Fastify();
    await new TasksRoutes().getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (AuthMustBeAuthenticated as jest.Mock).mockResolvedValue(undefined);
    (TaskActivityDataList as jest.Mock).mockResolvedValue([]);
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== GET /activity ====================
  it("should answer 401 for unauthenticated requests", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/activity" });
    expect(res.statusCode).toBe(401);
    expect(TaskActivityDataList).not.toHaveBeenCalled();
  });

  it("should scope the feed to the tasks the user is assigned to, visible projects only", async () => {
    const res = await app.inject({ method: "GET", url: "/activity" });
    expect(res.statusCode).toBe(200);
    expect(TaskActivityDataList).toHaveBeenCalledWith({
      assigneeUserId: "user-1",
      limit: TASKS_DEFAULT_LIMIT,
      offset: 0,
      visibleTo: { userId: "user-1" },
    });
  });

  it("should give admins the visibility bypass but keep the assignee scope", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    await app.inject({ method: "GET", url: "/activity" });
    expect(TaskActivityDataList).toHaveBeenCalledWith({
      assigneeUserId: "admin-1",
      limit: TASKS_DEFAULT_LIMIT,
      offset: 0,
      visibleTo: undefined,
    });
  });

  it("should forward limit and offset for pagination", async () => {
    await app.inject({ method: "GET", url: "/activity?limit=5&offset=10" });
    expect(TaskActivityDataList).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeUserId: "user-1",
        limit: 5,
        offset: 10,
      }),
    );
  });

  it("should answer 400 for an invalid limit or offset", async () => {
    for (const url of [
      "/activity?limit=0",
      "/activity?limit=abc",
      "/activity?offset=-1",
      "/activity?offset=1.5",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(400);
    }
    expect(TaskActivityDataList).not.toHaveBeenCalled();
  });

  it("should return the feed entries", async () => {
    const entries = [
      {
        id: "act-1",
        taskId: "task-1",
        taskTitle: "Write report",
        actorName: "User",
        summary: "New comment",
        dateCreated: "2026-10-04T08:00:00.000Z",
      },
    ];
    (TaskActivityDataList as jest.Mock).mockResolvedValue(entries);
    const res = await app.inject({ method: "GET", url: "/activity" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(entries);
  });

  // ==================== RECORDING ====================
  it("should record an activity entry with the change summary on task update", async () => {
    const task = makeTask(publicProject);
    task.status = "To Do";
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { status: "Done", dueDate: "2026-10-10" },
    });
    expect(res.statusCode).toBe(201);
    expect(TaskActivityDataAdd).toHaveBeenCalledWith(
      task.id,
      "user-1",
      "status: Done, due date",
    );
  });

  it("should not record an activity entry when a task update changes nothing", async () => {
    const task = makeTask(publicProject);
    task.status = "To Do";
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    await app.inject({ method: "PUT", url: `/${task.id}`, payload: {} });
    expect(TaskActivityDataAdd).not.toHaveBeenCalled();
  });

  it("should not record an activity entry on task creation", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: publicProject.id, title: "New" },
    });
    expect(res.statusCode).toBe(201);
    expect(TaskActivityDataAdd).not.toHaveBeenCalled();
  });

  it("should record an activity entry when a comment is added", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (UsersDataGet as jest.Mock).mockResolvedValue({ name: "User" });
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/comments`,
      payload: { text: "Hello" },
    });
    expect(res.statusCode).toBe(201);
    expect(TaskActivityDataAdd).toHaveBeenCalledWith(
      task.id,
      "user-1",
      "New comment",
    );
  });

  it("should record an activity entry when a comment is updated", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (getComment as jest.Mock).mockResolvedValue({
      id: "c-1",
      userId: "user-1",
      text: "Hello",
    });
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}/comments/c-1`,
      payload: { text: "Edited" },
    });
    expect(res.statusCode).toBe(200);
    expect(TaskActivityDataAdd).toHaveBeenCalledWith(
      task.id,
      "user-1",
      "Comment updated",
    );
  });

  it("should record an activity entry when a comment is deleted", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (getComment as jest.Mock).mockResolvedValue({
      id: "c-1",
      userId: "user-1",
      text: "Hello",
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/${task.id}/comments/c-1`,
    });
    expect(res.statusCode).toBe(201);
    expect(TaskActivityDataAdd).toHaveBeenCalledWith(
      task.id,
      "user-1",
      "Comment deleted",
    );
  });

  it("should record an activity entry when an assignee is added", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/assignees`,
      payload: { userId: "user-2" },
    });
    expect(res.statusCode).toBe(201);
    expect(TaskActivityDataAdd).toHaveBeenCalledWith(
      task.id,
      "user-1",
      "Assignees updated",
    );
  });

  it("should record an activity entry when an assignee is removed", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "DELETE",
      url: `/${task.id}/assignees/user-2`,
    });
    expect(res.statusCode).toBe(201);
    expect(TaskActivityDataAdd).toHaveBeenCalledWith(
      task.id,
      "user-1",
      "Assignees updated",
    );
  });

  it("should record an activity entry when labels are updated", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/labels`,
      payload: { labels: ["urgent"] },
    });
    expect(res.statusCode).toBe(201);
    expect(TaskActivityDataAdd).toHaveBeenCalledWith(
      task.id,
      "user-1",
      "Labels updated",
    );
  });

  it("should record an activity entry when an attachment is deleted", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
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
    expect(res.statusCode).toBe(201);
    expect(TaskActivityDataAdd).toHaveBeenCalledWith(
      task.id,
      "user-1",
      "Attachment deleted",
    );
  });

  it("should not fail the mutation when recording the activity fails", async () => {
    const task = makeTask(publicProject);
    task.status = "To Do";
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (TaskActivityDataAdd as jest.Mock).mockRejectedValueOnce(
      new Error("db down"),
    );
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { status: "Done" },
    });
    expect(res.statusCode).toBe(201);
    expect(TasksDataUpdate).toHaveBeenCalledWith(task);
  });

  it("should record an activity entry when dependencies are updated", async () => {
    const task = makeTask(publicProject);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: `/${task.id}/dependencies`,
      payload: { dependencies: ["task-dep-1"] },
    });
    expect(res.statusCode).toBe(201);
    expect(TaskActivityDataAdd).toHaveBeenCalledWith(
      task.id,
      "user-1",
      "Dependencies updated",
    );
  });
});

describe("TasksRoutes with recurrence removed", () => {
  let app: FastifyInstance;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  const publicProject = new Project();
  publicProject.name = "P";
  publicProject.visibility = "public";
  publicProject.userAccess = [];
  publicProject.statuses = ["To Do", "In Progress", "Done"];

  function makeTask(fields: Partial<Task> = {}): Task {
    const task = new Task();
    task.projectId = publicProject.id;
    task.title = "Task";
    Object.assign(task, fields);
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
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should ignore a recurrence field in the create payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        projectId: publicProject.id,
        title: "Weekly chore",
        dueDate: "2026-10-19",
        recurrence: { frequency: "weekly", interval: 1, weekdays: [1] },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().recurrence).toBeUndefined();
    const created = (TasksDataAdd as jest.Mock).mock.calls[0][0] as Task;
    expect(created).not.toHaveProperty("recurrence");
  });

  it("should ignore a recurrence field in the update payload", async () => {
    const task = makeTask({ dueDate: "2026-10-19" });
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { recurrence: { frequency: "daily", interval: 1 } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().recurrence).toBeUndefined();
  });
});

describe("isCancelTaskRequest", () => {
  it("should detect the cancel signature (status Done + new cancelled suffix)", () => {
    expect(
      isCancelTaskRequest({ status: "Done", title: "Task [cancelled]" }, "Task"),
    ).toBe(true);
  });

  it("should not detect a plain status move or a plain rename", () => {
    expect(isCancelTaskRequest({ status: "Done" }, "Task")).toBe(false);
    expect(isCancelTaskRequest({ title: "Task [cancelled]" }, "Task")).toBe(
      false,
    );
    expect(isCancelTaskRequest({ status: "Done", title: "Task" }, "Task")).toBe(
      false,
    );
    expect(isCancelTaskRequest({}, "Task")).toBe(false);
  });

  it("should not detect a re-cancel where the title already had the suffix", () => {
    expect(
      isCancelTaskRequest(
        { status: "Done", title: "Task [cancelled]" },
        "Task [cancelled]",
      ),
    ).toBe(false);
  });
});

describe("TasksRoutes project permission levels", () => {
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

  function projectWithLevel(permission: string): Project {
    const project = new Project();
    project.name = "P";
    project.visibility = "restricted";
    if (permission) {
      project.userAccess = [
        { userId: "user-1", permission: permission as never },
      ];
    } else {
      // No membership: the user cannot see the project at all
      project.userAccess = [] as never;
    }
    return project;
  }

  function makeTask(project: Project): Task {
    const task = new Task();
    task.projectId = project.id;
    task.title = "Task";
    return task;
  }

  beforeAll(async () => {
    app = Fastify();
    await app.register(fastifyMultipart);
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

  it("should let every level read a restricted project's task", async () => {
    for (const permission of ["view", "comment", "update", "all"]) {
      jest.clearAllMocks();
      const project = projectWithLevel(permission);
      const task = makeTask(project);
      (TasksDataGet as jest.Mock).mockResolvedValue(task);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      const res = await app.inject({ method: "GET", url: `/${task.id}` });
      expect(res.statusCode).toBe(200);
    }
  });

  it("should answer 404 (not 403) for writes on an invisible project", async () => {
    const project = projectWithLevel(null);
    const task = makeTask(project);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const responses = [
      await app.inject({
        method: "POST",
        url: "/",
        payload: { projectId: project.id, title: "New" },
      }),
      await app.inject({
        method: "PUT",
        url: `/${task.id}`,
        payload: { title: "Renamed" },
      }),
      await app.inject({ method: "DELETE", url: `/${task.id}` }),
      await app.inject({ method: "POST", url: `/${task.id}/clone` }),
      await app.inject({
        method: "POST",
        url: `/${task.id}/comments`,
        payload: { text: "hi" },
      }),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(404);
    }
    expect(TasksDataAdd).not.toHaveBeenCalled();
    expect(TasksDataUpdate).not.toHaveBeenCalled();
    expect(TasksDataDelete).not.toHaveBeenCalled();
  });

  // ==================== CREATE (update) ====================
  it("should require the update level to create a task", async () => {
    for (const [permission, expected] of [
      ["view", 403],
      ["comment", 403],
      ["update", 201],
      ["all", 201],
    ] as const) {
      jest.clearAllMocks();
      (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
      const project = projectWithLevel(permission);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      const res = await app.inject({
        method: "POST",
        url: "/",
        payload: { projectId: project.id, title: "New" },
      });
      expect(res.statusCode).toBe(expected);
      if (expected === 403) {
        expect(res.json().error).toBe(
          "Access Denied: this action requires the update permission on the project",
        );
        expect(TasksDataAdd).not.toHaveBeenCalled();
      }
    }
  });

  it("should let an admin create a task on a view-level project", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    const project = projectWithLevel("view");
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: project.id, title: "New" },
    });
    expect(res.statusCode).toBe(201);
  });

  // ==================== UPDATE (update, cancel = all) ====================
  it("should require the update level to update a task", async () => {
    for (const [permission, expected] of [
      ["view", 403],
      ["comment", 403],
      ["update", 201],
      ["all", 201],
    ] as const) {
      jest.clearAllMocks();
      (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
      const project = projectWithLevel(permission);
      const task = makeTask(project);
      (TasksDataGet as jest.Mock).mockResolvedValue(task);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      const res = await app.inject({
        method: "PUT",
        url: `/${task.id}`,
        payload: { title: "Renamed" },
      });
      expect(res.statusCode).toBe(expected);
    }
  });

  it("should require the all level for the Cancel flow", async () => {
    for (const [permission, expected] of [
      ["view", 403],
      ["comment", 403],
      ["update", 403],
      ["all", 201],
    ] as const) {
      jest.clearAllMocks();
      (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
      const project = projectWithLevel(permission);
      const task = makeTask(project);
      (TasksDataGet as jest.Mock).mockResolvedValue(task);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      const res = await app.inject({
        method: "PUT",
        url: `/${task.id}`,
        payload: { status: "Done", title: "Task [cancelled]" },
      });
      expect(res.statusCode).toBe(expected);
      if (expected === 403) {
        expect(res.json().error).toBe(
          "Access Denied: this action requires the all permission on the project",
        );
      }
    }
  });

  it("should let an admin run the Cancel flow on an update-level project", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    const project = projectWithLevel("update");
    const task = makeTask(project);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}`,
      payload: { status: "Done", title: "Task [cancelled]" },
    });
    expect(res.statusCode).toBe(201);
  });

  // ==================== DELETE (all) ====================
  it("should require the all level to delete a task", async () => {
    for (const [permission, expected] of [
      ["view", 403],
      ["comment", 403],
      ["update", 403],
      ["all", 201],
    ] as const) {
      jest.clearAllMocks();
      (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
      const project = projectWithLevel(permission);
      const task = makeTask(project);
      (TasksDataGet as jest.Mock).mockResolvedValue(task);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      const res = await app.inject({ method: "DELETE", url: `/${task.id}` });
      expect(res.statusCode).toBe(expected);
      if (expected === 403) {
        expect(TasksDataDelete).not.toHaveBeenCalled();
      }
    }
  });

  // ==================== CLONE (all) ====================
  it("should require the all level to clone a task", async () => {
    for (const [permission, expected] of [
      ["view", 403],
      ["comment", 403],
      ["update", 403],
      ["all", 201],
    ] as const) {
      jest.clearAllMocks();
      (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
      const project = projectWithLevel(permission);
      const task = makeTask(project);
      (TasksDataGet as jest.Mock).mockResolvedValue(task);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      const res = await app.inject({
        method: "POST",
        url: `/${task.id}/clone`,
      });
      expect(res.statusCode).toBe(expected);
    }
  });

  // ==================== COMMENTS (comment) ====================
  it("should require the comment level to add a comment", async () => {
    for (const [permission, expected] of [
      ["view", 403],
      ["comment", 201],
      ["update", 201],
      ["all", 201],
    ] as const) {
      jest.clearAllMocks();
      (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
      const project = projectWithLevel(permission);
      const task = makeTask(project);
      (TasksDataGet as jest.Mock).mockResolvedValue(task);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      const res = await app.inject({
        method: "POST",
        url: `/${task.id}/comments`,
        payload: { text: "hi" },
      });
      expect(res.statusCode).toBe(expected);
      if (expected === 403) {
        expect(addComment).not.toHaveBeenCalled();
      }
    }
  });

  it("should let a comment user edit and delete their own comment", async () => {
    const project = projectWithLevel("comment");
    const task = makeTask(project);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    (getComment as jest.Mock).mockResolvedValue({
      id: "comment-1",
      userId: "user-1",
      text: "hi",
    });

    const put = await app.inject({
      method: "PUT",
      url: `/${task.id}/comments/comment-1`,
      payload: { text: "edited" },
    });
    expect(put.statusCode).toBe(200);

    const del = await app.inject({
      method: "DELETE",
      url: `/${task.id}/comments/comment-1`,
    });
    expect(del.statusCode).toBe(201);
  });

  it("should reject a view user editing their own comment with 403", async () => {
    const project = projectWithLevel("view");
    const task = makeTask(project);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    (getComment as jest.Mock).mockResolvedValue({
      id: "comment-1",
      userId: "user-1",
      text: "hi",
    });
    const res = await app.inject({
      method: "PUT",
      url: `/${task.id}/comments/comment-1`,
      payload: { text: "edited" },
    });
    expect(res.statusCode).toBe(403);
    expect(updateComment).not.toHaveBeenCalled();
  });

  // ==================== SUB-RESOURCES (update) ====================
  it("should require the update level for assignees, labels, dependencies and attachments", async () => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["POST", "assignees", { userId: "user-2" }],
      ["POST", "labels", { labels: ["bug"] }],
      ["POST", "dependencies", { dependencies: [] }],
    ];
    for (const [method, path, payload] of cases) {
      for (const [permission, expected] of [
        ["view", 403],
        ["comment", 403],
        ["update", 201],
        ["all", 201],
      ] as const) {
        jest.clearAllMocks();
        (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
        const project = projectWithLevel(permission);
        const task = makeTask(project);
        (TasksDataGet as jest.Mock).mockResolvedValue(task);
        (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
        const res = await app.inject({
          method: method as "POST",
          url: `/${task.id}/${path}`,
          payload,
        });
        expect(res.statusCode).toBe(expected);
      }
    }

    // Attachment upload: the guard runs before the multipart handling
    for (const [permission, expected] of [
      ["view", 403],
      ["comment", 403],
      ["update", 201],
      ["all", 201],
    ] as const) {
      jest.clearAllMocks();
      (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
      const project = projectWithLevel(permission);
      const task = makeTask(project);
      (TasksDataGet as jest.Mock).mockResolvedValue(task);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
      const mockFs = require("fs-extra") as any;
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.createWriteStream.mockReturnValue(
        new Writable({ write(_chunk, _enc, cb) { cb(); } }),
      );
      const boundary = "----jestformboundary";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="notes.pdf"',
        "Content-Type: application/pdf",
        "",
        "fake-pdf-bytes",
        `--${boundary}--`,
        "",
      ].join("\r\n");
      const res = await app.inject({
        method: "POST",
        url: `/${task.id}/attachments`,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(res.statusCode).toBe(expected);
    }
  });

  it("should require the update level to delete an attachment", async () => {
    for (const [permission, expected] of [
      ["view", 403],
      ["comment", 403],
      ["update", 201],
      ["all", 201],
    ] as const) {
      jest.clearAllMocks();
      (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
      const project = projectWithLevel(permission);
      const task = makeTask(project);
      (TasksDataGet as jest.Mock).mockResolvedValue(task);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      (getTaskAttachment as jest.Mock).mockResolvedValue({
        id: "att-1",
        taskId: task.id,
        fileName: "notes.pdf",
        filePath: "/data/attachments/tasks/att-1.pdf",
      });
      const res = await app.inject({
        method: "DELETE",
        url: `/${task.id}/attachments/att-1`,
      });
      expect(res.statusCode).toBe(expected);
    }
  });

  it("should reject assignee removal below the update level", async () => {
    const project = projectWithLevel("comment");
    const task = makeTask(project);
    (TasksDataGet as jest.Mock).mockResolvedValue(task);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({
      method: "DELETE",
      url: `/${task.id}/assignees/user-2`,
    });
    expect(res.statusCode).toBe(403);
    expect(removeAssignee).not.toHaveBeenCalled();
  });
});
