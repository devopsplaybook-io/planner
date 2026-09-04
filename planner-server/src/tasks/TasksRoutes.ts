import { FastifyInstance, RequestGenericInterface } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { Task } from "../model/Task";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import { UsersDataGet } from "../users/UsersData";
import { NotificationsTaskUpdated } from "../notifications/Notifications";
import {
  TasksDataAdd,
  TasksDataDelete,
  TasksDataGet,
  TasksDataList,
  TasksDataTouch,
  TasksDataUpdate,
  addAssignee,
  removeAssignee,
  addComment,
  deleteComment,
  clearLabels,
  addLabel,
  addTaskAttachment,
  deleteTaskAttachment,
  getTaskAttachment,
} from "./TasksData";
import * as fs from "fs-extra";
import * as path from "path";

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

export class TasksRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== LIST ====================
    fastify.get<{ Querystring: { projectId?: string } }>(
      "/",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const tasks = await TasksDataList(req.query.projectId);
        return res.status(200).send(tasks.map((t) => t.toTransportJson()));
      },
    );

    // ==================== GET BY ID ====================
    fastify.get<{ Params: { id: string } }>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const task = await TasksDataGet(req.params.id);
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
      };
    }
    fastify.put<PutTask>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const task = await TasksDataGet(req.params.id);
      if (!task) return res.status(404).send({ error: "Task Not Found" });
      const userSession = await AuthGetUserSession(req);
      const before = {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate || "",
        checklist: JSON.stringify(task.checklist),
      };
      if (req.body.title) task.title = req.body.title;
      if (req.body.description !== undefined)
        task.description = req.body.description;
      if (req.body.status) task.status = req.body.status;
      if (req.body.priority) task.priority = req.body.priority;
      if (req.body.dueDate !== undefined) task.dueDate = req.body.dueDate;
      if (req.body.checklist) task.checklist = req.body.checklist;
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
      notifyAssignees(
        req.params.id,
        userSession.userId,
        changes.join(", ") || "updated",
      );
      return res.status(201).send(task.toTransportJson());
    });

    // ==================== DELETE ====================
    fastify.delete<{ Params: { id: string } }>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const task = await TasksDataGet(req.params.id);
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
      const task = await TasksDataGet(req.params.id);
      if (!task) return res.status(404).send({ error: "Task Not Found" });
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
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const userSession = await AuthGetUserSession(req);
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
      if (!req.body.userId)
        return res.status(400).send({ error: "Missing: userId" });
      const userSession = await AuthGetUserSession(req);
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
        const task = await TasksDataGet(req.params.id);
        if (!task) {
          return res.status(404).send({ error: "Task Not Found" });
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
        const userSession = await AuthGetUserSession(req);
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
        const attachment = await getTaskAttachment(req.params.attachmentId);
        if (!attachment) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        if (attachment.taskId !== req.params.id) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        if (await fs.pathExists(attachment.filePath)) {
          await fs.remove(attachment.filePath);
        }
        await deleteTaskAttachment(req.params.attachmentId);
        await TasksDataTouch(attachment.taskId);
        const userSession = await AuthGetUserSession(req);
        notifyAssignees(attachment.taskId, userSession.userId, "Attachment deleted");
        return res.status(201).send({});
      },
    );
  }
}
