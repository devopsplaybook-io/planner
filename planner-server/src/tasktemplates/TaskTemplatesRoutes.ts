import { FastifyInstance, RequestGenericInterface } from "fastify";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs-extra";
import * as path from "path";
import * as cron from "node-cron";
import { TaskTemplate } from "../model/TaskTemplate";
import { UserSession } from "../model/UserSession";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import { UsersDataGet } from "../users/UsersData";
import {
  hasProjectPermission,
  isProjectItemVisible,
  isProjectVisible,
  permissionDeniedMessage,
  projectMutationError,
} from "../projects/ProjectVisibility";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { TaskTemplatesSchedulerRefresh } from "./TaskTemplatesScheduler";
import { createInstanceFromTemplate } from "./TaskTemplatesInstance";
import {
  TaskTemplatesAdd,
  TaskTemplatesDelete,
  TaskTemplatesGet,
  TaskTemplatesList,
  TaskTemplatesUpdate,
  TaskTemplateListFilters,
  addTemplateComment,
  addTemplateAttachment,
  deleteTemplateAttachment,
  deleteTemplateComment,
  getTemplateAttachment,
  getTemplateComment,
  replaceTemplateAssignees,
  replaceTemplateLabels,
  updateTemplateComment,
} from "./TaskTemplatesData";
import {
  parseProjectIds,
  validateAssigneeList,
  validateLabelList,
} from "../tasks/TasksRoutes";

/**
 * Validates an automation payload: a valid 5-field cron string (or null =
 * no schedule), the two boolean flags and an optional initial instance
 * status. Returns the normalized values or an error message. Pure so routes
 * can answer 400 without touching the database.
 */
interface ParsedAutomation {
  scheduleCron?: string | null;
  skipIfPreviousNotDone?: boolean;
  addDateToTitle?: boolean;
  instanceStatus?: string | null;
  error?: string;
}

export function parseAutomation(value: unknown): ParsedAutomation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Invalid: automation (must be an object)" };
  }
  const raw = value as Record<string, unknown>;
  let scheduleCron: string | null | undefined;
  if (raw.scheduleCron !== undefined) {
    if (raw.scheduleCron === null || raw.scheduleCron === "") {
      scheduleCron = null;
    } else if (typeof raw.scheduleCron === "string") {
      if (!cron.validate(raw.scheduleCron)) {
        return {
          error:
            "Invalid: automation.scheduleCron (must be a valid cron expression)",
        };
      }
      scheduleCron = raw.scheduleCron;
    } else {
      return {
        error:
          "Invalid: automation.scheduleCron (must be a valid cron expression)",
      };
    }
  }
  if (
    raw.skipIfPreviousNotDone !== undefined &&
    typeof raw.skipIfPreviousNotDone !== "boolean"
  ) {
    return {
      error: "Invalid: automation.skipIfPreviousNotDone (must be a boolean)",
    };
  }
  if (raw.addDateToTitle !== undefined && typeof raw.addDateToTitle !== "boolean") {
    return { error: "Invalid: automation.addDateToTitle (must be a boolean)" };
  }
  let instanceStatus: string | null | undefined;
  if (raw.instanceStatus !== undefined) {
    if (raw.instanceStatus === null || raw.instanceStatus === "") {
      instanceStatus = null;
    } else if (typeof raw.instanceStatus === "string") {
      instanceStatus = raw.instanceStatus;
    } else {
      return {
        error:
          "Invalid: automation.instanceStatus (must be a status of the project)",
      };
    }
  }
  return {
    scheduleCron,
    skipIfPreviousNotDone: raw.skipIfPreviousNotDone as boolean | undefined,
    addDateToTitle: raw.addDateToTitle as boolean | undefined,
    instanceStatus,
  };
}

/**
 * Loads a template and returns null when it does not exist or sits in a
 * project the user cannot see (admins bypass). Both cases answer 404 so
 * restricted templates are not distinguishable from missing ones.
 */
async function getVisibleTemplate(
  id: string,
  userSession: UserSession,
): Promise<TaskTemplate> {
  const template = await TaskTemplatesGet(id);
  if (!template) {
    return null;
  }
  if (!(await isProjectItemVisible(template, userSession))) {
    return null;
  }
  return template;
}

export class TaskTemplatesRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== LIST ====================
    fastify.get<{
      Querystring: { projectId?: string; projectIds?: string; q?: string };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const filters: TaskTemplateListFilters = {
        projectId: req.query.projectId,
        projectIds: parseProjectIds(req.query.projectIds),
        q: req.query.q?.trim() || undefined,
      };
      if (userSession.role !== "admin") {
        filters.visibleTo = { userId: userSession.userId };
      }
      const templates = await TaskTemplatesList(filters);
      return res.status(200).send(templates.map((t) => t.toTransportJson()));
    });

    // ==================== GET BY ID ====================
    fastify.get<{ Params: { id: string } }>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const template = await getVisibleTemplate(req.params.id, userSession);
      if (!template) {
        return res.status(404).send({ error: "Template Not Found" });
      }
      return res.status(200).send(template.toTransportJson());
    });

    // ==================== CREATE ====================
    interface PostTemplate extends RequestGenericInterface {
      Body: {
        projectId: string;
        title: string;
        description?: string;
        priority?: string;
        checklist?: { text: string; done: boolean }[];
        automation?: {
          scheduleCron?: string | null;
          skipIfPreviousNotDone?: boolean;
          addDateToTitle?: boolean;
          instanceStatus?: string | null;
        };
        assignees?: string[];
        labels?: string[];
      };
    }
    fastify.post<PostTemplate>("/", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      if (!req.body.projectId)
        return res.status(400).send({ error: "Missing: projectId" });
      if (!req.body.title)
        return res.status(400).send({ error: "Missing: title" });
      const project = await ProjectsDataGet(req.body.projectId);
      if (!project || !isProjectVisible(project, userSession)) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      if (project.archived) {
        return res.status(400).send({ error: "Project is archived" });
      }
      if (!hasProjectPermission(project, userSession, "update")) {
        return res
          .status(403)
          .send({ error: permissionDeniedMessage("update") });
      }
      let automation: ParsedAutomation = {};
      if (req.body.automation !== undefined) {
        const parsed = parseAutomation(req.body.automation);
        if (parsed.error) {
          return res.status(400).send({ error: parsed.error });
        }
        if (
          parsed.instanceStatus &&
          !project.statuses.includes(parsed.instanceStatus)
        ) {
          return res.status(400).send({
            error:
              "Invalid: automation.instanceStatus (must be a status of the project)",
          });
        }
        automation = parsed;
      }
      let assigneeIds: string[] | undefined;
      if (req.body.assignees !== undefined) {
        try {
          assigneeIds = await validateAssigneeList(req.body.assignees);
        } catch (error) {
          return res.status(400).send({ error: (error as Error).message });
        }
      }
      let labels: string[] | undefined;
      if (req.body.labels !== undefined) {
        try {
          labels = validateLabelList(req.body.labels);
        } catch (error) {
          return res.status(400).send({ error: (error as Error).message });
        }
      }
      const template = new TaskTemplate();
      template.projectId = req.body.projectId;
      template.title = req.body.title;
      template.description = req.body.description || "";
      if (req.body.priority) template.priority = req.body.priority;
      if (req.body.checklist) template.checklist = req.body.checklist;
      if (automation.scheduleCron !== undefined)
        template.scheduleCron = automation.scheduleCron || undefined;
      if (automation.skipIfPreviousNotDone !== undefined)
        template.skipIfPreviousNotDone = automation.skipIfPreviousNotDone;
      if (automation.addDateToTitle !== undefined)
        template.addDateToTitle = automation.addDateToTitle;
      if (automation.instanceStatus !== undefined)
        template.instanceStatus = automation.instanceStatus || undefined;
      if (assigneeIds)
        template.assignees = assigneeIds.map((userId) => ({ userId }));
      if (labels) template.labels = labels;
      await TaskTemplatesAdd(template);
      TaskTemplatesSchedulerRefresh(template.id);
      return res.status(201).send(template.toTransportJson());
    });

    // ==================== UPDATE ====================
    interface PutTemplate extends RequestGenericInterface {
      Params: { id: string };
      Body: {
        projectId?: string;
        title?: string;
        description?: string;
        priority?: string;
        checklist?: { text: string; done: boolean }[];
        automation?: {
          scheduleCron?: string | null;
          skipIfPreviousNotDone?: boolean;
          addDateToTitle?: boolean;
          instanceStatus?: string | null;
        };
        assignees?: string[];
        labels?: string[];
      };
    }
    fastify.put<PutTemplate>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      const template = await getVisibleTemplate(req.params.id, userSession);
      if (!template) return res.status(404).send({ error: "Template Not Found" });
      if (req.body.projectId && req.body.projectId !== template.projectId) {
        const project = await ProjectsDataGet(req.body.projectId);
        if (!project || !isProjectVisible(project, userSession)) {
          return res.status(404).send({ error: "Project Not Found" });
        }
        if (project.archived) {
          return res.status(400).send({ error: "Project is archived" });
        }
        if (!hasProjectPermission(project, userSession, "update")) {
          return res
            .status(403)
            .send({ error: permissionDeniedMessage("update") });
        }
        template.projectId = req.body.projectId;
      }
      const guard = await projectMutationError(
        template.projectId,
        userSession,
        "update",
      );
      if (guard) {
        return res.status(guard.status).send({ error: guard.error });
      }
      let assigneeIds: string[] | undefined;
      if (req.body.assignees !== undefined) {
        try {
          assigneeIds = await validateAssigneeList(req.body.assignees);
        } catch (error) {
          return res.status(400).send({ error: (error as Error).message });
        }
      }
      let labels: string[] | undefined;
      if (req.body.labels !== undefined) {
        try {
          labels = validateLabelList(req.body.labels);
        } catch (error) {
          return res.status(400).send({ error: (error as Error).message });
        }
      }
      if (req.body.title) template.title = req.body.title;
      if (req.body.description !== undefined)
        template.description = req.body.description;
      if (req.body.priority) template.priority = req.body.priority;
      if (req.body.checklist) template.checklist = req.body.checklist;
      if (req.body.automation !== undefined) {
        const parsed = parseAutomation(req.body.automation);
        if (parsed.error) {
          return res.status(400).send({ error: parsed.error });
        }
        if (parsed.instanceStatus) {
          // template.projectId was already switched to the new project above
          const effectiveProject = await ProjectsDataGet(template.projectId);
          if (!effectiveProject?.statuses.includes(parsed.instanceStatus)) {
            return res.status(400).send({
              error:
                "Invalid: automation.instanceStatus (must be a status of the project)",
            });
          }
        }
        if (parsed.scheduleCron !== undefined)
          template.scheduleCron = parsed.scheduleCron || undefined;
        if (parsed.skipIfPreviousNotDone !== undefined)
          template.skipIfPreviousNotDone = parsed.skipIfPreviousNotDone;
        if (parsed.addDateToTitle !== undefined)
          template.addDateToTitle = parsed.addDateToTitle;
        if (parsed.instanceStatus !== undefined)
          template.instanceStatus = parsed.instanceStatus || undefined;
      }
      // Clear an initial status the (possibly new) project does not have:
      // instance creation would silently fall back to the project's first
      // status, so the stored value must not outlive its project
      if (template.instanceStatus) {
        const effectiveProject = await ProjectsDataGet(template.projectId);
        if (!effectiveProject?.statuses.includes(template.instanceStatus)) {
          template.instanceStatus = undefined;
        }
      }
      if (assigneeIds)
        template.assignees = assigneeIds.map((userId) => ({ userId }));
      if (labels) template.labels = labels;
      await TaskTemplatesUpdate(template);
      if (assigneeIds) {
        await replaceTemplateAssignees(template.id, assigneeIds);
      }
      if (labels) {
        await replaceTemplateLabels(template.id, labels);
      }
      TaskTemplatesSchedulerRefresh(template.id);
      return res.status(201).send(template.toTransportJson());
    });

    // ==================== DELETE ====================
    fastify.delete<{ Params: { id: string } }>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      const template = await getVisibleTemplate(req.params.id, userSession);
      if (!template) return res.status(404).send({ error: "Template Not Found" });
      const project = await ProjectsDataGet(template.projectId);
      if (!hasProjectPermission(project, userSession, "all")) {
        return res.status(403).send({ error: permissionDeniedMessage("all") });
      }
      await TaskTemplatesDelete(req.params.id);
      TaskTemplatesSchedulerRefresh(req.params.id);
      return res.status(201).send({});
    });

    // ==================== CREATE INSTANCE ====================
    fastify.post<{ Params: { id: string } }>(
      "/:id/create-instance",
      async (req, res) => {
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const userSession = await AuthGetUserSession(req);
        const template = await getVisibleTemplate(req.params.id, userSession);
        if (!template)
          return res.status(404).send({ error: "Template Not Found" });
        const project = await ProjectsDataGet(template.projectId);
        if (project?.archived) {
          return res.status(400).send({ error: "Project is archived" });
        }
        if (!hasProjectPermission(project, userSession, "update")) {
          return res
            .status(403)
            .send({ error: permissionDeniedMessage("update") });
        }
        const task = await createInstanceFromTemplate(template, project);
        return res.status(201).send(task.toTransportJson());
      },
    );

    // ==================== COMMENTS ====================
    interface PostTemplateComment extends RequestGenericInterface {
      Params: { id: string };
      Body: { text: string };
    }
    fastify.post<PostTemplateComment>("/:id/comments", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      const template = await getVisibleTemplate(req.params.id, userSession);
      if (!template) return res.status(404).send({ error: "Template Not Found" });
      const guard = await projectMutationError(
        template.projectId,
        userSession,
        "comment",
      );
      if (guard) {
        return res.status(guard.status).send({ error: guard.error });
      }
      if (!req.body.text)
        return res.status(400).send({ error: "Missing: text" });
      const user = await UsersDataGet(userSession.userId);
      const comment = {
        id: uuidv4(),
        userId: userSession.userId,
        userName: user?.name,
        text: req.body.text,
        dateCreated: new Date().toISOString(),
      };
      await addTemplateComment(req.params.id, comment);
      return res.status(201).send(comment);
    });

    fastify.delete<{ Params: { id: string; commentId: string } }>(
      "/:id/comments/:commentId",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const template = await getVisibleTemplate(req.params.id, userSession);
        if (!template)
          return res.status(404).send({ error: "Template Not Found" });
        const guard = await projectMutationError(
          template.projectId,
          userSession,
          "comment",
        );
        if (guard) {
          return res.status(guard.status).send({ error: guard.error });
        }
        const comment = await getTemplateComment(req.params.commentId, req.params.id);
        if (!comment)
          return res.status(404).send({ error: "Comment Not Found" });
        if (
          comment.userId !== userSession.userId &&
          userSession.role !== "admin"
        ) {
          return res.status(403).send({ error: "Access Denied" });
        }
        await deleteTemplateComment(req.params.commentId);
        return res.status(201).send({});
      },
    );

    interface PutTemplateComment extends RequestGenericInterface {
      Params: { id: string; commentId: string };
      Body: { text: string };
    }
    fastify.put<PutTemplateComment>(
      "/:id/comments/:commentId",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const template = await getVisibleTemplate(req.params.id, userSession);
        if (!template)
          return res.status(404).send({ error: "Template Not Found" });
        const guard = await projectMutationError(
          template.projectId,
          userSession,
          "comment",
        );
        if (guard) {
          return res.status(guard.status).send({ error: guard.error });
        }
        const comment = await getTemplateComment(req.params.commentId, req.params.id);
        if (!comment)
          return res.status(404).send({ error: "Comment Not Found" });
        if (
          comment.userId !== userSession.userId &&
          userSession.role !== "admin"
        ) {
          return res.status(403).send({ error: "Access Denied" });
        }
        if (!req.body.text)
          return res.status(400).send({ error: "Missing: text" });
        await updateTemplateComment(req.params.commentId, req.body.text);
        const updated = await getTemplateComment(req.params.commentId, req.params.id);
        return res.status(200).send(updated);
      },
    );

    // ==================== ATTACHMENTS ====================
    fastify.post<{ Params: { id: string } }>(
      "/:id/attachments",
      async (req, res) => {
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const userSession = await AuthGetUserSession(req);
        const template = await getVisibleTemplate(req.params.id, userSession);
        if (!template)
          return res.status(404).send({ error: "Template Not Found" });
        const guard = await projectMutationError(
          template.projectId,
          userSession,
          "update",
        );
        if (guard) {
          return res.status(guard.status).send({ error: guard.error });
        }

        const data = await req.file({ throwFileSizeLimit: false });
        if (!data) {
          return res.status(400).send({ error: "No file uploaded" });
        }

        const uploadDir = process.env.DATA_DIR || "/data";
        const attachmentDir = path.join(
          uploadDir,
          "attachments",
          "task-templates",
        );
        await fs.ensureDir(attachmentDir);

        const attachmentId = uuidv4();
        const ext = path.extname(data.filename);
        const savedFileName = attachmentId + ext;
        const filePath = path.join(attachmentDir, savedFileName);

        const writeStream = fs.createWriteStream(filePath);
        try {
          await new Promise<void>((resolve, reject) => {
            data.file.on("error", reject);
            data.file.pipe(writeStream);
            writeStream.on("finish", () => resolve());
            writeStream.on("error", reject);
          });
        } catch {
          await fs.remove(filePath).catch(() => undefined);
          return res.status(400).send({ error: "Invalid file upload" });
        }
        if (data.file.truncated) {
          await fs.remove(filePath).catch(() => undefined);
          return res.status(413).send({ error: "File too large" });
        }

        await addTemplateAttachment(
          req.params.id,
          data.filename,
          filePath,
          attachmentId,
        );

        return res.status(201).send({
          id: attachmentId,
          fileName: data.filename,
          filePath: filePath,
          dateCreated: new Date().toISOString(),
        });
      },
    );

    fastify.get<{
      Params: { id: string; attachmentId: string };
      Querystring: { inline?: string };
    }>("/:id/attachments/:attachmentId", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const attachment = await getTemplateAttachment(req.params.attachmentId);
      if (!attachment) {
        return res.status(404).send({ error: "Attachment Not Found" });
      }
      if (attachment.templateId !== req.params.id) {
        return res.status(404).send({ error: "Attachment Not Found" });
      }
      if (!(await getVisibleTemplate(attachment.templateId, userSession))) {
        return res.status(404).send({ error: "Attachment Not Found" });
      }
      if (!(await fs.pathExists(attachment.filePath))) {
        return res.status(404).send({ error: "File Not Found" });
      }

      const ext = path.extname(attachment.fileName).toLowerCase();
      // SVG can carry scripts: serving it inline would run them on the app
      // origin (stored XSS), so it is always served as a download
      if (req.query.inline === "true" && ext !== ".svg") {
        const mimeTypes: Record<string, string> = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".bmp": "image/bmp",
          ".ico": "image/x-icon",
          ".avif": "image/avif",
          ".pdf": "application/pdf",
          // Audio (voice message recordings and other audio attachments)
          ".mp3": "audio/mpeg",
          ".wav": "audio/wav",
          ".ogg": "audio/ogg",
          ".oga": "audio/ogg",
          ".opus": "audio/opus",
          ".m4a": "audio/mp4",
          ".aac": "audio/aac",
          ".flac": "audio/flac",
          ".webm": "audio/webm",
        };
        res.type(mimeTypes[ext] || "application/octet-stream");
        res.header(
          "Content-Disposition",
          `inline; filename="${attachment.fileName}"`,
        );
        // PDFs must not carry this header: a sandbox CSP (or iframe sandbox)
        // blocks the browser's built-in PDF viewer, so the file would never
        // render. The exact content type + nosniff keep it inert anyway.
        if (ext !== ".pdf") {
          // Defense-in-depth: inert even if a listed type turns out active
          res.header("Content-Security-Policy", "sandbox");
        }
        res.header("X-Content-Type-Options", "nosniff");
      } else {
        res.type("application/octet-stream");
        res.header(
          "Content-Disposition",
          `attachment; filename="${attachment.fileName}"`,
        );
      }

      const stream = fs.createReadStream(attachment.filePath);
      return res.send(stream);
    });

    fastify.delete<{ Params: { id: string; attachmentId: string } }>(
      "/:id/attachments/:attachmentId",
      async (req, res) => {
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const userSession = await AuthGetUserSession(req);
        const attachment = await getTemplateAttachment(req.params.attachmentId);
        if (!attachment) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        if (attachment.templateId !== req.params.id) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        const visibleTemplate = await getVisibleTemplate(
          attachment.templateId,
          userSession,
        );
        if (!visibleTemplate) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        const guard = await projectMutationError(
          visibleTemplate.projectId,
          userSession,
          "update",
        );
        if (guard) {
          return res.status(guard.status).send({ error: guard.error });
        }
        if (await fs.pathExists(attachment.filePath)) {
          await fs.remove(attachment.filePath);
        }
        await deleteTemplateAttachment(req.params.attachmentId);
        return res.status(201).send({});
      },
    );
  }
}
