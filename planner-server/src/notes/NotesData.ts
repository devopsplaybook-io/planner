import { Note, NoteComment } from "../model/Note";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
} from "../utils/DbUtils";

export async function NotesDataGet(id: string): Promise<Note> {
  const rows = await DbUtilsQuerySQL(SQL_QUERIES.GET_NOTE[DbUtilsGetType()], [
    id,
  ]);
  if (rows.length === 0) {
    return null;
  }
  return enrichNote(rows[0]);
}

export async function NotesDataList(projectId?: string): Promise<Note[]> {
  let rows: Record<string, unknown>[];
  if (projectId) {
    rows = await DbUtilsQuerySQL(
      SQL_QUERIES.LIST_NOTES_BY_PROJECT[DbUtilsGetType()],
      [projectId],
    );
  } else {
    rows = await DbUtilsQuerySQL(SQL_QUERIES.LIST_NOTES[DbUtilsGetType()]);
  }
  const notes: Note[] = [];
  for (const row of rows) {
    notes.push(await enrichNote(row));
  }
  return notes;
}

export async function NotesDataAdd(note: Note): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_NOTE[DbUtilsGetType()], [
    note.id,
    note.projectId,
    note.title,
    note.description,
    note.dateCreated,
    note.dateUpdated,
  ]);
}

export async function NotesDataUpdate(note: Note): Promise<void> {
  note.dateUpdated = new Date().toISOString();
  await DbUtilsExecSQL(SQL_QUERIES.UPDATE_NOTE[DbUtilsGetType()], [
    note.title,
    note.description,
    note.dateUpdated,
    note.id,
  ]);
}

export async function NotesDataDelete(id: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_LABELS[DbUtilsGetType()], [id]);
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_COMMENTS[DbUtilsGetType()], [
    id,
  ]);
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_ATTACHMENTS[DbUtilsGetType()], [
    id,
  ]);
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE[DbUtilsGetType()], [id]);
}

// ==================== COMMENTS ====================

export async function addNoteComment(
  noteId: string,
  comment: NoteComment,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_NOTE_COMMENT[DbUtilsGetType()], [
    comment.id,
    noteId,
    comment.userId,
    comment.text,
    comment.dateCreated,
  ]);
}

export async function deleteNoteComment(commentId: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_COMMENT[DbUtilsGetType()], [
    commentId,
  ]);
}

// ==================== LABELS ====================

export async function addNoteLabel(
  noteId: string,
  name: string,
): Promise<void> {
  const { v4: uuidv4 } = await import("uuid");
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_NOTE_LABEL[DbUtilsGetType()], [
    uuidv4(),
    noteId,
    name,
  ]);
}

export async function clearNoteLabels(noteId: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_LABELS[DbUtilsGetType()], [
    noteId,
  ]);
}

// ==================== ATTACHMENTS ====================

export async function addNoteAttachment(
  noteId: string,
  fileName: string,
  filePath: string,
): Promise<string> {
  const { v4: uuidv4 } = await import("uuid");
  const id = uuidv4();
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_NOTE_ATTACHMENT[DbUtilsGetType()], [
    id,
    noteId,
    fileName,
    filePath,
    new Date().toISOString(),
  ]);
  return id;
}

export async function deleteNoteAttachment(
  attachmentId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_ATTACHMENT[DbUtilsGetType()], [
    attachmentId,
  ]);
}

export async function getNoteAttachment(
  attachmentId: string,
): Promise<{
  id: string;
  noteId: string;
  fileName: string;
  filePath: string;
  dateCreated: string;
} | null> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_NOTE_ATTACHMENT_BY_ID[DbUtilsGetType()],
    [attachmentId],
  );
  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    noteId: rows[0].noteId,
    fileName: rows[0].fileName,
    filePath: rows[0].filePath,
    dateCreated: rows[0].dateCreated,
  };
}

// ==================== HELPERS ====================

async function enrichNote(row: Record<string, unknown>): Promise<Note> {
  const note = Note.fromJson(row);
  note.comments = await getNoteComments(note.id);
  note.attachments = await getNoteAttachments(note.id);
  note.labels = await getNoteLabels(note.id);
  return note;
}

async function getNoteComments(noteId: string): Promise<NoteComment[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_NOTE_COMMENTS[DbUtilsGetType()],
    [noteId],
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    text: r.text,
    dateCreated: r.dateCreated,
  }));
}

async function getNoteAttachments(
  noteId: string,
): Promise<
  { id: string; fileName: string; filePath: string; dateCreated: string }[]
> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_NOTE_ATTACHMENTS[DbUtilsGetType()],
    [noteId],
  );
  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    filePath: r.filePath,
    dateCreated: r.dateCreated,
  }));
}

async function getNoteLabels(noteId: string): Promise<string[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_NOTE_LABELS[DbUtilsGetType()],
    [noteId],
  );
  return rows.map((r) => r.name as string);
}

// ==================== SQL ====================

const SQL_QUERIES = {
  GET_NOTE: {
    postgres: 'SELECT * FROM notes WHERE "id" = $1',
    sqlite: "SELECT * FROM notes WHERE id = ?",
  },
  LIST_NOTES: {
    postgres: "SELECT * FROM notes ORDER BY dateCreated DESC",
    sqlite: "SELECT * FROM notes ORDER BY dateCreated DESC",
  },
  LIST_NOTES_BY_PROJECT: {
    postgres:
      'SELECT * FROM notes WHERE "projectId" = $1 ORDER BY dateCreated DESC',
    sqlite: "SELECT * FROM notes WHERE projectId = ? ORDER BY dateCreated DESC",
  },
  INSERT_NOTE: {
    postgres:
      'INSERT INTO notes ("id", "projectId", "title", "description", "dateCreated", "dateUpdated") VALUES ($1, $2, $3, $4, $5, $6)',
    sqlite:
      "INSERT INTO notes (id, projectId, title, description, dateCreated, dateUpdated) VALUES (?, ?, ?, ?, ?, ?)",
  },
  UPDATE_NOTE: {
    postgres:
      'UPDATE notes SET "title" = $1, "description" = $2, "dateUpdated" = $3 WHERE "id" = $4',
    sqlite:
      "UPDATE notes SET title = ?, description = ?, dateUpdated = ? WHERE id = ?",
  },
  DELETE_NOTE: {
    postgres: 'DELETE FROM notes WHERE "id" = $1',
    sqlite: "DELETE FROM notes WHERE id = ?",
  },
  DELETE_NOTE_LABELS: {
    postgres: 'DELETE FROM note_labels WHERE "noteId" = $1',
    sqlite: "DELETE FROM note_labels WHERE noteId = ?",
  },
  DELETE_NOTE_COMMENTS: {
    postgres: 'DELETE FROM note_comments WHERE "noteId" = $1',
    sqlite: "DELETE FROM note_comments WHERE noteId = ?",
  },
  DELETE_NOTE_ATTACHMENTS: {
    postgres: 'DELETE FROM note_attachments WHERE "noteId" = $1',
    sqlite: "DELETE FROM note_attachments WHERE noteId = ?",
  },
  INSERT_NOTE_COMMENT: {
    postgres:
      'INSERT INTO note_comments ("id", "noteId", "userId", "text", "dateCreated") VALUES ($1, $2, $3, $4, $5)',
    sqlite:
      "INSERT INTO note_comments (id, noteId, userId, text, dateCreated) VALUES (?, ?, ?, ?, ?)",
  },
  DELETE_NOTE_COMMENT: {
    postgres: 'DELETE FROM note_comments WHERE "id" = $1',
    sqlite: "DELETE FROM note_comments WHERE id = ?",
  },
  GET_NOTE_COMMENTS: {
    postgres:
      'SELECT * FROM note_comments WHERE "noteId" = $1 ORDER BY dateCreated',
    sqlite: "SELECT * FROM note_comments WHERE noteId = ? ORDER BY dateCreated",
  },
  GET_NOTE_ATTACHMENTS: {
    postgres: 'SELECT * FROM note_attachments WHERE "noteId" = $1',
    sqlite: "SELECT * FROM note_attachments WHERE noteId = ?",
  },
  INSERT_NOTE_ATTACHMENT: {
    postgres:
      'INSERT INTO note_attachments ("id", "noteId", "fileName", "filePath", "dateCreated") VALUES ($1, $2, $3, $4, $5)',
    sqlite:
      "INSERT INTO note_attachments (id, noteId, fileName, filePath, dateCreated) VALUES (?, ?, ?, ?, ?)",
  },
  DELETE_NOTE_ATTACHMENT: {
    postgres: 'DELETE FROM note_attachments WHERE "id" = $1',
    sqlite: "DELETE FROM note_attachments WHERE id = ?",
  },
  GET_NOTE_ATTACHMENT_BY_ID: {
    postgres: 'SELECT * FROM note_attachments WHERE "id" = $1',
    sqlite: "SELECT * FROM note_attachments WHERE id = ?",
  },
  INSERT_NOTE_LABEL: {
    postgres:
      'INSERT INTO note_labels ("id", "noteId", "name") VALUES ($1, $2, $3)',
    sqlite: "INSERT INTO note_labels (id, noteId, name) VALUES (?, ?, ?)",
  },
  GET_NOTE_LABELS: {
    postgres: 'SELECT * FROM note_labels WHERE "noteId" = $1',
    sqlite: "SELECT * FROM note_labels WHERE noteId = ?",
  },
};
