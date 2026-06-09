import { FastifyInstance, RequestGenericInterface } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { Note } from "../model/Note";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import {
  NotesDataAdd,
  NotesDataDelete,
  NotesDataGet,
  NotesDataList,
  NotesDataUpdate,
  addNoteComment,
  deleteNoteComment,
  clearNoteLabels,
  addNoteLabel,
} from "./NotesData";

export class NotesRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== LIST ====================
    fastify.get<{ Querystring: { projectId?: string } }>(
      "/",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const notes = await NotesDataList(req.query.projectId);
        return res.status(200).send(notes.map((n) => n.toTransportJson()));
      },
    );

    // ==================== GET BY ID ====================
    fastify.get<{ Params: { id: string } }>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const note = await NotesDataGet(req.params.id);
      if (!note) {
        return res.status(404).send({ error: "Note Not Found" });
      }
      return res.status(200).send(note.toTransportJson());
    });

    // ==================== CREATE ====================
    interface PostNote extends RequestGenericInterface {
      Body: {
        projectId: string;
        title: string;
        description?: string;
        labels?: string[];
      };
    }
    fastify.post<PostNote>("/", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      if (!req.body.projectId)
        return res.status(400).send({ error: "Missing: projectId" });
      if (!req.body.title)
        return res.status(400).send({ error: "Missing: title" });

      const note = new Note();
      note.projectId = req.body.projectId;
      note.title = req.body.title;
      note.description = req.body.description || "";
      if (req.body.labels) note.labels = req.body.labels;
      await NotesDataAdd(note);
      for (const label of note.labels) {
        await addNoteLabel(note.id, label);
      }
      return res.status(201).send(note.toTransportJson());
    });

    // ==================== UPDATE ====================
    interface PutNote extends RequestGenericInterface {
      Params: { id: string };
      Body: { title?: string; description?: string };
    }
    fastify.put<PutNote>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const note = await NotesDataGet(req.params.id);
      if (!note) return res.status(404).send({ error: "Note Not Found" });
      if (req.body.title) note.title = req.body.title;
      if (req.body.description !== undefined)
        note.description = req.body.description;
      await NotesDataUpdate(note);
      return res.status(201).send(note.toTransportJson());
    });

    // ==================== DELETE ====================
    fastify.delete<{ Params: { id: string } }>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const note = await NotesDataGet(req.params.id);
      if (!note) return res.status(404).send({ error: "Note Not Found" });
      await NotesDataDelete(req.params.id);
      return res.status(201).send({});
    });

    // ==================== COMMENTS ====================
    interface PostNoteComment extends RequestGenericInterface {
      Params: { id: string };
      Body: { text: string };
    }
    fastify.post<PostNoteComment>("/:id/comments", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      if (!req.body.text)
        return res.status(400).send({ error: "Missing: text" });
      const comment = {
        id: uuidv4(),
        userId: userSession.userId,
        text: req.body.text,
        dateCreated: new Date().toISOString(),
      };
      await addNoteComment(req.params.id, comment);
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
        await deleteNoteComment(req.params.commentId);
        return res.status(201).send({});
      },
    );

    // ==================== LABELS ====================
    interface PostNoteLabel extends RequestGenericInterface {
      Params: { id: string };
      Body: { labels: string[] };
    }
    fastify.post<PostNoteLabel>("/:id/labels", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      await clearNoteLabels(req.params.id);
      for (const label of req.body.labels) {
        await addNoteLabel(req.params.id, label);
      }
      return res.status(201).send({});
    });
  }
}
