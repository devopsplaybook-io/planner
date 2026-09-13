import {
  isProjectVisible,
  isProjectItemVisible,
  visibleProjectsCondition,
} from "./ProjectVisibility";
import { ProjectsDataGet } from "./ProjectsData";
import { Project } from "../model/Project";
import { UserSession } from "../model/UserSession";

jest.mock("./ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

const adminSession: UserSession = {
  isAuthenticated: true,
  userId: "admin-1",
  userName: "Admin",
  role: "admin",
};

const userSession: UserSession = {
  isAuthenticated: true,
  userId: "user-1",
  userName: "User",
  role: "user",
};

function makeProject(overrides: Partial<Project> = {}): Project {
  const project = new Project();
  Object.assign(project, overrides);
  return project;
}

describe("isProjectVisible", () => {
  it("should let admins see any project", () => {
    const restricted = makeProject({
      visibility: "restricted",
      userAccess: [],
    });
    expect(isProjectVisible(restricted, adminSession)).toBe(true);
  });

  it("should let any user see a public project", () => {
    const project = makeProject({ visibility: "public", userAccess: [] });
    expect(isProjectVisible(project, userSession)).toBe(true);
  });

  it("should let a member see a restricted project", () => {
    const project = makeProject({
      visibility: "restricted",
      userAccess: ["user-1", "user-2"],
    });
    expect(isProjectVisible(project, userSession)).toBe(true);
  });

  it("should reject a non-member on a restricted project", () => {
    const project = makeProject({
      visibility: "restricted",
      userAccess: ["user-2"],
    });
    expect(isProjectVisible(project, userSession)).toBe(false);
  });

  it("should reject a restricted project with empty membership", () => {
    const project = makeProject({
      visibility: "restricted",
      userAccess: [],
    });
    expect(isProjectVisible(project, userSession)).toBe(false);
  });
});

describe("visibleProjectsCondition", () => {
  it("should build a sqlite condition with one parameter", () => {
    const { sql, params } = visibleProjectsCondition("user-1", "sqlite");
    expect(sql).toBe(
      "(projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?))",
    );
    expect(params).toEqual(["user-1"]);
  });

  it("should quote identifiers for postgres while keeping ? placeholders", () => {
    const { sql, params } = visibleProjectsCondition("user-1", "postgres");
    expect(sql).toBe(
      '("projectId" IN (SELECT "id" FROM "projects" WHERE "visibility" = \'public\') ' +
        'OR "projectId" IN (SELECT "projectId" FROM "project_users" WHERE "userId" = ?))',
    );
    expect(params).toEqual(["user-1"]);
  });
});

describe("isProjectItemVisible", () => {
  it("should let admins see an item without loading the project", async () => {
    const visible = await isProjectItemVisible(
      { projectId: "proj-1" },
      adminSession,
    );
    expect(visible).toBe(true);
    expect(ProjectsDataGet).not.toHaveBeenCalled();
  });

  it("should return false for an item whose project no longer exists", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue(null);
    const visible = await isProjectItemVisible(
      { projectId: "gone" },
      userSession,
    );
    expect(visible).toBe(false);
  });

  it("should delegate to the project visibility rule", async () => {
    const restricted = makeProject({
      visibility: "restricted",
      userAccess: ["user-2"],
    });
    (ProjectsDataGet as jest.Mock).mockResolvedValue(restricted);
    const visible = await isProjectItemVisible(
      { projectId: "proj-1" },
      userSession,
    );
    expect(visible).toBe(false);
    expect(ProjectsDataGet).toHaveBeenCalledWith("proj-1");
  });
});
