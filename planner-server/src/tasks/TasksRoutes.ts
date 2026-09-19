import { FastifyInstance, RequestGenericInterface } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { Task } from "../model/Task";
import { Project } from "../model/Project";
import { UserSession } from "../model/UserSession";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import { UsersDataGet } from "../users/UsersData";
import { NotificationsTaskUpdated } from "../notifications/Notifications";
import {
  isProjectItemVisible,
  isProjectVisible,
} from "../projects/ProjectVisibility";
import { ProjectsDataGet } from "../projects/ProjectsData";
import {
  TasksDataAdd,
  TasksDataDelete,
  TasksDataGet,
  TasksDataList,
  TasksDataTouch,
  TasksDataUpdate,
  TaskListFilters,
  addAssignee,
  removeAssignee,
  addComment,
  deleteComment,
  getComment,
  updateComment,
  clearLabels,
  addLabel,
  addTaskAttachment,
  deleteTaskAttachment,
  getTaskAttachment,
} from "./TasksData";
import * as fs from "fs-extra";
import * as path from "path";
import { buildAttachmentCopyPath, cloneTaskFrom } from "./TasksClone";
import { TaskImproveText } from "./TaskImprove";

/**
 * Fire-and-forget push notification to the task assignees (excluding the
 * actor) that the task changed. Never awaited and never throws: a
 * notification problem must not slow down or fail the mutation.
 */
function notifyAssignees(
  taskId: string,
  actorUserId: string,
  summary: string,
): void {
  (async () => {
    const task = await TasksDataGet(taskId);
    if (!task) {
      return;
    }
    const actor = await UsersDataGet(actorUserId);
    await NotificationsTaskUpdated(
      task,
      actorUserId,
      actor?.name || "",
      summary,
    );
  })().catch(() => {
    // Notification failures are logged inside NotificationsTaskUpdated
  });
}

/**
 * Validates the optional doneSince query param (ISO 8601 timestamp).
 * Returns undefined when absent/empty, the normalized ISO string when
 * valid, and throws when the value cannot be parsed as a date. Pure so
 * it can be unit-tested without the route layer.
 */
export function parseDoneSince(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const date = new Date(value as string);
  if (isNaN(date.getTime())) {
    throw new Error("Invalid: doneSince (must be an ISO 8601 date)");
  }
  return date.toISOString();
}

/**
 * Validates the optional comma-separated projectIds query param (the
 * expanded subtree of a selected project). Returns undefined when
 * absent/empty and otherwise the trimmed, non-empty, de-duplicated id list.
 * Pure so it can be unit-tested without the route layer.
 */
export function parseProjectIds(value: unknown): string[] | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const ids: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim();
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids.length > 0 ? ids : undefined;
}

/**
 * Loads a task and returns null when it does not exist or sits in a project
 * the user cannot see (admins bypass). Both cases answer 404 so restricted
 * tasks are not distinguishable from missing ones.
 */
async function getVisibleTask(
  id: string,
  userSession: UserSession,
): Promise<Task> {
  const task = await TasksDataGet(id);
  if (!task) {
    return null;
  }
  if (!(await isProjectItemVisible(task, userSession))) {
    return null;
  }
  return task;
}

/**
 * Error message when the project is archived, null when it is active (or
 * missing — callers answer 404 for missing projects themselves). Archived
 * projects are read-only for tasks: create, clone, update and every
 * sub-resource mutation are blocked; reads stay allowed.
 */
async function archivedProjectError(
  projectId: string,
): Promise<string | null> {
  const project = await ProjectsDataGet(projectId);
  return project?.archived ? "Project is archived" : null;
}

export class TasksRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== LIST ====================
    fastify.get<{
      Querystring: {
        projectId?: string;
        projectIds?: string;
        doneSince?: string;
        q?: string;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      let doneSince: string | undefined;
      try {
        doneSince = parseDoneSince(req.query.doneSince);
      } catch (error) {
        return res.status(400).send({ error: (error as Error).message });
      }
      const filters: TaskListFilters = {
        projectId: req.query.projectId,
        projectIds: parseProjectIds(req.query.projectIds),
        doneSince,
        q: req.query.q?.trim() || undefined,
      };
      if (userSession.role !== "admin") {
        filters.visibleTo = { userId: userSession.userId };
      }
      const tasks = await TasksDataList(filters);
      return res.status(200).send(tasks.map((t) => t.toTransportJson()));
    });

    // ==================== GET BY ID ====================
    fastify.get<{ Params: { id: string } }>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const task = await getVisibleTask(req.params.id, userSession);
      if (!task) {
        return res.status(404).send({ error: "Task Not Found" });
      }
      return res.status(200).send(task.toTransportJson());
    });

    // ==================== CREATE ====================
    interface PostTask extends RequestGenericInterface {
      Body: {
        projectId: string;
        title: string;
        description?: string;
        status?: string;
        priority?: string;
        dueDate?: string;
        assignees?: string[];
        labels?: string[];
        checklist?: { text: string; done: boolean }[];
      };
    }
    fastify.post<PostTask>("/", async (req, res) => {
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

      const task = new Task();
      task.projectId = req.body.projectId;
      task.title = req.body.title;
      task.description = req.body.description || "";
      if (req.body.status) task.status = req.body.status;
      if (req.body.priority) task.priority = req.body.priority;
      if (req.body.dueDate) task.dueDate = req.body.dueDate;
      if (req.body.assignees)
        task.assignees = req.body.assignees.map((u) => ({ userId: u }));
      else if (userSession.userId)
        task.assignees = [{ userId: userSession.userId }];
      if (req.body.labels) task.labels = req.body.labels;
      if (req.body.checklist) task.checklist = req.body.checklist;
      await TasksDataAdd(task);
      return res.status(201).send(task.toTransportJson());
    });

    // ==================== CLONE ====================
    fastify.post<{ Params: { id: string } }>("/:id/clone", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      const task = await getVisibleTask(req.params.id, userSession);
      if (!task) return res.status(404).send({ error: "Task Not Found" });
      // A clone is fresh work: it starts in the first status of the project
      const project = await ProjectsDataGet(task.projectId);
      if (project?.archived) {
        return res.status(400).send({ error: "Project is archived" });
      }
      const clone = cloneTaskFrom(task, project?.statuses?.[0]);
      await TasksDataAdd(clone);

      // Copy the attachment files: the browser only knows ids, not contents
      const copiedAttachments = [];
      for (const attachment of task.attachments || []) {
        if (!(await fs.pathExists(attachment.filePath))) {
          continue;
        }
        const attachmentId = uuidv4();
        const copyPath = buildAttachmentCopyPath(
          attachment.filePath,
          attachmentId,
        );
        await fs.copy(attachment.filePath, copyPath);
        await addTaskAttachment(
          clone.id,
          attachment.fileName,
          copyPath,
          attachmentId,
        );
        copiedAttachments.push({
          id: attachmentId,
          fileName: attachment.fileName,
          filePath: copyPath,
          dateCreated: new Date().toISOString(),
        });
      }
      clone.attachments = copiedAttachments;

      return res.status(201).send(clone.toTransportJson());
    });

    // ==================== IMPROVE (LLM) ====================
    interface PostImprove extends RequestGenericInterface {
      Body: { title?: string; description?: string };
    }
    fastify.post<PostImprove>("/improve", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const title = (req.body.title || "").trim();
      const description = (req.body.description || "").trim();
      if (!title && !description) {
        return res.status(400).send({ error: "Missing: title or description" });
      }
      let improved;
      try {
        improved = await TaskImproveText(title, description);
      } catch {
        return res
          .status(502)
          .send({ error: "Improve failed: the LLM request did not succeed" });
      }
      if (!improved) {
        return res
          .status(502)
          .send({ error: "Improve failed: the LLM response could not be used" });
      }
      return res.status(200).send(improved);
    });

    // ==================== UPDATE ====================
    interface PutTask extends RequestGenericInterface {
      Params: { id: string };
      Body: {
        title?: string;
        description?: string;
        status?: string;
        priority?: string;
        dueDate?: string;
        checklist?: { text: string; done: boolean }[];
        projectId?: string;
      };
    }
    fastify.put<PutTask>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      const task = await getVisibleTask(req.params.id, userSession);
      if (!task) return res.status(404).send({ error: "Task Not Found" });
      const archivedError = await archivedProjectError(task.projectId);
      if (archivedError) {
        return res.status(400).send({ error: archivedError });
      }
      const before = {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate || "",
        checklist: JSON.stringify(task.checklist),
        projectId: task.projectId,
      };
      if (req.body.title) task.title = req.body.title;
      if (req.body.description !== undefined)
        task.description = req.body.description;
      if (req.body.status) task.status = req.body.status;
      if (req.body.priority) task.priority = req.body.priority;
      if (req.body.dueDate !== undefined) task.dueDate = req.body.dueDate;
      if (req.body.checklist) task.checklist = req.body.checklist;
      let movedToProject: Project = null;
      if (req.body.projectId && req.body.projectId !== task.projectId) {
        const project = await ProjectsDataGet(req.body.projectId);
        if (!project || !isProjectVisible(project, userSession)) {
          return res.status(404).send({ error: "Project Not Found" });
        }
        if (project.archived) {
          return res.status(400).send({ error: "Project is archived" });
        }
        movedToProject = project;
        task.projectId = req.body.projectId;
        // The status belongs to the source project's catalog: a status the
        // target project does not use falls back to its first status
        if (!project.statuses.includes(task.status)) {
          task.status = project.statuses[0];
        }
      }
      await TasksDataUpdate(task);
      const changes: string[] = [];
      if (task.title !== before.title) changes.push("title");
      if (task.description !== before.description) changes.push("description");
      if (task.status !== before.status) changes.push(`status: ${task.status}`);
      if (task.priority !== before.priority)
        changes.push(`priority: ${task.priority}`);
      if ((task.dueDate || "") !== before.dueDate) changes.push("due date");
      if (JSON.stringify(task.checklist) !== before.checklist)
        changes.push("checklist");
      if (movedToProject) changes.push(`project: ${movedToProject.name}`);
      if (changes.length > 0) {
        notifyAssignees(
          req.params.id,
          userSession.userId,
          changes.join(", "),
        );
      }
      return res.status(201).send(task.toTransportJson());
    });

    // ==================== DELETE ====================
    fastify.delete<{ Params: { id: string } }>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      const task = await getVisibleTask(req.params.id, userSession);
      if (!task) return res.status(404).send({ error: "Task Not Found" });
      await TasksDataDelete(req.params.id);
      return res.status(201).send({});
    });

    // ==================== COMMENTS ====================
    interface PostComment extends RequestGenericInterface {
      Params: { id: string };
      Body: { text: string };
    }
    fastify.post<PostComment>("/:id/comments", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      const task = await getVisibleTask(req.params.id, userSession);
      if (!task) return res.status(404).send({ error: "Task Not Found" });
      const archivedError = await archivedProjectError(task.projectId);
      if (archivedError) {
        return res.status(400).send({ error: archivedError });
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
      await addComment(req.params.id, comment);
      await TasksDataTouch(req.params.id);
      notifyAssignees(req.params.id, userSession.userId, "New comment");
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
        const task = await getVisibleTask(req.params.id, userSession);
        if (!task)
          return res.status(404).send({ error: "Task Not Found" });
        const archivedError = await archivedProjectError(task.projectId);
        if (archivedError) {
          return res.status(400).send({ error: archivedError });
        }
        const comment = await getComment(req.params.commentId);
        if (!comment)
          return res.status(404).send({ error: "Comment Not Found" });
        if (comment.userId !== userSession.userId && userSession.role !== "admin") {
          return res.status(403).send({ error: "Access Denied" });
        }
        await deleteComment(req.params.commentId);
        await TasksDataTouch(req.params.id);
        notifyAssignees(
          req.params.id,
          userSession.userId,
          "Comment deleted",
        );
        return res.status(201).send({});
      },
    );

    interface PutComment extends RequestGenericInterface {
      Params: { id: string; commentId: string };
      Body: { text: string };
    }
    fastify.put<PutComment>("/:id/comments/:commentId", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const task = await getVisibleTask(req.params.id, userSession);
      if (!task)
        return res.status(404).send({ error: "Task Not Found" });
      const archivedError = await archivedProjectError(task.projectId);
      if (archivedError) {
        return res.status(400).send({ error: archivedError });
      }
      const comment = await getComment(req.params.commentId);
      if (!comment)
        return res.status(404).send({ error: "Comment Not Found" });
      if (comment.userId !== userSession.userId && userSession.role !== "admin") {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.text)
        return res.status(400).send({ error: "Missing: text" });
      await updateComment(req.params.commentId, req.body.text);
      await TasksDataTouch(req.params.id);
      notifyAssignees(req.params.id, userSession.userId, "Comment updated");
      const updated = await getComment(req.params.commentId);
      return res.status(200).send(updated);
    });

    // ==================== ASSIGNEES ====================
    interface PostAssignee extends RequestGenericInterface {
      Params: { id: string };
      Body: { userId: string };
    }
    fastify.post<PostAssignee>("/:id/assignees", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      const task = await getVisibleTask(req.params.id, userSession);
      if (!task) return res.status(404).send({ error: "Task Not Found" });
      const archivedError = await archivedProjectError(task.projectId);
      if (archivedError) {
        return res.status(400).send({ error: archivedError });
      }
      if (!req.body.userId)
        return res.status(400).send({ error: "Missing: userId" });
      await addAssignee(req.params.id, req.body.userId);
      await TasksDataTouch(req.params.id);
      notifyAssignees(req.params.id, userSession.userId, "Assignees updated");
      return res.status(201).send({});
    });

    fastify.delete<{ Params: { id: string; userId: string } }>(
      "/:id/assignees/:userId",
      async (req, res) => {
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const userSession = await AuthGetUserSession(req);
        const task = await getVisibleTask(req.params.id, userSession);
        if (!task) return res.status(404).send({ error: "Task Not Found" });
        const archivedError = await archivedProjectError(task.projectId);
        if (archivedError) {
          return res.status(400).send({ error: archivedError });
        }
        await removeAssignee(req.params.id, req.params.userId);
        await TasksDataTouch(req.params.id);
        notifyAssignees(req.params.id, userSession.userId, "Assignees updated");
        return res.status(201).send({});
      },
    );

    // ==================== LABELS ====================
    interface PostLabel extends RequestGenericInterface {
      Params: { id: string };
      Body: { labels: string[] };
    }
    fastify.post<PostLabel>("/:id/labels", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      const task = await getVisibleTask(req.params.id, userSession);
      if (!task) return res.status(404).send({ error: "Task Not Found" });
      const archivedError = await archivedProjectError(task.projectId);
      if (archivedError) {
        return res.status(400).send({ error: archivedError });
      }
      await clearLabels(req.params.id);
      for (const label of req.body.labels) {
        await addLabel(req.params.id, label);
      }
      await TasksDataTouch(req.params.id);
      notifyAssignees(req.params.id, userSession.userId, "Labels updated");
      return res.status(201).send({});
    });

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
        const task = await getVisibleTask(req.params.id, userSession);
        if (!task) {
          return res.status(404).send({ error: "Task Not Found" });
        }
        const archivedError = await archivedProjectError(task.projectId);
        if (archivedError) {
          return res.status(400).send({ error: archivedError });
        }

        const data = await req.file();
        if (!data) {
          return res.status(400).send({ error: "No file uploaded" });
        }

        const uploadDir = process.env.DATA_DIR || "/data";
        const attachmentDir = path.join(uploadDir, "attachments", "tasks");
        await fs.ensureDir(attachmentDir);

        const attachmentId = uuidv4();
        const ext = path.extname(data.filename);
        const savedFileName = attachmentId + ext;
        const filePath = path.join(attachmentDir, savedFileName);

        const writeStream = fs.createWriteStream(filePath);
        await new Promise<void>((resolve, reject) => {
          data.file.pipe(writeStream);
          writeStream.on("finish", () => resolve());
          writeStream.on("error", reject);
        });

        await addTaskAttachment(
          req.params.id,
          data.filename,
          filePath,
          attachmentId,
        );
        await TasksDataTouch(req.params.id);
        notifyAssignees(req.params.id, userSession.userId, "Attachment added");

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
        return res.status(403).send({ error: "Access Denied" });
      }
      const attachment = await getTaskAttachment(req.params.attachmentId);
      if (!attachment) {
        return res.status(404).send({ error: "Attachment Not Found" });
      }
      if (attachment.taskId !== req.params.id) {
        return res.status(404).send({ error: "Attachment Not Found" });
      }
      if (!(await getVisibleTask(attachment.taskId, userSession))) {
        return res.status(404).send({ error: "Attachment Not Found" });
      }
      if (!(await fs.pathExists(attachment.filePath))) {
        return res.status(404).send({ error: "File Not Found" });
      }

      if (req.query.inline === "true") {
        const ext = path.extname(attachment.fileName).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".svg": "image/svg+xml",
          ".bmp": "image/bmp",
          ".ico": "image/x-icon",
          ".avif": "image/avif",
        };
        res.type(mimeTypes[ext] || "application/octet-stream");
        res.header(
          "Content-Disposition",
          `inline; filename="${attachment.fileName}"`,
        );
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
        const attachment = await getTaskAttachment(req.params.attachmentId);
        if (!attachment) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        if (attachment.taskId !== req.params.id) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        const visibleTask = await getVisibleTask(attachment.taskId, userSession);
        if (!visibleTask) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        const archivedError = await archivedProjectError(
          visibleTask.projectId,
        );
        if (archivedError) {
          return res.status(400).send({ error: archivedError });
        }
        if (await fs.pathExists(attachment.filePath)) {
          await fs.remove(attachment.filePath);
        }
        await deleteTaskAttachment(req.params.attachmentId);
        await TasksDataTouch(attachment.taskId);
        notifyAssignees(attachment.taskId, userSession.userId, "Attachment deleted");
        return res.status(201).send({});
      },
    );
  }
}
