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
  const project = Project.fromJson(rows[0]);
  project.userAccess = await getProjectUsers(project.id);
  return project;
}

export async function ProjectsDataList(userId?: string): Promise<Project[]> {
  let rows: Record<string, unknown>[];
  if (userId) {
    rows = await DbUtilsQuerySQL(
      SQL_QUERIES.LIST_VISIBLE_PROJECTS[DbUtilsGetType()],
      [userId],
    );
  } else {
    rows = await DbUtilsQuerySQL(SQL_QUERIES.LIST_PROJECTS[DbUtilsGetType()]);
  }
  const projects: Project[] = [];
  for (const row of rows) {
    const project = Project.fromJson(row);
    project.userAccess = await getProjectUsers(project.id);
    projects.push(project);
  }
  return projects;
}

export async function ProjectsDataAdd(project: Project): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_PROJECT[DbUtilsGetType()], [
    project.id,
    project.name,
    project.description,
    project.isDefault ? 1 : 0,
    project.visibility,
    JSON.stringify(project.statuses),
    project.dateCreated,
  ]);
  for (const userId of project.userAccess) {
    await addProjectUser(project.id, userId);
  }
}

export async function ProjectsDataUpdate(project: Project): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.UPDATE_PROJECT[DbUtilsGetType()], [
    project.name,
    project.description,
    project.isDefault ? 1 : 0,
    project.visibility,
    JSON.stringify(project.statuses),
    project.id,
  ]);
}

// ==================== PROJECT USERS ====================

export async function getProjectUsers(projectId: string): Promise<string[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_PROJECT_USERS[DbUtilsGetType()],
    [projectId],
  );
  return rows.map((r) => r.userId as string);
}

export async function addProjectUser(
  projectId: string,
  userId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_PROJECT_USER[DbUtilsGetType()], [
    projectId,
    userId,
  ]);
}

export async function removeProjectUser(
  projectId: string,
  userId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_PROJECT_USER[DbUtilsGetType()], [
    projectId,
    userId,
  ]);
}

export async function clearProjectUsers(projectId: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_PROJECT_USERS[DbUtilsGetType()], [
    projectId,
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
      'INSERT INTO projects ("id", "name", "description", "isDefault", "visibility", "statuses", "dateCreated") VALUES ($1, $2, $3, $4, $5, $6, $7)',
    sqlite:
      "INSERT INTO projects (id, name, description, isDefault, visibility, statuses, dateCreated) VALUES (?, ?, ?, ?, ?, ?, ?)",
  },
  UPDATE_PROJECT: {
    postgres:
      'UPDATE projects SET "name" = $1, "description" = $2, "isDefault" = $3, "visibility" = $4, "statuses" = $5 WHERE "id" = $6',
    sqlite:
      "UPDATE projects SET name = ?, description = ?, isDefault = ?, visibility = ?, statuses = ? WHERE id = ?",
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
  LIST_VISIBLE_PROJECTS: {
    postgres: `SELECT * FROM projects WHERE "visibility" = 'public' OR "id" IN (SELECT "projectId" FROM project_users WHERE "userId" = $1) ORDER BY name`,
    sqlite:
      "SELECT * FROM projects WHERE visibility = 'public' OR id IN (SELECT projectId FROM project_users WHERE userId = ?) ORDER BY name",
  },
  INSERT_PROJECT_USER: {
    postgres:
      'INSERT INTO project_users ("projectId", "userId") VALUES ($1, $2)',
    sqlite: "INSERT INTO project_users (projectId, userId) VALUES (?, ?)",
  },
  DELETE_PROJECT_USER: {
    postgres:
      'DELETE FROM project_users WHERE "projectId" = $1 AND "userId" = $2',
    sqlite: "DELETE FROM project_users WHERE projectId = ? AND userId = ?",
  },
  DELETE_PROJECT_USERS: {
    postgres: 'DELETE FROM project_users WHERE "projectId" = $1',
    sqlite: "DELETE FROM project_users WHERE projectId = ?",
  },
  GET_PROJECT_USERS: {
    postgres: 'SELECT "userId" FROM project_users WHERE "projectId" = $1',
    sqlite: "SELECT userId FROM project_users WHERE projectId = ?",
  },
};
