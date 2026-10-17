import {
  getProjectPermission,
  hasProjectPermission,
  isProjectVisible,
  isProjectItemVisible,
  permissionDeniedMessage,
  visibleProjectsCondition,
} from "./ProjectVisibility";
import { Project, ProjectPermission } from "../model/Project";
import { ProjectsDataGet } from "./ProjectsData";
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

function makeProject(
  overrides: Omit<Partial<Project>, "userAccess"> & {
    userAccess?: unknown;
  } = {},
): Project {
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

  it("should count {userId, permission} entries as membership", () => {
    const project = makeProject({
      visibility: "restricted",
      userAccess: [{ userId: "user-1", permission: "view" }],
    });
    expect(isProjectVisible(project, userSession)).toBe(true);
  });
});

describe("getProjectPermission", () => {
  it("should grant admins all on any project", () => {
    const restricted = makeProject({
      visibility: "restricted",
      userAccess: [],
    });
    expect(getProjectPermission(restricted, adminSession)).toBe("all");
  });

  it("should grant every authenticated user all on a public project", () => {
    const project = makeProject({ visibility: "public", userAccess: [] });
    expect(getProjectPermission(project, userSession)).toBe("all");
  });

  it("should return the stored level for a restricted member", () => {
    const levels: ProjectPermission[] = ["view", "comment", "update", "all"];
    for (const permission of levels) {
      const project = makeProject({
        visibility: "restricted",
        userAccess: [{ userId: "user-1", permission }],
      });
      expect(getProjectPermission(project, userSession)).toBe(permission);
    }
  });

  it("should treat a legacy string membership as all", () => {
    const project = makeProject({
      visibility: "restricted",
      userAccess: ["user-1"],
    });
    expect(getProjectPermission(project, userSession)).toBe("all");
  });

  it("should fall back to all for an entry without a permission", () => {
    const project = makeProject({
      visibility: "restricted",
      userAccess: [{ userId: "user-1" }],
    });
    expect(getProjectPermission(project, userSession)).toBe("all");
  });

  it("should fall back to all for an unknown permission value", () => {
    const project = makeProject({
      visibility: "restricted",
      userAccess: [{ userId: "user-1", permission: "bogus" }],
    });
    expect(getProjectPermission(project, userSession)).toBe("all");
  });

  it("should return null for a non-member of a restricted project", () => {
    const project = makeProject({
      visibility: "restricted",
      userAccess: [{ userId: "user-2", permission: "view" }],
    });
    expect(getProjectPermission(project, userSession)).toBeNull();
  });
});

describe("hasProjectPermission", () => {
  function projectWithLevel(permission: ProjectPermission) {
    return makeProject({
      visibility: "restricted",
      userAccess: [{ userId: "user-1", permission }],
    });
  }

  it("should satisfy lower-level requirements cumulatively", () => {
    const project = projectWithLevel("update");
    expect(hasProjectPermission(project, userSession, "view")).toBe(true);
    expect(hasProjectPermission(project, userSession, "comment")).toBe(true);
    expect(hasProjectPermission(project, userSession, "update")).toBe(true);
    expect(hasProjectPermission(project, userSession, "all")).toBe(false);
  });

  it("should require all for lifecycle actions", () => {
    expect(
      hasProjectPermission(projectWithLevel("all"), userSession, "all"),
    ).toBe(true);
    expect(
      hasProjectPermission(projectWithLevel("update"), userSession, "all"),
    ).toBe(false);
  });

  it("should reject a non-member for every level", () => {
    const project = projectWithLevel("all");
    const other = { ...userSession, userId: "user-2" };
    for (const required of [
      "view",
      "comment",
      "update",
      "all",
    ] as ProjectPermission[]) {
      expect(hasProjectPermission(project, other, required)).toBe(false);
    }
  });
});

describe("permissionDeniedMessage", () => {
  it("should name the required level", () => {
    expect(permissionDeniedMessage("update")).toBe(
      "Access Denied: this action requires the update permission on the project",
    );
    expect(permissionDeniedMessage("all")).toBe(
      "Access Denied: this action requires the all permission on the project",
    );
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
