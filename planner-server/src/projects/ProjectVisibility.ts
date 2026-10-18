import { UserSession } from "../model/UserSession";
import {
  ProjectPermission,
  normalizePermission,
} from "../model/Project";
import { ProjectsDataGet } from "./ProjectsData";
import { DbUtilsGetType } from "../utils/DbUtils";

/**
 * User ids covered by a project's userAccess list, tolerating both the
 * legacy string-array form and the {userId, permission} entries.
 */
function accessUserIds(userAccess: unknown): string[] {
  if (!Array.isArray(userAccess)) {
    return [];
  }
  return userAccess
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : (entry as { userId?: unknown })?.userId,
    )
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

const PERMISSION_RANK: Record<ProjectPermission, number> = {
  view: 0,
  comment: 1,
  update: 2,
  all: 3,
};

/**
 * Single source of truth for project visibility: admins see everything,
 * public projects are visible to every authenticated user, and restricted
 * projects are visible only to users added to the project (project_users).
 */
export function isProjectVisible(
  project: { visibility?: string; userAccess?: unknown },
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
    accessUserIds(project.userAccess).includes(userSession.userId)
  );
}

/**
 * The user's permission level on a project: admins have every right; the
 * levels only restrict memberships of restricted projects (public projects
 * grant every authenticated user full rights). A missing project behaves
 * like a public one — callers answer 404 for missing projects themselves.
 * Non-members get null (no access at all). Legacy string memberships and
 * entries without a permission mean "all".
 */
export function getProjectPermission(
  project: { visibility?: string; userAccess?: unknown } | null | undefined,
  userSession: UserSession,
): ProjectPermission | null {
  if (userSession.role === "admin") {
    return "all";
  }
  if (!project || project.visibility !== "restricted") {
    return "all";
  }
  if (!userSession.userId) {
    return null;
  }
  const entries = Array.isArray(project.userAccess) ? project.userAccess : [];
  const entry = entries.find((e) =>
    typeof e === "string"
      ? e === userSession.userId
      : (e as { userId?: unknown })?.userId === userSession.userId,
  );
  if (!entry) {
    return null;
  }
  return typeof entry === "string"
    ? "all"
    : normalizePermission((entry as { permission?: unknown }).permission);
}

/**
 * Whether the user's level satisfies the required one (levels are
 * cumulative: update satisfies comment and view requirements).
 */
export function hasProjectPermission(
  project: { visibility?: string; userAccess?: unknown } | null | undefined,
  userSession: UserSession,
  required: ProjectPermission,
): boolean {
  const permission = getProjectPermission(project, userSession);
  return (
    permission !== null &&
    PERMISSION_RANK[permission] >= PERMISSION_RANK[required]
  );
}

/** The 403 body error for a write below the user's permission level. */
export function permissionDeniedMessage(required: ProjectPermission): string {
  return `Access Denied: this action requires the ${required} permission on the project`;
}

/**
 * Error for a mutation on a project, shared by the tasks and notes routes:
 * 400 when the project is archived (read-only), then 403 when the user's
 * permission is below the required level; null when the mutation may
 * proceed. One ProjectsDataGet per call — the same pattern the routes
 * already use for the archived check. Missing projects never block here:
 * callers answer 404 for those themselves.
 */
export async function projectMutationError(
  projectId: string,
  userSession: UserSession,
  required: ProjectPermission,
): Promise<{ status: number; error: string } | null> {
  const project = await ProjectsDataGet(projectId);
  if (project?.archived) {
    return { status: 400, error: "Project is archived" };
  }
  if (!hasProjectPermission(project, userSession, required)) {
    return { status: 403, error: permissionDeniedMessage(required) };
  }
  return null;
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
