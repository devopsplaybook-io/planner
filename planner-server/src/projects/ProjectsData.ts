import { Project } from "../model/Project";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
} from "../utils/DbUtils";

export async function ProjectsDataGet(id: string): Promise<Project> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_PROJECT[DbUtilsGetType()],
    [id],
  );
  if (rows.length === 0) {
    return null;
  }
  return Project.fromJson(rows[0]);
}

export async function ProjectsDataList(): Promise<Project[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.LIST_PROJECTS[DbUtilsGetType()],
  );
  return rows.map((r) => Project.fromJson(r));
}

export async function ProjectsDataAdd(project: Project): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_PROJECT[DbUtilsGetType()], [
    project.id,
    project.name,
    project.description,
    project.isDefault ? 1 : 0,
    JSON.stringify(project.statuses),
    project.dateCreated,
  ]);
}

export async function ProjectsDataUpdate(project: Project): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.UPDATE_PROJECT[DbUtilsGetType()], [
    project.name,
    project.description,
    project.isDefault ? 1 : 0,
    JSON.stringify(project.statuses),
    project.id,
  ]);
}

export async function ProjectsDataDelete(id: string): Promise<void> {
  // Delete related records first
  await DbUtilsExecSQL(
    SQL_QUERIES.DELETE_TASK_LABELS_BY_PROJECT[DbUtilsGetType()],
    [id],
  );
  await DbUtilsExecSQL(
    SQL_QUERIES.DELETE_TASK_ASSIGNEES_BY_PROJECT[DbUtilsGetType()],
    [id],
  );
  await DbUtilsExecSQL(
    SQL_QUERIES.DELETE_TASK_COMMENTS_BY_PROJECT[DbUtilsGetType()],
    [id],
  );
  await DbUtilsExecSQL(
    SQL_QUERIES.DELETE_TASK_ATTACHMENTS_BY_PROJECT[DbUtilsGetType()],
    [id],
  );
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASKS_BY_PROJECT[DbUtilsGetType()], [
    id,
  ]);
  await DbUtilsExecSQL(
    SQL_QUERIES.DELETE_NOTE_LABELS_BY_PROJECT[DbUtilsGetType()],
    [id],
  );
  await DbUtilsExecSQL(
    SQL_QUERIES.DELETE_NOTE_COMMENTS_BY_PROJECT[DbUtilsGetType()],
    [id],
  );
  await DbUtilsExecSQL(
    SQL_QUERIES.DELETE_NOTE_ATTACHMENTS_BY_PROJECT[DbUtilsGetType()],
    [id],
  );
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_NOTES_BY_PROJECT[DbUtilsGetType()], [
    id,
  ]);
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_PROJECT[DbUtilsGetType()], [id]);
}

const SQL_QUERIES = {
  GET_PROJECT: {
    postgres: 'SELECT * FROM projects WHERE "id" = $1',
    sqlite: "SELECT * FROM projects WHERE id = ?",
  },
  LIST_PROJECTS: {
    postgres: "SELECT * FROM projects ORDER BY name",
    sqlite: "SELECT * FROM projects ORDER BY name",
  },
  INSERT_PROJECT: {
    postgres:
      'INSERT INTO projects ("id", "name", "description", "isDefault", "statuses", "dateCreated") VALUES ($1, $2, $3, $4, $5, $6)',
    sqlite:
      "INSERT INTO projects (id, name, description, isDefault, statuses, dateCreated) VALUES (?, ?, ?, ?, ?, ?)",
  },
  UPDATE_PROJECT: {
    postgres:
      'UPDATE projects SET "name" = $1, "description" = $2, "isDefault" = $3, "statuses" = $4 WHERE "id" = $5',
    sqlite:
      "UPDATE projects SET name = ?, description = ?, isDefault = ?, statuses = ? WHERE id = ?",
  },
  DELETE_PROJECT: {
    postgres: 'DELETE FROM projects WHERE "id" = $1',
    sqlite: "DELETE FROM projects WHERE id = ?",
  },
  DELETE_TASKS_BY_PROJECT: {
    postgres: 'DELETE FROM tasks WHERE "projectId" = $1',
    sqlite: "DELETE FROM tasks WHERE projectId = ?",
  },
  DELETE_TASK_LABELS_BY_PROJECT: {
    postgres:
      'DELETE FROM task_labels WHERE "taskId" IN (SELECT "id" FROM tasks WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_labels WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)",
  },
  DELETE_TASK_ASSIGNEES_BY_PROJECT: {
    postgres:
      'DELETE FROM task_assignees WHERE "taskId" IN (SELECT "id" FROM tasks WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_assignees WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)",
  },
  DELETE_TASK_COMMENTS_BY_PROJECT: {
    postgres:
      'DELETE FROM task_comments WHERE "taskId" IN (SELECT "id" FROM tasks WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_comments WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)",
  },
  DELETE_TASK_ATTACHMENTS_BY_PROJECT: {
    postgres:
      'DELETE FROM task_attachments WHERE "taskId" IN (SELECT "id" FROM tasks WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_attachments WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)",
  },
  DELETE_NOTES_BY_PROJECT: {
    postgres: 'DELETE FROM notes WHERE "projectId" = $1',
    sqlite: "DELETE FROM notes WHERE projectId = ?",
  },
  DELETE_NOTE_LABELS_BY_PROJECT: {
    postgres:
      'DELETE FROM note_labels WHERE "noteId" IN (SELECT "id" FROM notes WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM note_labels WHERE noteId IN (SELECT id FROM notes WHERE projectId = ?)",
  },
  DELETE_NOTE_COMMENTS_BY_PROJECT: {
    postgres:
      'DELETE FROM note_comments WHERE "noteId" IN (SELECT "id" FROM notes WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM note_comments WHERE noteId IN (SELECT id FROM notes WHERE projectId = ?)",
  },
  DELETE_NOTE_ATTACHMENTS_BY_PROJECT: {
    postgres:
      'DELETE FROM note_attachments WHERE "noteId" IN (SELECT "id" FROM notes WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM note_attachments WHERE noteId IN (SELECT id FROM notes WHERE projectId = ?)",
  },
};
