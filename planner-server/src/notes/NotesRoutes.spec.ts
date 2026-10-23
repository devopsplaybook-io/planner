import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { Readable, Writable } from "stream";
import { NotesRoutes } from "./NotesRoutes";
import {
  NotesDataAdd,
  NotesDataDelete,
  NotesDataGet,
  NotesDataList,
  NotesDataUpdate,
  addNoteAttachment,
  addNoteComment,
  addNoteLabel,
  deleteNoteAttachment,
  deleteNoteComment,
  getNoteAttachment,
  getNoteComment,
  replaceNoteLabels,
  updateNoteComment,
} from "./NotesData";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { Note } from "../model/Note";
import { Project, ProjectUserAccess } from "../model/Project";

jest.mock("fs-extra");

jest.mock("./NotesData", () => ({
  NotesDataAdd: jest.fn(),
  NotesDataDelete: jest.fn(),
  NotesDataGet: jest.fn(),
  NotesDataList: jest.fn(async () => []),
  NotesDataUpdate: jest.fn(),
  addNoteComment: jest.fn(),
  deleteNoteComment: jest.fn(),
  getNoteComment: jest.fn(),
  updateNoteComment: jest.fn(),
  replaceNoteLabels: jest.fn(),
  addNoteLabel: jest.fn(),
  addNoteAttachment: jest.fn(),
  deleteNoteAttachment: jest.fn(),
  getNoteAttachment: jest.fn(),
}));

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

describe("NotesRoutes project visibility", () => {
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

  function makeNote(project: Project): Note {
    const note = new Note();
    note.projectId = project.id;
    note.title = "Note";
    return note;
  }

  beforeAll(async () => {
    app = Fastify();
    await new NotesRoutes().getRoutes(app);
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
    expect(NotesDataList).toHaveBeenCalledWith({
      projectId: undefined,
      visibleTo: { userId: "user-1" },
    });
  });

  it("should not scope the list for admins", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    await app.inject({ method: "GET", url: "/" });
    expect(NotesDataList).toHaveBeenCalledWith({
      projectId: undefined,
      visibleTo: undefined,
    });
  });

  it("should forward the projectIds subtree filter to the data layer", async () => {
    await app.inject({ method: "GET", url: "/?projectIds=proj-1,proj-2" });
    expect(NotesDataList).toHaveBeenCalledWith({
      projectId: undefined,
      projectIds: ["proj-1", "proj-2"],
      visibleTo: { userId: "user-1" },
    });
  });

  it("should not set projectIds when the param is absent", async () => {
    await app.inject({ method: "GET", url: "/" });
    expect(NotesDataList).toHaveBeenCalledWith(
      expect.not.objectContaining({ projectIds: expect.anything() }),
    );
  });

  it("should forward the q search term to the data layer", async () => {
    await app.inject({ method: "GET", url: "/?q=%20meeting%20" });
    expect(NotesDataList).toHaveBeenCalledWith(
      expect.objectContaining({ q: "meeting" }),
    );
  });

  it("should not set q when the search param is absent", async () => {
    await app.inject({ method: "GET", url: "/" });
    expect(NotesDataList).toHaveBeenCalledWith(
      expect.not.objectContaining({ q: expect.anything() }),
    );
  });

  // ==================== GET BY ID ====================
  it("should return a note from a public project", async () => {
    const note = makeNote(publicProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({ method: "GET", url: `/${note.id}` });
    expect(res.statusCode).toBe(200);
  });

  it("should return 404 for a note from a restricted project the user cannot see", async () => {
    const note = makeNote(hiddenProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({ method: "GET", url: `/${note.id}` });
    expect(res.statusCode).toBe(404);
  });

  // ==================== CREATE ====================
  it("should reject note creation in a restricted project the user cannot see", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: hiddenProject.id, title: "Sneaky" },
    });
    expect(res.statusCode).toBe(404);
    expect(NotesDataAdd).not.toHaveBeenCalled();
  });

  it("should create a note in a restricted project for a member", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(memberProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: memberProject.id, title: "Mine" },
    });
    expect(res.statusCode).toBe(201);
    expect(NotesDataAdd).toHaveBeenCalledTimes(1);
  });

  it("should trim and de-duplicate the labels given at creation", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        projectId: publicProject.id,
        title: "New",
        labels: [" a ", "a", "b"],
      },
    });
    expect(res.statusCode).toBe(201);
    expect((NotesDataAdd as jest.Mock).mock.calls[0][0].labels).toEqual([
      "a",
      "b",
    ]);
    expect(addNoteLabel).not.toHaveBeenCalled();
  });

  it("should reject invalid labels at creation with 400", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    for (const labels of ["idea", [1], [""], ["x".repeat(101)]]) {
      const res = await app.inject({
        method: "POST",
        url: "/",
        payload: { projectId: publicProject.id, title: "New", labels },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("labels");
    }
    expect(NotesDataAdd).not.toHaveBeenCalled();
  });

  // ==================== UPDATE ====================
  it("should update a note the user can see", async () => {
    const note = makeNote(publicProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { title: "Renamed" },
    });
    expect(res.statusCode).toBe(201);
    expect(note.title).toBe("Renamed");
    expect(NotesDataUpdate).toHaveBeenCalledWith(note);
  });

  it("should reject note update for a user who cannot see the note", async () => {
    const note = makeNote(hiddenProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { title: "Hacked" },
    });
    expect(res.statusCode).toBe(404);
    expect(NotesDataUpdate).not.toHaveBeenCalled();
  });

  // ==================== PROJECT CHANGE ====================
  it("should move a note to a visible target project", async () => {
    const from = makeProject("public", []);
    const to = makeProject("public", []);
    to.name = "Target";
    const note = makeNote(from);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === to.id ? to : from,
    );

    const res = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { projectId: to.id },
    });

    expect(res.statusCode).toBe(201);
    expect(note.projectId).toBe(to.id);
    expect(NotesDataUpdate).toHaveBeenCalledWith(note);
    expect(res.json()).toMatchObject({ projectId: to.id });
  });

  it("should reject moving a note to a project the user cannot see", async () => {
    const from = makeProject("public", []);
    const note = makeNote(from);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === hiddenProject.id ? hiddenProject : from,
    );

    const res = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { projectId: hiddenProject.id },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Project Not Found" });
    expect(NotesDataUpdate).not.toHaveBeenCalled();
    expect(note.projectId).toBe(from.id);
  });

  it("should reject moving a note to a missing project", async () => {
    const from = makeProject("public", []);
    const note = makeNote(from);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) =>
      id === "missing" ? null : from,
    );

    const res = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { projectId: "missing" },
    });

    expect(res.statusCode).toBe(404);
    expect(NotesDataUpdate).not.toHaveBeenCalled();
    expect(note.projectId).toBe(from.id);
  });

  it("should treat a project change to the current project as a no-op", async () => {
    const from = makeProject("public", []);
    const note = makeNote(from);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(from);

    const res = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { projectId: from.id, title: "Renamed" },
    });

    expect(res.statusCode).toBe(201);
    expect(note.projectId).toBe(from.id);
    expect(note.title).toBe("Renamed");
    expect(NotesDataUpdate).toHaveBeenCalledTimes(1);
  });

  // ==================== DELETE ====================
  it("should reject note deletion for a user who cannot see the note", async () => {
    const note = makeNote(hiddenProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({ method: "DELETE", url: `/${note.id}` });
    expect(res.statusCode).toBe(404);
    expect(NotesDataDelete).not.toHaveBeenCalled();
  });

  it("should reject the list for unauthenticated requests with 401", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(401);
    expect(NotesDataList).not.toHaveBeenCalled();
  });

  it("should reject reading a note without a session with 401", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/note-1" });
    expect(res.statusCode).toBe(401);
    expect(NotesDataGet).not.toHaveBeenCalled();
  });

  // ==================== SUB-RESOURCES ====================
  it("should reject comments on a note the user cannot see", async () => {
    const note = makeNote(hiddenProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "POST",
      url: `/${note.id}/comments`,
      payload: { text: "hi" },
    });
    expect(res.statusCode).toBe(404);
    expect(addNoteComment).not.toHaveBeenCalled();
  });

  it("should reject label changes on a note the user cannot see", async () => {
    const note = makeNote(hiddenProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    const res = await app.inject({
      method: "POST",
      url: `/${note.id}/labels`,
      payload: { labels: ["idea"] },
    });
    expect(res.statusCode).toBe(404);
    expect(replaceNoteLabels).not.toHaveBeenCalled();
  });

  it("should replace the note labels atomically with a single call", async () => {
    const note = makeNote(publicProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    const res = await app.inject({
      method: "POST",
      url: `/${note.id}/labels`,
      payload: { labels: ["idea", "draft"] },
    });

    expect(res.statusCode).toBe(201);
    expect(replaceNoteLabels).toHaveBeenCalledTimes(1);
    expect(replaceNoteLabels).toHaveBeenCalledWith(note.id, ["idea", "draft"]);
  });

  it("should accept an empty labels array as clearing all labels", async () => {
    const note = makeNote(publicProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    const res = await app.inject({
      method: "POST",
      url: `/${note.id}/labels`,
      payload: { labels: [] },
    });

    expect(res.statusCode).toBe(201);
    expect(replaceNoteLabels).toHaveBeenCalledWith(note.id, []);
  });

  it("should answer 400 when labels is not an array of strings", async () => {
    const note = makeNote(publicProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    for (const labels of [null, "idea", [1], [{}]]) {
      const res = await app.inject({
        method: "POST",
        url: `/${note.id}/labels`,
        payload: { labels },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(replaceNoteLabels).not.toHaveBeenCalled();
  });

  it("should trim and de-duplicate labels like task labels", async () => {
    const note = makeNote(publicProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    const res = await app.inject({
      method: "POST",
      url: `/${note.id}/labels`,
      payload: { labels: [" idea ", "idea", "draft"] },
    });

    expect(res.statusCode).toBe(201);
    expect(replaceNoteLabels).toHaveBeenCalledWith(note.id, ["idea", "draft"]);
  });

  it("should answer 400 for empty and too-long note labels", async () => {
    const note = makeNote(publicProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);

    for (const labels of [[""], ["  "], ["x".repeat(101)]]) {
      const res = await app.inject({
        method: "POST",
        url: `/${note.id}/labels`,
        payload: { labels },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(replaceNoteLabels).not.toHaveBeenCalled();
  });

  it("should reject attachment deletion on a note the user cannot see", async () => {
    const note = makeNote(hiddenProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(hiddenProject);
    (getNoteAttachment as jest.Mock).mockResolvedValue({
      id: "att-1",
      fileName: "f.pdf",
      filePath: "/data/attachments/notes/att-1.pdf",
      dateCreated: "2026-09-01T00:00:00.000Z",
      noteId: note.id,
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/${note.id}/attachments/att-1`,
    });
    expect(res.statusCode).toBe(404);
    expect(deleteNoteAttachment).not.toHaveBeenCalled();
  });

  it("should serve PDF files inline without a sandbox CSP", async () => {
    const note = makeNote(publicProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    (getNoteAttachment as jest.Mock).mockResolvedValue({
      id: "att-pdf",
      fileName: "spec.pdf",
      filePath: "/data/attachments/notes/att-pdf.pdf",
      dateCreated: "2026-10-18T00:00:00.000Z",
      noteId: note.id,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.createReadStream.mockReturnValue(Readable.from(["pdf-bytes"]));

    const res = await app.inject({
      method: "GET",
      url: `/${note.id}/attachments/att-pdf?inline=true`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("inline");
    // A sandbox CSP blocks the browser's built-in PDF viewer
    expect(res.headers["content-security-policy"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("NotesRoutes archived project guard", () => {
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

  function makeNote(project: Project): Note {
    const note = new Note();
    note.projectId = project.id;
    note.title = "Note";
    return note;
  }

  beforeAll(async () => {
    app = Fastify();
    await new NotesRoutes().getRoutes(app);
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

  it("should reject creating a note in an archived project", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: archivedProject.id, title: "New" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Project is archived");
    expect(NotesDataAdd).not.toHaveBeenCalled();
  });

  it("should reject updating a note in an archived project", async () => {
    const note = makeNote(archivedProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { title: "Changed" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Project is archived");
    expect(NotesDataUpdate).not.toHaveBeenCalled();
  });

  it("should reject moving a note into an archived project", async () => {
    const note = makeNote(activeProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockImplementation(
      async (id: string) => (id === archivedProject.id ? archivedProject : activeProject),
    );
    const res = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { projectId: archivedProject.id },
    });
    expect(res.statusCode).toBe(400);
    expect(NotesDataUpdate).not.toHaveBeenCalled();
  });

  it("should reject adding a comment to a note in an archived project", async () => {
    const note = makeNote(archivedProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "POST",
      url: `/${note.id}/comments`,
      payload: { text: "Hello" },
    });
    expect(res.statusCode).toBe(400);
    expect(addNoteComment).not.toHaveBeenCalled();
  });

  it("should reject updating the labels of a note in an archived project", async () => {
    const note = makeNote(archivedProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({
      method: "POST",
      url: `/${note.id}/labels`,
      payload: { labels: ["important"] },
    });
    expect(res.statusCode).toBe(400);
    expect(replaceNoteLabels).not.toHaveBeenCalled();
  });

  it("should still read a note in an archived project", async () => {
    const note = makeNote(archivedProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({ method: "GET", url: `/${note.id}` });
    expect(res.statusCode).toBe(200);
  });

  it("should reject deleting an attachment of a note in an archived project", async () => {
    const note = makeNote(archivedProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    (getNoteAttachment as jest.Mock).mockResolvedValue({
      id: "att-1",
      fileName: "f.pdf",
      filePath: "/data/attachments/notes/att-1.pdf",
      dateCreated: "2026-09-01T00:00:00.000Z",
      noteId: note.id,
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/${note.id}/attachments/att-1`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Project is archived");
    expect(deleteNoteAttachment).not.toHaveBeenCalled();
  });

  it("should still delete a note in an archived project", async () => {
    const note = makeNote(archivedProject);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(archivedProject);
    const res = await app.inject({ method: "DELETE", url: `/${note.id}` });
    expect(res.statusCode).toBe(201);
    expect(NotesDataDelete).toHaveBeenCalledWith(note.id);
  });
});

describe("NotesRoutes project permission levels", () => {
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
      project.userAccess = [] as never;
    }
    return project;
  }

  function makeNote(project: Project): Note {
    const note = new Note();
    note.projectId = project.id;
    note.title = "Note";
    return note;
  }

  beforeAll(async () => {
    app = Fastify();
    await new NotesRoutes().getRoutes(app);
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

  it("should let a view user read but reject every write with 403", async () => {
    const project = projectWithLevel("view");
    const note = makeNote(project);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    (getNoteAttachment as jest.Mock).mockResolvedValue({
      id: "att-1",
      fileName: "f.pdf",
      filePath: "/data/attachments/notes/att-1.pdf",
      dateCreated: "2026-09-01T00:00:00.000Z",
      noteId: note.id,
    });

    const read = await app.inject({ method: "GET", url: `/${note.id}` });
    expect(read.statusCode).toBe(200);

    const writes: Array<
      [Awaited<ReturnType<typeof app.inject>>, string]
    > = [
      [
        await app.inject({
          method: "POST",
          url: "/",
          payload: { projectId: project.id, title: "New" },
        }),
        "update",
      ],
      [
        await app.inject({
          method: "PUT",
          url: `/${note.id}`,
          payload: { title: "Renamed" },
        }),
        "update",
      ],
      [await app.inject({ method: "DELETE", url: `/${note.id}` }), "all"],
      [
        await app.inject({
          method: "POST",
          url: `/${note.id}/comments`,
          payload: { text: "hi" },
        }),
        "comment",
      ],
      [
        await app.inject({
          method: "POST",
          url: `/${note.id}/labels`,
          payload: { labels: ["x"] },
        }),
        "update",
      ],
      [
        await app.inject({
          method: "POST",
          url: `/${note.id}/attachments`,
          payload: {},
        }),
        "update",
      ],
      [
        await app.inject({
          method: "DELETE",
          url: `/${note.id}/attachments/att-1`,
        }),
        "update",
      ],
    ];
    for (const [res, required] of writes) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe(
        `Access Denied: this action requires the ${required} permission on the project`,
      );
    }
    expect(NotesDataAdd).not.toHaveBeenCalled();
    expect(NotesDataUpdate).not.toHaveBeenCalled();
    expect(NotesDataDelete).not.toHaveBeenCalled();
    expect(addNoteComment).not.toHaveBeenCalled();
    expect(replaceNoteLabels).not.toHaveBeenCalled();
  });

  it("should answer 404 (not 403) for writes on an invisible project", async () => {
    const project = projectWithLevel(null);
    const note = makeNote(project);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { title: "Renamed" },
    });
    expect(res.statusCode).toBe(404);
    expect(NotesDataUpdate).not.toHaveBeenCalled();
  });

  it("should let a comment user comment on their own notes access level", async () => {
    const project = projectWithLevel("comment");
    const note = makeNote(project);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);

    const comment = await app.inject({
      method: "POST",
      url: `/${note.id}/comments`,
      payload: { text: "hi" },
    });
    expect(comment.statusCode).toBe(201);
    expect(addNoteComment).toHaveBeenCalledTimes(1);

    (getNoteComment as jest.Mock).mockResolvedValue({
      id: "comment-1",
      userId: "user-1",
      text: "hi",
    });
    const edit = await app.inject({
      method: "PUT",
      url: `/${note.id}/comments/comment-1`,
      payload: { text: "edited" },
    });
    expect(edit.statusCode).toBe(200);
    expect(getNoteComment).toHaveBeenCalledWith("comment-1", note.id);
    const del = await app.inject({
      method: "DELETE",
      url: `/${note.id}/comments/comment-1`,
    });
    expect(del.statusCode).toBe(201);

    const create = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: project.id, title: "New" },
    });
    expect(create.statusCode).toBe(403);
    expect(NotesDataAdd).not.toHaveBeenCalled();

    const update = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { title: "Renamed" },
    });
    expect(update.statusCode).toBe(403);
    expect(NotesDataUpdate).not.toHaveBeenCalled();
  });

  it("should answer 404 when a note comment is updated through another note", async () => {
    const project = projectWithLevel("comment");
    const noteWithComment = makeNote(project);
    const otherNote = makeNote(project);
    (NotesDataGet as jest.Mock).mockResolvedValue(otherNote);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    (getNoteComment as jest.Mock).mockImplementation(
      async (_commentId: string, noteId: string) =>
        noteId === noteWithComment.id
          ? { id: "comment-a", userId: "user-1", text: "on A" }
          : null,
    );

    const res = await app.inject({
      method: "PUT",
      url: `/${otherNote.id}/comments/comment-a`,
      payload: { text: "hijacked" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Comment Not Found");
    expect(getNoteComment).toHaveBeenCalledWith("comment-a", otherNote.id);
    expect(updateNoteComment).not.toHaveBeenCalled();
  });

  it("should answer 404 when a note comment is deleted through another note", async () => {
    const project = projectWithLevel("comment");
    const noteWithComment = makeNote(project);
    const otherNote = makeNote(project);
    (NotesDataGet as jest.Mock).mockResolvedValue(otherNote);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    (getNoteComment as jest.Mock).mockImplementation(
      async (_commentId: string, noteId: string) =>
        noteId === noteWithComment.id
          ? { id: "comment-a", userId: "user-1", text: "on A" }
          : null,
    );

    const res = await app.inject({
      method: "DELETE",
      url: `/${otherNote.id}/comments/comment-a`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Comment Not Found");
    expect(deleteNoteComment).not.toHaveBeenCalled();
  });

  it("should let an update user edit notes and sub-resources but not delete", async () => {
    const project = projectWithLevel("update");
    const note = makeNote(project);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);

    const create = await app.inject({
      method: "POST",
      url: "/",
      payload: { projectId: project.id, title: "New" },
    });
    expect(create.statusCode).toBe(201);
    expect(NotesDataAdd).toHaveBeenCalledTimes(1);

    const update = await app.inject({
      method: "PUT",
      url: `/${note.id}`,
      payload: { title: "Renamed" },
    });
    expect(update.statusCode).toBe(201);

    const labels = await app.inject({
      method: "POST",
      url: `/${note.id}/labels`,
      payload: { labels: ["x"] },
    });
    expect(labels.statusCode).toBe(201);
    expect(replaceNoteLabels).toHaveBeenCalledTimes(1);

    const del = await app.inject({ method: "DELETE", url: `/${note.id}` });
    expect(del.statusCode).toBe(403);
    expect(NotesDataDelete).not.toHaveBeenCalled();
  });

  it("should require the update level to delete a note attachment", async () => {
    for (const [permission, expected] of [
      ["view", 403],
      ["comment", 403],
      ["update", 201],
      ["all", 201],
    ] as const) {
      jest.clearAllMocks();
      (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
      const project = projectWithLevel(permission);
      const note = makeNote(project);
      (NotesDataGet as jest.Mock).mockResolvedValue(note);
      (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
      (getNoteAttachment as jest.Mock).mockResolvedValue({
        id: "att-1",
        fileName: "f.pdf",
        filePath: "/data/attachments/notes/att-1.pdf",
        dateCreated: "2026-09-01T00:00:00.000Z",
        noteId: note.id,
      });
      const res = await app.inject({
        method: "DELETE",
        url: `/${note.id}/attachments/att-1`,
      });
      expect(res.statusCode).toBe(expected);
    }
  });

  it("should let an all user delete a note", async () => {
    const project = projectWithLevel("all");
    const note = makeNote(project);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({ method: "DELETE", url: `/${note.id}` });
    expect(res.statusCode).toBe(201);
    expect(NotesDataDelete).toHaveBeenCalledWith(note.id);
  });

  it("should let an admin delete a note on a view-level project", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    const project = projectWithLevel("view");
    const note = makeNote(project);
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({ method: "DELETE", url: `/${note.id}` });
    expect(res.statusCode).toBe(201);
  });
});

describe("NotesRoutes attachments", () => {
  let app: FastifyInstance;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  const publicProject = (() => {
    const project = new Project();
    project.name = "P";
    project.visibility = "public";
    project.userAccess = [];
    return project;
  })();

  beforeAll(async () => {
    app = Fastify();
    await app.register(fastifyMultipart, { limits: { fileSize: 1024 } });
    await new NotesRoutes().getRoutes(app);
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

  function upload(note: Note, content: Buffer) {
    const boundary = "----jestnoteboundary";
    const head = Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="file.bin"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n",
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return app.inject({
      method: "POST",
      url: `/${note.id}/attachments`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([head, content, tail]),
    });
  }

  it("should reject an oversized attachment with 413 and remove the partial file", async () => {
    const note = new Note();
    note.projectId = publicProject.id;
    note.title = "Note";
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.ensureDir.mockResolvedValue(undefined);
    mockFs.remove.mockResolvedValue(undefined);
    mockFs.createWriteStream.mockReturnValue(
      new Writable({ write(_chunk, _enc, cb) { cb(); } }),
    );

    const res = await upload(note, Buffer.alloc(2048, "a"));

    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe("File too large");
    expect(addNoteAttachment).not.toHaveBeenCalled();
    expect(mockFs.remove).toHaveBeenCalledWith(
      expect.stringContaining("/attachments/notes/"),
    );
  });

  it("should accept an attachment of exactly the configured limit", async () => {
    const note = new Note();
    note.projectId = publicProject.id;
    note.title = "Note";
    (NotesDataGet as jest.Mock).mockResolvedValue(note);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(publicProject);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const mockFs = require("fs-extra") as any;
    mockFs.ensureDir.mockResolvedValue(undefined);
    mockFs.createWriteStream.mockReturnValue(
      new Writable({ write(_chunk, _enc, cb) { cb(); } }),
    );

    const res = await upload(note, Buffer.alloc(1024, "a"));

    expect(res.statusCode).toBe(201);
    expect(addNoteAttachment).toHaveBeenCalledTimes(1);
  });
});
