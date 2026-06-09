import { Task, TaskComment, ChecklistItem } from "../model/Task";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
} from "../utils/DbUtils";

export async function TasksDataGet(id: string): Promise<Task> {
  const rows = await DbUtilsQuerySQL(SQL_QUERIES.GET_TASK[DbUtilsGetType()], [
    id,
  ]);
  if (rows.length === 0) {
    return null;
  }
  return enrichTask(rows[0]);
}

export async function TasksDataList(projectId?: string): Promise<Task[]> {
  let rows: Record<string, unknown>[];
  if (projectId) {
    rows = await DbUtilsQuerySQL(
      SQL_QUERIES.LIST_TASKS_BY_PROJECT[DbUtilsGetType()],
      [projectId],
    );
  } else {
    rows = await DbUtilsQuerySQL(SQL_QUERIES.LIST_TASKS[DbUtilsGetType()]);
  }
  const tasks: Task[] = [];
  for (const row of rows) {
    tasks.push(await enrichTask(row));
  }
  return tasks;
}

export async function TasksDataAdd(task: Task): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_TASK[DbUtilsGetType()], [
    task.id,
    task.projectId,
    task.title,
    task.description,
    task.status,
    task.priority,
    task.dueDate || null,
    JSON.stringify(task.checklist),
    task.dateCreated,
    task.dateUpdated,
  ]);
  for (const assignee of task.assignees) {
    await addAssignee(task.id, assignee.userId);
  }
  for (const label of task.labels) {
    await addLabel(task.id, label);
  }
}

export async function TasksDataUpdate(task: Task): Promise<void> {
  task.dateUpdated = new Date().toISOString();
  await DbUtilsExecSQL(SQL_QUERIES.UPDATE_TASK[DbUtilsGetType()], [
    task.title,
    task.description,
    task.status,
    task.priority,
    task.dueDate || null,
    JSON.stringify(task.checklist),
    task.dateUpdated,
    task.id,
  ]);
}

export async function TasksDataDelete(id: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK_LABELS[DbUtilsGetType()], [id]);
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK_ASSIGNEES[DbUtilsGetType()], [
    id,
  ]);
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK_COMMENTS[DbUtilsGetType()], [
    id,
  ]);
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK_ATTACHMENTS[DbUtilsGetType()], [
    id,
  ]);
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK[DbUtilsGetType()], [id]);
}

// ==================== ASSIGNEES ====================

export async function addAssignee(
  taskId: string,
  userId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_ASSIGNEE[DbUtilsGetType()], [
    taskId,
    userId,
  ]);
}

export async function removeAssignee(
  taskId: string,
  userId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_ASSIGNEE[DbUtilsGetType()], [
    taskId,
    userId,
  ]);
}

// ==================== COMMENTS ====================

export async function addComment(
  taskId: string,
  comment: TaskComment,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_COMMENT[DbUtilsGetType()], [
    comment.id,
    taskId,
    comment.userId,
    comment.text,
    comment.dateCreated,
  ]);
}

export async function deleteComment(commentId: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_COMMENT[DbUtilsGetType()], [
    commentId,
  ]);
}

// ==================== LABELS ====================

export async function addLabel(taskId: string, name: string): Promise<void> {
  const { v4: uuidv4 } = await import("uuid");
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_LABEL[DbUtilsGetType()], [
    uuidv4(),
    taskId,
    name,
  ]);
}

export async function clearLabels(taskId: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK_LABELS[DbUtilsGetType()], [
    taskId,
  ]);
}

// ==================== HELPERS ====================

async function enrichTask(row: Record<string, unknown>): Promise<Task> {
  const task = Task.fromJson(row);
  task.checklist =
    typeof row.checklist === "string"
      ? JSON.parse(row.checklist as string)
      : (row.checklist as ChecklistItem[]) || [];
  task.assignees = await getAssignees(task.id);
  task.comments = await getComments(task.id);
  task.attachments = await getAttachments(task.id);
  task.labels = await getLabels(task.id);
  return task;
}

async function getAssignees(
  taskId: string,
): Promise<{ userId: string; userName?: string }[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_ASSIGNEES[DbUtilsGetType()],
    [taskId],
  );
  return rows.map((r) => ({ userId: r.userId }));
}

async function getComments(taskId: string): Promise<TaskComment[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_COMMENTS[DbUtilsGetType()],
    [taskId],
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    text: r.text,
    dateCreated: r.dateCreated,
  }));
}

async function getAttachments(
  taskId: string,
): Promise<
  { id: string; fileName: string; filePath: string; dateCreated: string }[]
> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_ATTACHMENTS[DbUtilsGetType()],
    [taskId],
  );
  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    filePath: r.filePath,
    dateCreated: r.dateCreated,
  }));
}

async function getLabels(taskId: string): Promise<string[]> {
  const rows = await DbUtilsQuerySQL(SQL_QUERIES.GET_LABELS[DbUtilsGetType()], [
    taskId,
  ]);
  return rows.map((r) => r.name as string);
}

// ==================== SQL ====================

const SQL_QUERIES = {
  GET_TASK: {
    postgres: 'SELECT * FROM tasks WHERE "id" = $1',
    sqlite: "SELECT * FROM tasks WHERE id = ?",
  },
  LIST_TASKS: {
    postgres: "SELECT * FROM tasks ORDER BY dateCreated DESC",
    sqlite: "SELECT * FROM tasks ORDER BY dateCreated DESC",
  },
  LIST_TASKS_BY_PROJECT: {
    postgres:
      'SELECT * FROM tasks WHERE "projectId" = $1 ORDER BY dateCreated DESC',
    sqlite: "SELECT * FROM tasks WHERE projectId = ? ORDER BY dateCreated DESC",
  },
  INSERT_TASK: {
    postgres:
      'INSERT INTO tasks ("id", "projectId", "title", "description", "status", "priority", "dueDate", "checklist", "dateCreated", "dateUpdated") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    sqlite:
      "INSERT INTO tasks (id, projectId, title, description, status, priority, dueDate, checklist, dateCreated, dateUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  },
  UPDATE_TASK: {
    postgres:
      'UPDATE tasks SET "title" = $1, "description" = $2, "status" = $3, "priority" = $4, "dueDate" = $5, "checklist" = $6, "dateUpdated" = $7 WHERE "id" = $8',
    sqlite:
      "UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, dueDate = ?, checklist = ?, dateUpdated = ? WHERE id = ?",
  },
  DELETE_TASK: {
    postgres: 'DELETE FROM tasks WHERE "id" = $1',
    sqlite: "DELETE FROM tasks WHERE id = ?",
  },
  DELETE_TASK_LABELS: {
    postgres: 'DELETE FROM task_labels WHERE "taskId" = $1',
    sqlite: "DELETE FROM task_labels WHERE taskId = ?",
  },
  DELETE_TASK_ASSIGNEES: {
    postgres: 'DELETE FROM task_assignees WHERE "taskId" = $1',
    sqlite: "DELETE FROM task_assignees WHERE taskId = ?",
  },
  DELETE_TASK_COMMENTS: {
    postgres: 'DELETE FROM task_comments WHERE "taskId" = $1',
    sqlite: "DELETE FROM task_comments WHERE taskId = ?",
  },
  DELETE_TASK_ATTACHMENTS: {
    postgres: 'DELETE FROM task_attachments WHERE "taskId" = $1',
    sqlite: "DELETE FROM task_attachments WHERE taskId = ?",
  },
  INSERT_ASSIGNEE: {
    postgres: 'INSERT INTO task_assignees ("taskId", "userId") VALUES ($1, $2)',
    sqlite: "INSERT INTO task_assignees (taskId, userId) VALUES (?, ?)",
  },
  DELETE_ASSIGNEE: {
    postgres:
      'DELETE FROM task_assignees WHERE "taskId" = $1 AND "userId" = $2',
    sqlite: "DELETE FROM task_assignees WHERE taskId = ? AND userId = ?",
  },
  GET_ASSIGNEES: {
    postgres: 'SELECT * FROM task_assignees WHERE "taskId" = $1',
    sqlite: "SELECT * FROM task_assignees WHERE taskId = ?",
  },
  INSERT_COMMENT: {
    postgres:
      'INSERT INTO task_comments ("id", "taskId", "userId", "text", "dateCreated") VALUES ($1, $2, $3, $4, $5)',
    sqlite:
      "INSERT INTO task_comments (id, taskId, userId, text, dateCreated) VALUES (?, ?, ?, ?, ?)",
  },
  DELETE_COMMENT: {
    postgres: 'DELETE FROM task_comments WHERE "id" = $1',
    sqlite: "DELETE FROM task_comments WHERE id = ?",
  },
  GET_COMMENTS: {
    postgres:
      'SELECT * FROM task_comments WHERE "taskId" = $1 ORDER BY dateCreated',
    sqlite: "SELECT * FROM task_comments WHERE taskId = ? ORDER BY dateCreated",
  },
  GET_ATTACHMENTS: {
    postgres: 'SELECT * FROM task_attachments WHERE "taskId" = $1',
    sqlite: "SELECT * FROM task_attachments WHERE taskId = ?",
  },
  INSERT_LABEL: {
    postgres:
      'INSERT INTO task_labels ("id", "taskId", "name") VALUES ($1, $2, $3)',
    sqlite: "INSERT INTO task_labels (id, taskId, name) VALUES (?, ?, ?)",
  },
  GET_LABELS: {
    postgres: 'SELECT * FROM task_labels WHERE "taskId" = $1',
    sqlite: "SELECT * FROM task_labels WHERE taskId = ?",
  },
};
