import { v4 as uuidv4 } from "uuid";

export const DEFAULT_STATUSES = ["To Do", "In Progress", "Done"];

/**
 * One permission level per granted user on a restricted project, ranked
 * cumulatively: view < comment < update < all.
 */
export type ProjectPermission = "all" | "update" | "comment" | "view";

export const PROJECT_PERMISSIONS: ProjectPermission[] = [
  "all",
  "update",
  "comment",
  "view",
];

export interface ProjectUserAccess {
  userId: string;
  permission: ProjectPermission;
}

/**
 * Tolerant permission parsing: one of the four levels, "all" for anything
 * else (legacy rows, missing values, junk from old clients).
 */
export function normalizePermission(value: unknown): ProjectPermission {
  return PROJECT_PERMISSIONS.includes(value as ProjectPermission)
    ? (value as ProjectPermission)
    : "all";
}

/**
 * Tolerant userAccess parsing: accepts the legacy string-array form (each
 * id becomes an "all" entry) and {userId, permission} objects; entries
 * without a string userId are dropped, non-arrays yield an empty list.
 */
export function normalizeUserAccess(value: unknown): ProjectUserAccess[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const access: ProjectUserAccess[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      if (entry) {
        access.push({ userId: entry, permission: "all" });
      }
      continue;
    }
    const userId = (entry as { userId?: unknown })?.userId;
    if (typeof userId === "string" && userId) {
      access.push({
        userId,
        permission: normalizePermission((entry as { permission?: unknown })
          .permission),
      });
    }
  }
  return access;
}

export class Project {
  public static fromJson(json: Record<string, unknown>): Project {
    if (!json) {
      return null;
    }
    const project = new Project();
    if (json.id) {
      project.id = json.id as string;
    }
    project.name = json.name as string;
    project.description = (json.description as string) || "";
    project.isDefault = json.isDefault === true || json.isDefault === 1;
    project.archived = json.archived === true || json.archived === 1;
    project.visibility = (json.visibility as string) || "public";
    if (json.userAccess) {
      project.userAccess = normalizeUserAccess(json.userAccess);
    }
    if (json.statuses) {
      try {
        project.statuses =
          typeof json.statuses === "string"
            ? JSON.parse(json.statuses as string)
            : (json.statuses as string[]);
      } catch {
        project.statuses = [...DEFAULT_STATUSES];
      }
    }
    return project;
  }

  public id: string;
  public name: string;
  public description: string;
  public isDefault: boolean;
  public archived: boolean;
  public visibility: string;
  public userAccess: ProjectUserAccess[];
  public statuses: string[];
  public dateCreated: string;

  constructor() {
    this.id = uuidv4();
    this.description = "";
    this.isDefault = false;
    this.archived = false;
    this.visibility = "public";
    this.userAccess = [];
    this.statuses = [...DEFAULT_STATUSES];
    this.dateCreated = new Date().toISOString();
  }

  public toJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      isDefault: this.isDefault,
      archived: this.archived ? 1 : 0,
      visibility: this.visibility,
      statuses: JSON.stringify(this.statuses),
      dateCreated: this.dateCreated,
    };
  }

  public toTransportJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      isDefault: this.isDefault,
      archived: this.archived,
      visibility: this.visibility,
      userAccess: this.userAccess,
      statuses: this.statuses,
    };
  }
}
