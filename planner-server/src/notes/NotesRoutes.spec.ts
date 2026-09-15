import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import { NotesRoutes } from "./NotesRoutes";
import {
  NotesDataAdd,
  NotesDataDelete,
  NotesDataGet,
  NotesDataList,
  NotesDataUpdate,
  addNoteComment,
  clearNoteLabels,
  deleteNoteAttachment,
  getNoteAttachment,
} from "./NotesData";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { Note } from "../model/Note";
import { Project } from "../model/Project";

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
  clearNoteLabels: jest.fn(),
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
    expect(clearNoteLabels).not.toHaveBeenCalled();
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
});
