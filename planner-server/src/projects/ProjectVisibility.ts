import { UserSession } from "../model/UserSession";
import { ProjectsDataGet } from "./ProjectsData";
import { DbUtilsGetType } from "../utils/DbUtils";

/**
 * Single source of truth for project visibility: admins see everything,
 * public projects are visible to every authenticated user, and restricted
 * projects are visible only to users added to the project (project_users).
 */
export function isProjectVisible(
  project: { visibility?: string; userAccess?: string[] },
  userSession: UserSession,
): boolean {
  if (userSession.role === "admin") {
    return true;
  }
  if (project.visibility !== "restricted") {
    return true;
  }
  return (
    !!userSession.userId &&
    (project.userAccess || []).includes(userSession.userId)
  );
}

/**
 * SQL condition (AND-ready) restricting a row's "projectId" column to
 * projects visible to the given user, mirroring the dialects of
 * LIST_VISIBLE_PROJECTS. Uses SQLite "?" placeholders — DbUtilsQuerySQL
 * renumbers them to $n for postgres. Callers must apply the admin bypass
 * themselves: only non-admin viewers get this condition.
 */
export function visibleProjectsCondition(
  userId: string,
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string; params: unknown[] } {
  const quote = (name: string) => (dbType === "postgres" ? `"${name}"` : name);
  return {
    sql:
      `(${quote("projectId")} IN (SELECT ${quote("id")} FROM ${quote("projects")} WHERE ${quote("visibility")} = 'public') ` +
      `OR ${quote("projectId")} IN (SELECT ${quote("projectId")} FROM ${quote("project_users")} WHERE ${quote("userId")} = ?))`,
    params: [userId],
  };
}

/**
 * Whether the user may see an item (task, note) that belongs to a project.
 * Items in restricted projects must yield 404 for non-members so their
 * existence is not revealed.
 */
export async function isProjectItemVisible(
  item: { projectId: string },
  userSession: UserSession,
): Promise<boolean> {
  if (userSession.role === "admin") {
    return true;
  }
  const project = await ProjectsDataGet(item.projectId);
  if (!project) {
    return false;
  }
  return isProjectVisible(project, userSession);
}
