import { FastifyInstance, RequestGenericInterface } from "fastify";
import {
  PROJECT_PERMISSIONS,
  Project,
  ProjectUserAccess,
  normalizeUserAccess,
} from "../model/Project";
import { AuthGetUserSession, AuthMustBeAdmin } from "../users/Auth";
import {
  StatusCatalogEntry,
  StatusesCatalogGet,
} from "../statuses/StatusesData";
import { isProjectVisibility, isProjectVisible } from "./ProjectVisibility";
import {
  ProjectsDataAdd,
  ProjectsDataDelete,
  ProjectsDataGet,
  ProjectsDataList,
  ProjectsDataUpdate,
  ProjectsDataCountOpenTasks,
  clearProjectUsers,
  addProjectUser,
} from "./ProjectsData";
import { TaskTemplatesListIdsByProject } from "../tasktemplates/TaskTemplatesData";
import { TaskTemplatesSchedulerRefresh } from "../tasktemplates/TaskTemplatesScheduler";

export function validateProjectStatusSelection(
  statuses: string[],
  catalog: StatusCatalogEntry[],
): string | null {
  if (!Array.isArray(statuses) || statuses.length < 2) {
    return "At least 2 statuses are required";
  }
  if (statuses.some((s) => typeof s !== "string" || !s.trim())) {
    return "All statuses must be non-empty strings";
  }
  if (new Set(statuses).size !== statuses.length) {
    return "Duplicate statuses are not allowed";
  }
  if (!statuses.includes("Done")) {
    return '"Done" must be included';
  }
  const catalogNames = catalog.map((s) => s.name);
  const unknown = statuses.filter((s) => !catalogNames.includes(s));
  if (unknown.length > 0) {
    return `Unknown statuses: ${unknown.join(", ")}`;
  }
  return null;
}

export function normalizeStatusSelection(
  statuses: string[],
  catalog: StatusCatalogEntry[],
): string[] {
  return catalog
    .filter((s) => statuses.includes(s.name))
    .map((s) => s.name);
}

/**
 * Validates the userAccess list as written by an admin: the legacy
 * string-array form and object entries without a permission are fine
 * (normalized to "all" afterwards), but an object entry carrying a
 * permission outside the four levels is rejected so a typo cannot silently
 * grant elevated rights. Returns the error message, null when valid.
 */
export function validateUserAccessWrite(raw: unknown): string | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const permission = (entry as { permission?: unknown }).permission;
    if (
      permission !== undefined &&
      !PROJECT_PERMISSIONS.includes(permission as never)
    ) {
      return `Invalid: userAccess (unknown permission '${String(permission)}')`;
    }
  }
  return null;
}

export class ProjectsRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== LIST ====================
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      // Admins bypass visibility and manage every project; other users only
      // see public projects and restricted projects they are a member of.
      const projects = await ProjectsDataList(
        userSession.role === "admin" ? undefined : userSession.userId,
      );
      return res.status(200).send(projects.map((p) => p.toTransportJson()));
    });

    // ==================== GET BY ID ====================
    fastify.get<{ Params: { id: string } }>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const project = await ProjectsDataGet(req.params.id);
      if (!project || !isProjectVisible(project, userSession)) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      return res.status(200).send(project.toTransportJson());
    });

    // ==================== CREATE ====================
    interface PostProject extends RequestGenericInterface {
      Body: {
        name: string;
        description?: string;
        statuses?: string[];
        visibility?: string;
        userAccess?: Array<string | { userId: string; permission?: string }>;
      };
    }
    fastify.post<PostProject>("/", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (
        req.body.visibility !== undefined &&
        !isProjectVisibility(req.body.visibility)
      ) {
        return res.status(400).send({ error: "Invalid visibility" });
      }
      const userAccessError = validateUserAccessWrite(req.body.userAccess);
      if (userAccessError) {
        return res.status(400).send({ error: userAccessError });
      }
      const project = new Project();
      project.name = req.body.name;
      project.description = req.body.description || "";
      if (req.body.visibility) {
        project.visibility = req.body.visibility;
      }
      if (req.body.userAccess) {
        project.userAccess = normalizeUserAccess(req.body.userAccess);
      }
      if (req.body.statuses) {
        const catalog = await StatusesCatalogGet();
        const statusError = validateProjectStatusSelection(
          req.body.statuses,
          catalog,
        );
        if (statusError) {
          return res.status(400).send({ error: statusError });
        }
        project.statuses = normalizeStatusSelection(req.body.statuses, catalog);
      }
      await ProjectsDataAdd(project);
      return res.status(201).send(project.toTransportJson());
    });

    // ==================== UPDATE ====================
    interface PutProject extends RequestGenericInterface {
      Params: { id: string };
      Body: {
        name?: string;
        description?: string;
        statuses?: string[];
        visibility?: string;
        userAccess?: Array<string | { userId: string; permission?: string }>;
        archived?: boolean;
      };
    }
    fastify.put<PutProject>("/:id", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const project = await ProjectsDataGet(req.params.id);
      if (!project) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      // Archived projects are frozen: only the archived flag itself may
      // change (un-archiving). Every other edit is rejected.
      const hasMetadataChanges =
        req.body.name !== undefined ||
        req.body.description !== undefined ||
        req.body.statuses !== undefined ||
        req.body.visibility !== undefined ||
        req.body.userAccess !== undefined;
      if (project.archived && hasMetadataChanges) {
        return res
          .status(400)
          .send({ error: "Archived projects cannot be updated" });
      }
      if (
        req.body.visibility !== undefined &&
        !isProjectVisibility(req.body.visibility)
      ) {
        return res.status(400).send({ error: "Invalid visibility" });
      }
      if (req.body.archived === true && !project.archived) {
        const openTasks = await ProjectsDataCountOpenTasks(project.id);
        if (openTasks > 0) {
          return res.status(400).send({
            error: `Cannot archive: ${openTasks} task(s) are not Done`,
          });
        }
        project.archived = true;
      } else if (req.body.archived === false) {
        project.archived = false;
      }
      if (req.body.name) {
        project.name = req.body.name;
      }
      if (req.body.description !== undefined) {
        project.description = req.body.description;
      }
      if (req.body.statuses) {
        const catalog = await StatusesCatalogGet();
        const statusError = validateProjectStatusSelection(
          req.body.statuses,
          catalog,
        );
        if (statusError) {
          return res.status(400).send({ error: statusError });
        }
        project.statuses = normalizeStatusSelection(req.body.statuses, catalog);
      }
      if (req.body.visibility) {
        project.visibility = req.body.visibility;
      }
      if (req.body.userAccess) {
        const userAccessError = validateUserAccessWrite(req.body.userAccess);
        if (userAccessError) {
          return res.status(400).send({ error: userAccessError });
        }
        const access: ProjectUserAccess[] = normalizeUserAccess(
          req.body.userAccess,
        );
        await clearProjectUsers(project.id);
        for (const entry of access) {
          await addProjectUser(project.id, entry.userId, entry.permission);
        }
        project.userAccess = access;
      }
      await ProjectsDataUpdate(project);
      return res.status(201).send(project.toTransportJson());
    });

    // ==================== DELETE ====================
    fastify.delete<{ Params: { id: string } }>("/:id", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const project = await ProjectsDataGet(req.params.id);
      if (!project) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      if (project.isDefault) {
        return res.status(400).send({ error: "Cannot delete default project" });
      }
      const templateIds = await TaskTemplatesListIdsByProject(req.params.id);
      await ProjectsDataDelete(req.params.id);
      // The templates (and their cron jobs) are gone with the project
      for (const templateId of templateIds) {
        TaskTemplatesSchedulerRefresh(templateId);
      }
      return res.status(201).send({});
    });
  }
}
