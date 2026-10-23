import { FastifyInstance, RequestGenericInterface } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { Note } from "../model/Note";
import { UserSession } from "../model/UserSession";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import {
  hasProjectPermission,
  isProjectItemVisible,
  isProjectVisible,
  permissionDeniedMessage,
  projectMutationError,
} from "../projects/ProjectVisibility";
import { ProjectsDataGet } from "../projects/ProjectsData";
import {
  parseLimit,
  parseOffset,
  parseProjectIds,
  validateLabelList,
} from "../tasks/TasksRoutes";
import {
  NotesDataAdd,
  NotesDataDelete,
  NotesDataGet,
  NotesDataList,
  NotesDataUpdate,
  NoteListFilters,
  addNoteComment,
  deleteNoteComment,
  getNoteComment,
  updateNoteComment,
  replaceNoteLabels,
  addNoteAttachment,
  deleteNoteAttachment,
  getNoteAttachment,
} from "./NotesData";
import * as fs from "fs-extra";
import * as path from "path";
import { buildContentDisposition } from "../utils/FileUtils";

/**
 * Loads a note and returns null when it does not exist or sits in a project
 * the user cannot see (admins bypass). Both cases answer 404 so restricted
 * notes are not distinguishable from missing ones.
 */
async function getVisibleNote(
  id: string,
  userSession: UserSession,
): Promise<Note> {
  const note = await NotesDataGet(id);
  if (!note) {
    return null;
  }
  if (!(await isProjectItemVisible(note, userSession))) {
    return null;
  }
  return note;
}

export class NotesRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== LIST ====================
    fastify.get<{
      Querystring: {
        projectId?: string;
        projectIds?: string;
        q?: string;
        limit?: string;
        offset?: string;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      let limit: number;
      let offset: number;
      try {
        limit = parseLimit(req.query.limit);
        offset = parseOffset(req.query.offset);
      } catch (error) {
        return res.status(400).send({ error: (error as Error).message });
      }
      const filters: NoteListFilters = {
        projectId: req.query.projectId,
        projectIds: parseProjectIds(req.query.projectIds),
        q: req.query.q?.trim() || undefined,
        limit,
        offset,
      };
      if (userSession.role !== "admin") {
        filters.visibleTo = { userId: userSession.userId };
      }
      const notes = await NotesDataList(filters);
      return res.status(200).send(notes.map((n) => n.toTransportJson()));
    });

    // ==================== GET BY ID ====================
    fastify.get<{ Params: { id: string } }>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const note = await getVisibleNote(req.params.id, userSession);
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

      let labels: string[] | undefined;
      if (req.body.labels !== undefined) {
        try {
          labels = validateLabelList(req.body?.labels);
        } catch (error) {
          return res.status(400).send({ error: (error as Error).message });
        }
      }

      const note = new Note();
      note.projectId = req.body.projectId;
      note.title = req.body.title;
      note.description = req.body.description || "";
      if (labels) note.labels = labels;
      await NotesDataAdd(note);
      return res.status(201).send(note.toTransportJson());
    });

    // ==================== UPDATE ====================
    interface PutNote extends RequestGenericInterface {
      Params: { id: string };
      Body: { title?: string; description?: string; projectId?: string };
    }
    fastify.put<PutNote>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      const note = await getVisibleNote(req.params.id, userSession);
      if (!note) return res.status(404).send({ error: "Note Not Found" });
      const guard = await projectMutationError(
        note.projectId,
        userSession,
        "update",
      );
      if (guard) {
        return res.status(guard.status).send({ error: guard.error });
      }
      if (req.body.title) note.title = req.body.title;
      if (req.body.description !== undefined)
        note.description = req.body.description;
      if (req.body.projectId && req.body.projectId !== note.projectId) {
        const project = await ProjectsDataGet(req.body.projectId);
        if (!project || !isProjectVisible(project, userSession)) {
          return res.status(404).send({ error: "Project Not Found" });
        }
        if (project.archived) {
          return res.status(400).send({ error: "Project is archived" });
        }
        note.projectId = req.body.projectId;
      }
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
      const userSession = await AuthGetUserSession(req);
      const note = await getVisibleNote(req.params.id, userSession);
      if (!note) return res.status(404).send({ error: "Note Not Found" });
      const project = await ProjectsDataGet(note.projectId);
      if (!hasProjectPermission(project, userSession, "all")) {
        return res.status(403).send({ error: permissionDeniedMessage("all") });
      }
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
      const note = await getVisibleNote(req.params.id, userSession);
      if (!note) return res.status(404).send({ error: "Note Not Found" });
      const guard = await projectMutationError(
        note.projectId,
        userSession,
        "comment",
      );
      if (guard) {
        return res.status(guard.status).send({ error: guard.error });
      }
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
        const userSession = await AuthGetUserSession(req);
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const note = await getVisibleNote(req.params.id, userSession);
        if (!note) return res.status(404).send({ error: "Note Not Found" });
        const guard = await projectMutationError(
          note.projectId,
          userSession,
          "comment",
        );
        if (guard) {
          return res.status(guard.status).send({ error: guard.error });
        }
        const comment = await getNoteComment(req.params.commentId, req.params.id);
        if (!comment)
          return res.status(404).send({ error: "Comment Not Found" });
        if (comment.userId !== userSession.userId && userSession.role !== "admin") {
          return res.status(403).send({ error: "Access Denied" });
        }
        await deleteNoteComment(req.params.commentId);
        return res.status(201).send({});
      },
    );

    interface PutNoteComment extends RequestGenericInterface {
      Params: { id: string; commentId: string };
      Body: { text: string };
    }
    fastify.put<PutNoteComment>("/:id/comments/:commentId", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const note = await getVisibleNote(req.params.id, userSession);
      if (!note) return res.status(404).send({ error: "Note Not Found" });
      const guard = await projectMutationError(
        note.projectId,
        userSession,
        "comment",
      );
      if (guard) {
        return res.status(guard.status).send({ error: guard.error });
      }
      const comment = await getNoteComment(req.params.commentId, req.params.id);
      if (!comment)
        return res.status(404).send({ error: "Comment Not Found" });
      if (comment.userId !== userSession.userId && userSession.role !== "admin") {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.text)
        return res.status(400).send({ error: "Missing: text" });
      await updateNoteComment(req.params.commentId, req.body.text);
      const updated = await getNoteComment(req.params.commentId, req.params.id);
      return res.status(200).send(updated);
    });

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
      const userSession = await AuthGetUserSession(req);
      const note = await getVisibleNote(req.params.id, userSession);
      if (!note) return res.status(404).send({ error: "Note Not Found" });
      const guard = await projectMutationError(
        note.projectId,
        userSession,
        "update",
      );
      if (guard) {
        return res.status(guard.status).send({ error: guard.error });
      }
      let labels: string[];
      try {
        labels = validateLabelList(req.body?.labels);
      } catch (error) {
        return res.status(400).send({ error: (error as Error).message });
      }
      await replaceNoteLabels(req.params.id, labels);
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
        const note = await getVisibleNote(req.params.id, userSession);
        if (!note) {
          return res.status(404).send({ error: "Note Not Found" });
        }
        const guard = await projectMutationError(
          note.projectId,
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
        const attachmentDir = path.join(uploadDir, "attachments", "notes");
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

        await addNoteAttachment(
          req.params.id,
          data.filename,
          filePath,
          attachmentId,
        );

        return res.status(201).send({
          id: attachmentId,
          fileName: data.filename,
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
      const attachment = await getNoteAttachment(req.params.attachmentId);
      if (!attachment) {
        return res.status(404).send({ error: "Attachment Not Found" });
      }
      if (attachment.noteId !== req.params.id) {
        return res.status(404).send({ error: "Attachment Not Found" });
      }
      if (!(await getVisibleNote(attachment.noteId, userSession))) {
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
        };
        res.type(mimeTypes[ext] || "application/octet-stream");
        res.header(
          "Content-Disposition",
          buildContentDisposition("inline", attachment.fileName),
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
          buildContentDisposition("attachment", attachment.fileName),
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
        const attachment = await getNoteAttachment(req.params.attachmentId);
        if (!attachment) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        if (attachment.noteId !== req.params.id) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        const visibleNote = await getVisibleNote(attachment.noteId, userSession);
        if (!visibleNote) {
          return res.status(404).send({ error: "Attachment Not Found" });
        }
        const guard = await projectMutationError(
          visibleNote.projectId,
          userSession,
          "update",
        );
        if (guard) {
          return res.status(guard.status).send({ error: guard.error });
        }
        if (await fs.pathExists(attachment.filePath)) {
          await fs.remove(attachment.filePath);
        }
        await deleteNoteAttachment(req.params.attachmentId);
        return res.status(201).send({});
      },
    );
  }
}
