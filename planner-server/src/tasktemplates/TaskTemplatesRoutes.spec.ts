import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import { Readable } from "stream";
import { TaskTemplatesRoutes } from "./TaskTemplatesRoutes";
import {
  TaskTemplatesAdd,
  TaskTemplatesDelete,
  TaskTemplatesGet,
  TaskTemplatesList,
  TaskTemplatesUpdate,
  addTemplateComment,
  deleteTemplateAttachment,
  deleteTemplateComment,
  getTemplateAttachment,
  getTemplateComment,
  replaceTemplateAssignees,
  replaceTemplateLabels,
  updateTemplateComment,
} from "./TaskTemplatesData";
import { TaskTemplatesSchedulerRefresh } from "./TaskTemplatesScheduler";
import { createInstanceFromTemplate } from "./TaskTemplatesInstance";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import { UsersDataGet } from "../users/UsersData";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { Task } from "../model/Task";
import { TaskTemplate } from "../model/TaskTemplate";
import { Project, ProjectUserAccess } from "../model/Project";

jest.mock("fs-extra");

jest.mock("./TaskTemplatesData", () => ({
  TaskTemplatesAdd: jest.fn(),
  TaskTemplatesDelete: jest.fn(),
  TaskTemplatesGet: jest.fn(),
  TaskTemplatesList: jest.fn(async () => []),
  TaskTemplatesUpdate: jest.fn(),
  addTemplateComment: jest.fn(),
  deleteTemplateComment: jest.fn(),
  getTemplateComment: jest.fn(),
  updateTemplateComment: jest.fn(),
  replaceTemplateAssignees: jest.fn(),
  replaceTemplateLabels: jest.fn(),
  addTemplateAttachment: jest.fn(),
  deleteTemplateAttachment: jest.fn(),
  getTemplateAttachment: jest.fn(),
  TaskTemplateRunsAdd: jest.fn(),
  TaskTemplateRunsGetLast: jest.fn(),
  TaskTemplatesListIdsByProject: jest.fn(async () => []),
}));

jest.mock("./TaskTemplatesScheduler", () => ({
  TaskTemplatesSchedulerRefresh: jest.fn(),
}));

jest.mock("./TaskTemplatesInstance", () => ({
  createInstanceFromTemplate: jest.fn(),
  buildTaskFromTemplate: jest.fn(),
  buildTemplateAttachmentCopyPath: jest.fn(),
}));

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
}));

jest.mock("../users/UsersData", () => ({
  UsersDataGet: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

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
  project.statuses = ["To Do", "Done"];
  return project;
}

const publicProject = makeProject("public", []);
const archivedProject = makeProject("public", []);
archivedProject.archived = true;
const commentProject = makeProject("restricted", [
  { userId: "user-1", permission: "comment" },
]);
const viewProject = makeProject("restricted", [
  { userId: "user-1", permission: "view" },
]);
const allProject = makeProject("restricted", [
  { userId: "user-1", permission: "all" },
]);
const hiddenProject = makeProject("restricted", [
  { userId: "user-2", permission: "all" },
]);

function makeTemplate(project: Project): TaskTemplate {
  const template = new TaskTemplate();
  template.projectId = project.id;
  template.title = "Weekly report";
  return template;
}

beforeEach(() => {
  jest.clearAllMocks();
  (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
  (AuthMustBeAuthenticated as jest.Mock).mockResolvedValue(undefined);
  (UsersDataGet as jest.Mock).mockResolvedValue({ id: "user-1", name: "User" });
});

afterEach(() => {
  (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
});

describe("TaskTemplatesRoutes list and read", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await new TaskTemplatesRoutes().getRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 401 for unauthenticated list requests", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(401);
    expect(TaskTemplatesList).not.toHaveBeenCalled();
  });

  it("should scope the list to visible projects for non-admins", async () => {
    await app.inject({ method: "GET", url: "/" });
    expect(TaskTemplatesList).toHaveBeenCalledWith({
      projectId: undefined,
      projectIds: undefined,
      q: undefined,
      visibleTo: { userId: "user-1" },
    });
  });

  it("should not scope the list for admins", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    await app.inject({ method: "GET", url: "/" });
    expect(TaskTemplatesList).toHaveBeenCalledWith({
      projectId: undefined,
      projectIds: undefined,
      q: undefined,
    });
  });

  it("should forward the project subtree and search filters", async () => {
    await app.inject({
      method: "GET",
      url: "/?projectId=p1&projectIds=p1,p2&q=report",
    });
    expect(TaskTemplatesList).toHaveBeenCalledWith({
      projectId: "p1",
      projectIds: ["p1", "p2"],
      q: "report",
      visibleTo: { userId: "user-1" },
    });
  });

  it("should return a template by id", async () => {
    const template = makeTemplate(publicProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({ method: "GET", url: `/${template.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Weekly report");
    expect(res.json().automation).toEqual({
      scheduleCron: null,
      skipIfPreviousNotDone: false,
      addDateToTitle: false,
      instanceStatus: null,
    });
  });

  it("should answer 404 for a missing template", async () => {
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("should answer 404 (not 403) for a template in a hidden project", async () => {
    const template = makeTemplate(hiddenProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({ method: "GET", url: `/${template.id}` });
    expect(res.statusCode).toBe(404);
  });
});

describe("TaskTemplatesRoutes create and update", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await new TaskTemplatesRoutes().getRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should create a template with its automation section", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        projectId: publicProject.id,
        title: "Weekly report",
        automation: {
          scheduleCron: "0 9 * * 1",
          skipIfPreviousNotDone: true,
          addDateToTitle: true,
        },
        assignees: ["user-2"],
        labels: ["ops"],
      },
    });
    expect(res.statusCode).toBe(201);
    const created = (TaskTemplatesAdd as jest.Mock).mock.calls[0][0];
    expect(created.title).toBe("Weekly report");
    expect(created.scheduleCron).toBe("0 9 * * 1");
    expect(created.skipIfPreviousNotDone).toBe(true);
    expect(created.addDateToTitle).toBe(true);
    expect(created.assignees).toEqual([{ userId: "user-2" }]);
    expect(created.labels).toEqual(["ops"]);
    expect(TaskTemplatesSchedulerRefresh).toHaveBeenCalledWith(created.id);
  });

  it("should answer 400 for an invalid cron expression", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        projectId: publicProject.id,
        title: "T",
        automation: { scheduleCron: "not a cron" },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("cron");
    expect(TaskTemplatesAdd).not.toHaveBeenCalled();
  });

  it("should create a template with a valid instanceStatus", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        projectId: publicProject.id,
        title: "Weekly report",
        automation: { instanceStatus: "Done" },
      },
    });
    expect(res.statusCode).toBe(201);
    const created = (TaskTemplatesAdd as jest.Mock).mock.calls[0][0];
    expect(created.instanceStatus).toBe("Done");
    expect(res.json().automation.instanceStatus).toBe("Done");
  });

  it("should answer 400 for an instanceStatus that is not a project status", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        projectId: publicProject.id,
        title: "T",
        automation: { instanceStatus: "Nonexistent" },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("instanceStatus");
    expect(TaskTemplatesAdd).not.toHaveBeenCalled();
  });

  it("should clear the instanceStatus on create when null", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        projectId: publicProject.id,
        title: "T",
        automation: { instanceStatus: null },
      },
    });
    expect(res.statusCode).toBe(201);
    const created = (TaskTemplatesAdd as jest.Mock).mock.calls[0][0];
    expect(created.instanceStatus).toBeUndefined();
  });

  it("should answer 400 when the title is missing", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: publicProject.id },
    });
    expect(res.statusCode).toBe(400);
  });

  it("should answer 404 when creating in an invisible project", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: hiddenProject.id, title: "T" },
    });
    expect(res.statusCode).toBe(404);
    expect(TaskTemplatesAdd).not.toHaveBeenCalled();
  });

  it("should answer 400 when creating in an archived project", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: archivedProject.id, title: "T" },
    });
    expect(res.statusCode).toBe(400);
    expect(TaskTemplatesAdd).not.toHaveBeenCalled();
  });

  it("should answer 403 for a view-level user", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(viewProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: viewProject.id, title: "T" },
    });
    expect(res.statusCode).toBe(403);
    expect(TaskTemplatesAdd).not.toHaveBeenCalled();
  });

  it("should update the fields and replace assignees and labels", async () => {
    const template = makeTemplate(allProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(allProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${template.id}`,
      payload: {
        title: "Renamed",
        automation: { scheduleCron: null, addDateToTitle: true },
        assignees: ["user-3"],
        labels: ["a", "b"],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(TaskTemplatesUpdate).toHaveBeenCalled();
    expect(template.scheduleCron).toBeUndefined();
    expect(template.addDateToTitle).toBe(true);
    expect(replaceTemplateAssignees).toHaveBeenCalledWith(template.id, [
      "user-3",
    ]);
    expect(replaceTemplateLabels).toHaveBeenCalledWith(template.id, ["a", "b"]);
    expect(TaskTemplatesSchedulerRefresh).toHaveBeenCalledWith(template.id);
  });

  it("should answer 400 for an invalid cron on update", async () => {
    const template = makeTemplate(allProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(allProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${template.id}`,
      payload: { automation: { scheduleCron: "99" } },
    });
    expect(res.statusCode).toBe(400);
    expect(TaskTemplatesUpdate).not.toHaveBeenCalled();
  });

  it("should update the instanceStatus to a valid project status", async () => {
    const template = makeTemplate(allProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(allProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${template.id}`,
      payload: { automation: { instanceStatus: "Done" } },
    });
    expect(res.statusCode).toBe(201);
    expect(template.instanceStatus).toBe("Done");
  });

  it("should clear the instanceStatus on update when null", async () => {
    const template = makeTemplate(allProject);
    template.instanceStatus = "Done";
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(allProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${template.id}`,
      payload: { automation: { instanceStatus: null } },
    });
    expect(res.statusCode).toBe(201);
    expect(template.instanceStatus).toBeUndefined();
  });

  it("should answer 400 for an instanceStatus that is not a status of the project", async () => {
    const template = makeTemplate(allProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(allProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${template.id}`,
      payload: { automation: { instanceStatus: "Nonexistent" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("instanceStatus");
    expect(TaskTemplatesUpdate).not.toHaveBeenCalled();
  });

  it("should validate the instanceStatus against the new project when the project changes", async () => {
    const template = makeTemplate(allProject);
    const otherProject = makeProject("public", []);
    otherProject.statuses = ["Doing", "Review", "Done"];
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === otherProject.id ? otherProject : allProject,
    );
    const res = await app.inject({
      method: "PUT",
      url: `/${template.id}`,
      payload: {
        projectId: otherProject.id,
        automation: { instanceStatus: "Doing" },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(template.projectId).toBe(otherProject.id);
    expect(template.instanceStatus).toBe("Doing");
  });

  it("should answer 400 for an instanceStatus that is not a status of the new project", async () => {
    const template = makeTemplate(allProject);
    const otherProject = makeProject("public", []);
    otherProject.statuses = ["Doing", "Review", "Done"];
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === otherProject.id ? otherProject : allProject,
    );
    const res = await app.inject({
      method: "PUT",
      url: `/${template.id}`,
      payload: {
        projectId: otherProject.id,
        automation: { instanceStatus: "To Do" },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("instanceStatus");
    expect(TaskTemplatesUpdate).not.toHaveBeenCalled();
  });
});

describe("TaskTemplatesRoutes delete and create-instance", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await new TaskTemplatesRoutes().getRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 403 when deleting with the update level (all required)", async () => {
    const template = makeTemplate(commentProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(commentProject);
    const res = await app.inject({ method: "DELETE", url: `/${template.id}` });
    expect(res.statusCode).toBe(403);
    expect(TaskTemplatesDelete).not.toHaveBeenCalled();
  });

  it("should delete a template and refresh the scheduler", async () => {
    const template = makeTemplate(allProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(allProject);
    const res = await app.inject({ method: "DELETE", url: `/${template.id}` });
    expect(res.statusCode).toBe(201);
    expect(TaskTemplatesDelete).toHaveBeenCalledWith(template.id);
    expect(TaskTemplatesSchedulerRefresh).toHaveBeenCalledWith(template.id);
  });

  it("should create a task instance from the template", async () => {
    const template = makeTemplate(allProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(allProject);
    const task = new Task();
    task.title = "Weekly report";
    (createInstanceFromTemplate as jest.Mock).mockResolvedValue(task);
    const res = await app.inject({
      method: "POST",
      url: `/${template.id}/create-instance`,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe("Weekly report");
    expect(createInstanceFromTemplate).toHaveBeenCalledWith(
      template,
      allProject,
    );
  });

  it("should answer 400 when the project is archived", async () => {
    const template = makeTemplate(archivedProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "POST",
      url: `/${template.id}/create-instance`,
    });
    expect(res.statusCode).toBe(400);
    expect(createInstanceFromTemplate).not.toHaveBeenCalled();
  });

  it("should answer 403 for a view-level user", async () => {
    const template = makeTemplate(viewProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(viewProject);
    const res = await app.inject({
      method: "POST",
      url: `/${template.id}/create-instance`,
    });
    expect(res.statusCode).toBe(403);
    expect(createInstanceFromTemplate).not.toHaveBeenCalled();
  });
});

describe("TaskTemplatesRoutes comments", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await new TaskTemplatesRoutes().getRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should add a comment for a comment-level user", async () => {
    const template = makeTemplate(commentProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(commentProject);
    const res = await app.inject({
      method: "POST",
      url: `/${template.id}/comments`,
      payload: { text: "hello" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().text).toBe("hello");
    expect(res.json().userName).toBe("User");
    expect(addTemplateComment).toHaveBeenCalledTimes(1);
  });

  it("should answer 403 for a view-level user", async () => {
    const template = makeTemplate(viewProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(viewProject);
    const res = await app.inject({
      method: "POST",
      url: `/${template.id}/comments`,
      payload: { text: "hello" },
    });
    expect(res.statusCode).toBe(403);
    expect(addTemplateComment).not.toHaveBeenCalled();
  });

  it("should answer 400 when the text is missing", async () => {
    const template = makeTemplate(commentProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(commentProject);
    const res = await app.inject({
      method: "POST",
      url: `/${template.id}/comments`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("should reject editing someone else's comment (non-admin)", async () => {
    const template = makeTemplate(allProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(allProject);
    (getTemplateComment as jest.Mock).mockResolvedValue({
      id: "c1",
      userId: "user-2",
      text: "theirs",
      dateCreated: "2026-10-01T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "PUT",
      url: `/${template.id}/comments/c1`,
      payload: { text: "mine now" },
    });
    expect(res.statusCode).toBe(403);
    expect(updateTemplateComment).not.toHaveBeenCalled();
  });

  it("should let an admin edit someone else's comment", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    const template = makeTemplate(allProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(allProject);
    (getTemplateComment as jest.Mock)
      .mockResolvedValueOnce({
        id: "c1",
        userId: "user-2",
        text: "theirs",
        dateCreated: "2026-10-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "c1",
        userId: "user-2",
        text: "edited",
        dateCreated: "2026-10-01T00:00:00.000Z",
      });
    const res = await app.inject({
      method: "PUT",
      url: `/${template.id}/comments/c1`,
      payload: { text: "edited" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toBe("edited");
  });

  it("should reject deleting someone else's comment (non-admin)", async () => {
    const template = makeTemplate(allProject);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(allProject);
    (getTemplateComment as jest.Mock).mockResolvedValue({
      id: "c1",
      userId: "user-2",
      text: "theirs",
      dateCreated: "2026-10-01T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/${template.id}/comments/c1`,
    });
    expect(res.statusCode).toBe(403);
    expect(deleteTemplateComment).not.toHaveBeenCalled();
  });
});

describe("TaskTemplatesRoutes attachments", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await new TaskTemplatesRoutes().getRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 404 for a missing attachment", async () => {
    const template = makeTemplate(publicProject);
    (getTemplateAttachment as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({
      method: "GET",
      url: `/${template.id}/attachments/att-1`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("should answer 404 when the attachment belongs to another template", async () => {
    const template = makeTemplate(publicProject);
    (getTemplateAttachment as jest.Mock).mockResolvedValue({
      id: "att-1",
      templateId: "other-template",
      fileName: "f.pdf",
      filePath: "/data/attachments/task-templates/att-1.pdf",
      dateCreated: "2026-10-01T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "GET",
      url: `/${template.id}/attachments/att-1`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("should answer 403 when deleting an attachment below the update level", async () => {
    const template = makeTemplate(commentProject);
    (getTemplateAttachment as jest.Mock).mockResolvedValue({
      id: "att-1",
      templateId: template.id,
      fileName: "f.pdf",
      filePath: "/data/attachments/task-templates/att-1.pdf",
      dateCreated: "2026-10-01T00:00:00.000Z",
    });
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(commentProject);
    const res = await app.inject({
      method: "DELETE",
      url: `/${template.id}/attachments/att-1`,
    });
    expect(res.statusCode).toBe(403);
    expect(deleteTemplateAttachment).not.toHaveBeenCalled();
  });

  it("should serve PDF files inline without a sandbox CSP", async () => {
    const template = makeTemplate(publicProject);
    (getTemplateAttachment as jest.Mock).mockResolvedValue({
      id: "att-pdf",
      templateId: template.id,
      fileName: "spec.pdf",
      filePath: "/data/attachments/task-templates/att-pdf.pdf",
      dateCreated: "2026-10-18T00:00:00.000Z",
    });
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.createReadStream.mockReturnValue(Readable.from(["pdf-bytes"]));

    const res = await app.inject({
      method: "GET",
      url: `/${template.id}/attachments/att-pdf?inline=true`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("inline");
    // A sandbox CSP blocks the browser's built-in PDF viewer
    expect(res.headers["content-security-policy"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
