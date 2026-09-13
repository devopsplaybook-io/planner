/* eslint-disable @typescript-eslint/no-explicit-any */
import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import {
  normalizeStatusSelection,
  validateProjectStatusSelection,
  ProjectsRoutes,
} from "./ProjectsRoutes";
import {
  ProjectsDataAdd,
  ProjectsDataDelete,
  ProjectsDataGet,
  ProjectsDataList,
  ProjectsDataUpdate,
  clearProjectUsers,
  addProjectUser,
} from "./ProjectsData";
import { AuthGetUserSession, AuthMustBeAdmin } from "../users/Auth";
import { Project } from "../model/Project";

jest.mock("./ProjectsData", () => ({
  ProjectsDataAdd: jest.fn(),
  ProjectsDataDelete: jest.fn(),
  ProjectsDataGet: jest.fn(),
  ProjectsDataList: jest.fn(),
  ProjectsDataUpdate: jest.fn(),
  clearProjectUsers: jest.fn(),
  addProjectUser: jest.fn(),
}));

jest.mock("../statuses/StatusesData", () => ({
  StatusesCatalogGet: jest.fn(async () => [
    { name: "To Do", color: "#3b82f6" },
    { name: "In Progress", color: "#f59e0b" },
    { name: "Done", color: "#22c55e" },
  ]),
}));

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
  AuthMustBeAdmin: jest.fn(),
}));

const CATALOG = [
  { name: "Backlog", color: "#6b7280" },
  { name: "To Do", color: "#3b82f6" },
  { name: "In Progress", color: "#f59e0b" },
  { name: "Review", color: "#a855f7" },
  { name: "Done", color: "#22c55e" },
];

describe("validateProjectStatusSelection", () => {
  it("should return null for a valid selection from the catalog", () => {
    expect(
      validateProjectStatusSelection(["To Do", "In Progress", "Done"], CATALOG),
    ).toBeNull();
    expect(validateProjectStatusSelection(["Backlog", "Done"], CATALOG)).toBeNull();
  });

  it("should reject arrays with fewer than 2 items", () => {
    expect(validateProjectStatusSelection(["Done"], CATALOG)).toBe(
      "At least 2 statuses are required",
    );
    expect(validateProjectStatusSelection([], CATALOG)).toBe(
      "At least 2 statuses are required",
    );
  });

  it("should reject when Done is missing", () => {
    expect(validateProjectStatusSelection(["To Do", "In Progress"], CATALOG)).toBe(
      '"Done" must be included',
    );
  });

  it("should reject duplicate statuses", () => {
    expect(validateProjectStatusSelection(["To Do", "To Do", "Done"], CATALOG)).toBe(
      "Duplicate statuses are not allowed",
    );
  });

  it("should reject empty-string statuses", () => {
    expect(validateProjectStatusSelection(["To Do", "", "Done"], CATALOG)).toBe(
      "All statuses must be non-empty strings",
    );
  });

  it("should reject statuses that are not in the catalog", () => {
    expect(
      validateProjectStatusSelection(["To Do", "Archived", "Done"], CATALOG),
    ).toBe("Unknown statuses: Archived");
    expect(
      validateProjectStatusSelection(["Foo", "Bar", "Done"], CATALOG),
    ).toBe("Unknown statuses: Foo, Bar");
  });

  it("should reject non-array input", () => {
    expect(
      validateProjectStatusSelection(null as unknown as string[], CATALOG),
    ).toBe("At least 2 statuses are required");
  });
});

describe("normalizeStatusSelection", () => {
  it("should order the selection according to the catalog", () => {
    expect(
      normalizeStatusSelection(["Done", "To Do", "In Progress"], CATALOG),
    ).toEqual(["To Do", "In Progress", "Done"]);
    expect(normalizeStatusSelection(["Review", "Done"], CATALOG)).toEqual([
      "Review",
      "Done",
    ]);
  });

  it("should drop statuses that are not in the catalog", () => {
    expect(normalizeStatusSelection(["To Do", "Archived", "Done"], CATALOG)).toEqual([
      "To Do",
      "Done",
    ]);
  });
});

describe("ProjectsRoutes admin enforcement", () => {
  let app: FastifyInstance;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  function denyNonAdmin() {
    (AuthMustBeAdmin as jest.Mock).mockImplementation(
      async (_req: any, res: any) => {
        res.status(403).send({ error: "Access Denied" });
        throw new Error("Access Denied");
      },
    );
  }

  beforeAll(async () => {
    app = Fastify();
    await new ProjectsRoutes().getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== CREATE ====================
  it("should reject project creation for a non-admin user", async () => {
    denyNonAdmin();
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { name: "New Project" },
    });
    expect(res.statusCode).toBe(403);
    expect(ProjectsDataAdd).not.toHaveBeenCalled();
  });

  it("should reject project creation for an unauthenticated request", async () => {
    denyNonAdmin();
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { name: "New Project" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("should create a project for an admin", async () => {
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
    (ProjectsDataAdd as jest.Mock).mockResolvedValue(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { name: "New Project", statuses: ["To Do", "Done"] },
    });
    expect(res.statusCode).toBe(201);
    expect(ProjectsDataAdd).toHaveBeenCalledTimes(1);
    const created = (ProjectsDataAdd as jest.Mock).mock.calls[0][0] as Project;
    expect(created.name).toBe("New Project");
    expect(created.statuses).toEqual(["To Do", "Done"]);
  });

  // ==================== UPDATE ====================
  it("should reject project update for a non-admin user", async () => {
    denyNonAdmin();
    const res = await app.inject({
      method: "PUT",
      url: "/project-1",
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(403);
    expect(ProjectsDataGet).not.toHaveBeenCalled();
    expect(ProjectsDataUpdate).not.toHaveBeenCalled();
  });

  it("should update a project for an admin", async () => {
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
    const project = new Project();
    project.name = "Old Name";
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    (ProjectsDataUpdate as jest.Mock).mockResolvedValue(undefined);
    const res = await app.inject({
      method: "PUT",
      url: `/${project.id}`,
      payload: {
        name: "Renamed",
        visibility: "restricted",
        userAccess: ["user-1"],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(project.name).toBe("Renamed");
    expect(project.visibility).toBe("restricted");
    expect(clearProjectUsers).toHaveBeenCalledWith(project.id);
    expect(addProjectUser).toHaveBeenCalledWith(project.id, "user-1");
    expect(ProjectsDataUpdate).toHaveBeenCalledWith(project);
  });

  it("should return 404 when an admin updates a missing project", async () => {
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({
      method: "PUT",
      url: "/missing",
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(404);
  });

  // ==================== DELETE ====================
  it("should reject project deletion for a non-admin user", async () => {
    denyNonAdmin();
    const res = await app.inject({
      method: "DELETE",
      url: "/project-1",
    });
    expect(res.statusCode).toBe(403);
    expect(ProjectsDataDelete).not.toHaveBeenCalled();
  });

  it("should delete a project for an admin", async () => {
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
    const project = new Project();
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    (ProjectsDataDelete as jest.Mock).mockResolvedValue(undefined);
    const res = await app.inject({
      method: "DELETE",
      url: `/${project.id}`,
    });
    expect(res.statusCode).toBe(201);
    expect(ProjectsDataDelete).toHaveBeenCalledWith(project.id);
  });

  it("should refuse to delete the default project", async () => {
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
    const project = new Project();
    project.isDefault = true;
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({
      method: "DELETE",
      url: `/${project.id}`,
    });
    expect(res.statusCode).toBe(400);
    expect(ProjectsDataDelete).not.toHaveBeenCalled();
  });

  // ==================== READ (all authenticated users) ====================
  it("should list projects for any authenticated user", async () => {
    const project = new Project();
    (ProjectsDataList as jest.Mock).mockResolvedValue([project]);
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([project.toTransportJson()]);
  });

  it("should get a project by id for any authenticated user", async () => {
    const project = new Project();
    (ProjectsDataGet as jest.Mock).mockResolvedValue(project);
    const res = await app.inject({ method: "GET", url: `/${project.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(project.toTransportJson());
  });

  it("should return 404 for a missing project", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/missing" });
    expect(res.statusCode).toBe(404);
  });

  it("should reject reads for unauthenticated requests", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(403);
  });
});
