import { Note, NoteComment } from "../model/Note";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
  DbUtilsTransaction,
} from "../utils/DbUtils";
import { visibleProjectsCondition } from "../projects/ProjectVisibility";
import { buildInPlaceholders } from "../tasks/TasksData";
import { removeFilesQuietly } from "../utils/FileUtils";

export async function NotesDataGet(id: string): Promise<Note> {
  const rows = await DbUtilsQuerySQL(SQL_QUERIES.GET_NOTE[DbUtilsGetType()], [
    id,
  ]);
  if (rows.length === 0) {
    return null;
  }
  const notes = await enrichNotes(rows);
  return notes[0];
}

export interface NoteListFilters {
  projectId?: string;
  /** Subtree filter: matches notes in any of these projects (IN). */
  projectIds?: string[];
  /** When set, restricts results to projects visible to this user (non-admin viewers). */
  visibleTo?: { userId: string };
}

/**
 * Builds the note list query for the given filters. Pure so it can be
 * unit-tested for both SQL dialects without a database. Placeholders use
 * SQLite "?" style — DbUtilsQuerySQL converts them to $n for postgres.
 */
export function buildListNotesQuery(
  filters: NoteListFilters,
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string; params: unknown[] } {
  const quote = (name: string) =>
    dbType === "postgres" ? `"${name}"` : name;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.projectId) {
    conditions.push(`${quote("projectId")} = ?`);
    params.push(filters.projectId);
  }
  if (filters.projectIds && filters.projectIds.length > 0) {
    const placeholders = filters.projectIds.map(() => "?").join(", ");
    conditions.push(`${quote("projectId")} IN (${placeholders})`);
    params.push(...filters.projectIds);
  }
  if (filters.visibleTo) {
    const visibility = visibleProjectsCondition(filters.visibleTo.userId, dbType);
    conditions.push(visibility.sql);
    params.push(...visibility.params);
  }
  const whereClause =
    conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  return {
    sql: `SELECT * FROM notes${whereClause} ORDER BY ${quote("dateCreated")} DESC`,
    params,
  };
}

export async function NotesDataList(
  filters: NoteListFilters = {},
): Promise<Note[]> {
  const { sql, params } = buildListNotesQuery(filters);
  const rows = await DbUtilsQuerySQL(sql, params);
  return enrichNotes(rows);
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
    note.projectId,
    note.id,
  ]);
}

/**
 * Deletes the note, its child rows (in one transaction) and the attachment
 * files on disk.
 */
export async function NotesDataDelete(id: string): Promise<void> {
  const attachments = await getAttachments([id]);
  await DbUtilsTransaction(async () => {
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_LABELS[DbUtilsGetType()], [
      id,
    ]);
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_COMMENTS[DbUtilsGetType()], [
      id,
    ]);
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_ATTACHMENTS[DbUtilsGetType()], [
      id,
    ]);
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE[DbUtilsGetType()], [id]);
  });
  await removeFilesQuietly(attachments.map((a) => a.filePath));
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

export async function getNoteComment(commentId: string): Promise<NoteComment | null> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_NOTE_COMMENT_BY_ID[DbUtilsGetType()],
    [commentId],
  );
  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    userId: rows[0].userId,
    userName: rows[0].userName as string | undefined,
    text: rows[0].text,
    dateCreated: rows[0].dateCreated,
    dateUpdated: rows[0].dateUpdated as string | undefined,
  };
}

export async function updateNoteComment(
  commentId: string,
  text: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.UPDATE_NOTE_COMMENT[DbUtilsGetType()], [
    text,
    new Date().toISOString(),
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

/**
 * Replaces the note labels atomically: the clear and the inserts run in one
 * transaction, so a failure cannot leave the note label-less.
 */
export async function replaceNoteLabels(
  noteId: string,
  labels: string[],
): Promise<void> {
  const { v4: uuidv4 } = await import("uuid");
  await DbUtilsTransaction(async () => {
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_LABELS[DbUtilsGetType()], [
      noteId,
    ]);
    for (const name of labels) {
      await DbUtilsExecSQL(SQL_QUERIES.INSERT_NOTE_LABEL[DbUtilsGetType()], [
        uuidv4(),
        noteId,
        name,
      ]);
    }
  });
}

// ==================== ATTACHMENTS ====================

export async function addNoteAttachment(
  noteId: string,
  fileName: string,
  filePath: string,
  id: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_NOTE_ATTACHMENT[DbUtilsGetType()], [
    id,
    noteId,
    fileName,
    filePath,
    new Date().toISOString(),
  ]);
}

export async function deleteNoteAttachment(
  attachmentId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTE_ATTACHMENT[DbUtilsGetType()], [
    attachmentId,
  ]);
}

export async function getNoteAttachment(attachmentId: string): Promise<{
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

/**
 * Hydrates a list of note rows with their children in a bounded number of
 * queries (one per child type, batched with IN (...)) instead of three
 * queries per note.
 */
async function enrichNotes(
  rows: Record<string, unknown>[],
): Promise<Note[]> {
  const notes = rows.map((row) => {
    const note = Note.fromJson(row);
    note.comments = [];
    note.attachments = [];
    note.labels = [];
    return note;
  });
  if (notes.length === 0) {
    return notes;
  }
  const dbType = DbUtilsGetType();
  const placeholders = buildInPlaceholders(notes.length);
  const ids = notes.map((n) => n.id);
  const byId = new Map(notes.map((n) => [n.id, n]));

  const [commentRows, attachmentRows, labelRows] = await Promise.all([
    DbUtilsQuerySQL(
      SQL_QUERIES.GET_NOTE_COMMENTS_BY_NOTE_IDS[dbType].replace(
        ":ids",
        placeholders,
      ),
      ids,
    ),
    DbUtilsQuerySQL(
      SQL_QUERIES.GET_NOTE_ATTACHMENTS_BY_NOTE_IDS[dbType].replace(
        ":ids",
        placeholders,
      ),
      ids,
    ),
    DbUtilsQuerySQL(
      SQL_QUERIES.GET_NOTE_LABELS_BY_NOTE_IDS[dbType].replace(
        ":ids",
        placeholders,
      ),
      ids,
    ),
  ]);

  for (const row of commentRows) {
    byId.get(row.noteId)?.comments.push({
      id: row.id,
      userId: row.userId,
      userName: row.userName as string | undefined,
      text: row.text,
      dateCreated: row.dateCreated,
      dateUpdated: row.dateUpdated as string | undefined,
    });
  }
  for (const row of attachmentRows) {
    byId.get(row.noteId)?.attachments.push({
      id: row.id,
      fileName: row.fileName,
      filePath: row.filePath,
      dateCreated: row.dateCreated,
    });
  }
  for (const row of labelRows) {
    byId.get(row.noteId)?.labels.push(row.name as string);
  }
  return notes;
}

async function getAttachments(
  noteIds: string[],
): Promise<{ filePath: string }[]> {
  if (noteIds.length === 0) {
    return [];
  }
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_NOTE_ATTACHMENTS_BY_NOTE_IDS[DbUtilsGetType()].replace(
      ":ids",
      buildInPlaceholders(noteIds.length),
    ),
    noteIds,
  );
  return rows.map((r) => ({ filePath: r.filePath }));
}

// ==================== SQL ====================

const SQL_QUERIES = {
  GET_NOTE: {
    postgres: 'SELECT * FROM notes WHERE "id" = $1',
    sqlite: "SELECT * FROM notes WHERE id = ?",
  },
  INSERT_NOTE: {
    postgres:
      'INSERT INTO notes ("id", "projectId", "title", "description", "dateCreated", "dateUpdated") VALUES ($1, $2, $3, $4, $5, $6)',
    sqlite:
      "INSERT INTO notes (id, projectId, title, description, dateCreated, dateUpdated) VALUES (?, ?, ?, ?, ?, ?)",
  },
  UPDATE_NOTE: {
    postgres:
      'UPDATE notes SET "title" = $1, "description" = $2, "dateUpdated" = $3, "projectId" = $4 WHERE "id" = $5',
    sqlite:
      "UPDATE notes SET title = ?, description = ?, dateUpdated = ?, projectId = ? WHERE id = ?",
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
  GET_NOTE_COMMENT_BY_ID: {
    postgres:
      'SELECT nc.*, u."name" AS "userName" FROM note_comments nc LEFT JOIN users u ON nc."userId" = u."id" WHERE nc."id" = $1',
    sqlite:
      "SELECT nc.*, u.name AS userName FROM note_comments nc LEFT JOIN users u ON nc.userId = u.id WHERE nc.id = ?",
  },
  UPDATE_NOTE_COMMENT: {
    postgres:
      'UPDATE note_comments SET "text" = $1, "dateUpdated" = $2 WHERE "id" = $3',
    sqlite:
      "UPDATE note_comments SET text = ?, dateUpdated = ? WHERE id = ?",
  },
  GET_NOTE_COMMENTS_BY_NOTE_IDS: {
    postgres:
      'SELECT nc.*, u."name" AS "userName" FROM note_comments nc LEFT JOIN users u ON nc."userId" = u."id" WHERE nc."noteId" IN (:ids) ORDER BY nc."dateCreated"',
    sqlite:
      "SELECT nc.*, u.name AS userName FROM note_comments nc LEFT JOIN users u ON nc.userId = u.id WHERE nc.noteId IN (:ids) ORDER BY nc.dateCreated",
  },
  GET_NOTE_ATTACHMENTS_BY_NOTE_IDS: {
    postgres: 'SELECT * FROM note_attachments WHERE "noteId" IN (:ids)',
    sqlite: "SELECT * FROM note_attachments WHERE noteId IN (:ids)",
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
  GET_NOTE_LABELS_BY_NOTE_IDS: {
    postgres: 'SELECT * FROM note_labels WHERE "noteId" IN (:ids)',
    sqlite: "SELECT * FROM note_labels WHERE noteId IN (:ids)",
  },
};
