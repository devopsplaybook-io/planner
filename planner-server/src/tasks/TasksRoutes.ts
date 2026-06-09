import { FastifyInstance, RequestGenericInterface } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { Task } from "../model/Task";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import {
  TasksDataAdd,
  TasksDataDelete,
  TasksDataGet,
  TasksDataList,
  TasksDataUpdate,
  addAssignee,
  removeAssignee,
  addComment,
  deleteComment,
  clearLabels,
  addLabel,
} from "./TasksData";

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
      };
    }
    fastify.post<PostTask>("/", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
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
      if (req.body.labels) task.labels = req.body.labels;
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
      if (req.body.title) task.title = req.body.title;
      if (req.body.description !== undefined)
        task.description = req.body.description;
      if (req.body.status) task.status = req.body.status;
      if (req.body.priority) task.priority = req.body.priority;
      if (req.body.dueDate !== undefined) task.dueDate = req.body.dueDate;
      if (req.body.checklist) task.checklist = req.body.checklist;
      await TasksDataUpdate(task);
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
      const comment = {
        id: uuidv4(),
        userId: userSession.userId,
        text: req.body.text,
        dateCreated: new Date().toISOString(),
      };
      await addComment(req.params.id, comment);
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
        await deleteComment(req.params.commentId);
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
      await addAssignee(req.params.id, req.body.userId);
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
        await removeAssignee(req.params.id, req.params.userId);
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
      await clearLabels(req.params.id);
      for (const label of req.body.labels) {
        await addLabel(req.params.id, label);
      }
      return res.status(201).send({});
    });
  }
}
