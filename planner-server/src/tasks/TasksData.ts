import { Task, TaskComment, ChecklistItem } from "../model/Task";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
  DbUtilsTransaction,
} from "../utils/DbUtils";
import { visibleProjectsCondition } from "../projects/ProjectVisibility";
import { removeFilesQuietly } from "../utils/FileUtils";

export async function TasksDataGet(id: string): Promise<Task> {
  const rows = await DbUtilsQuerySQL(SQL_QUERIES.GET_TASK[DbUtilsGetType()], [
    id,
  ]);
  if (rows.length === 0) {
    return null;
  }
  const tasks = await enrichTasks(rows);
  return tasks[0];
}

export interface TaskListFilters {
  projectId?: string;
  /** Subtree filter: matches tasks in any of these projects (IN). */
  projectIds?: string[];
  doneSince?: string;
  /** Case-insensitive substring matched against title and description. */
  q?: string;
  /** When set, restricts results to projects visible to this user (non-admin viewers). */
  visibleTo?: { userId: string };
  /** Maximum number of rows returned (pagination). */
  limit?: number;
  offset?: number;
}

/**
 * Builds the task list query for the given filters. Pure so it can be
 * unit-tested for both SQL dialects without a database. Placeholders use
 * SQLite "?" style — DbUtilsQuerySQL converts them to $n for postgres.
 */
export function buildListTasksQuery(
  filters: TaskListFilters,
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
  if (filters.doneSince) {
    // Non-Done tasks always pass; Done tasks must have been updated since
    // the cutoff (dateUpdated is always populated by INSERT/UPDATE/TOUCH)
    conditions.push(
      `(${quote("status")} != ? OR ${quote("dateUpdated")} >= ?)`,
    );
    params.push("Done", filters.doneSince);
  }
  const term = filters.q?.trim();
  if (term) {
    // LIKE is case-insensitive for ASCII in sqlite; postgres needs ILIKE.
    // User-supplied wildcards and the escape character are neutralized so
    // they match literally.
    const like = dbType === "postgres" ? "ILIKE" : "LIKE";
    const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      `(${quote("title")} ${like} ? ESCAPE '\\' OR ${quote("description")} ${like} ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern);
  }
  if (filters.visibleTo) {
    const visibility = visibleProjectsCondition(filters.visibleTo.userId, dbType);
    conditions.push(visibility.sql);
    params.push(...visibility.params);
  }
  const whereClause =
    conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  let limitClause = "";
  if (typeof filters.limit === "number" && filters.limit > 0) {
    limitClause = ` LIMIT ?`;
    params.push(filters.limit);
    if (typeof filters.offset === "number" && filters.offset > 0) {
      limitClause += ` OFFSET ?`;
      params.push(filters.offset);
    }
  }
  return {
    sql: `SELECT * FROM tasks${whereClause} ORDER BY ${quote("dateCreated")} DESC${limitClause}`,
    params,
  };
}

export async function TasksDataList(
  filters: TaskListFilters = {},
): Promise<Task[]> {
  const { sql, params } = buildListTasksQuery(filters);
  const rows = await DbUtilsQuerySQL(sql, params);
  return enrichTasks(rows);
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
    task.projectId,
    task.id,
  ]);
}

/**
 * Bumps dateUpdated without changing the task fields. Called after
 * sub-resource mutations (comments, assignees, labels, attachments) so
 * clients polling for task changes see them too.
 */
export async function TasksDataTouch(taskId: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.TOUCH_TASK[DbUtilsGetType()], [
    new Date().toISOString(),
    taskId,
  ]);
}

/**
 * Deletes the task, its child rows (in one transaction) and the attachment
 * files on disk.
 */
export async function TasksDataDelete(id: string): Promise<void> {
  const attachments = await getAttachments([id]);
  await DbUtilsTransaction(async () => {
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK_LABELS[DbUtilsGetType()], [
      id,
    ]);
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK_ASSIGNEES[DbUtilsGetType()], [
      id,
    ]);
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK_COMMENTS[DbUtilsGetType()], [
      id,
    ]);
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TASK_ATTACHMENTS[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK[DbUtilsGetType()], [id]);
  });
  await removeFilesQuietly(attachments.map((a) => a.filePath));
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

export async function getComment(commentId: string): Promise<TaskComment | null> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_COMMENT_BY_ID[DbUtilsGetType()],
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

export async function updateComment(
  commentId: string,
  text: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.UPDATE_COMMENT[DbUtilsGetType()], [
    text,
    new Date().toISOString(),
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

/**
 * Replaces the task labels atomically: the clear and the inserts run in one
 * transaction, so a failure cannot leave the task label-less.
 */
export async function replaceLabels(
  taskId: string,
  labels: string[],
): Promise<void> {
  const { v4: uuidv4 } = await import("uuid");
  await DbUtilsTransaction(async () => {
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_TASK_LABELS[DbUtilsGetType()], [
      taskId,
    ]);
    for (const label of labels) {
      await DbUtilsExecSQL(SQL_QUERIES.INSERT_LABEL[DbUtilsGetType()], [
        uuidv4(),
        taskId,
        label,
      ]);
    }
  });
}

// ==================== ATTACHMENTS ====================

export async function addTaskAttachment(
  taskId: string,
  fileName: string,
  filePath: string,
  id: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_ATTACHMENT[DbUtilsGetType()], [
    id,
    taskId,
    fileName,
    filePath,
    new Date().toISOString(),
  ]);
}

export async function deleteTaskAttachment(
  attachmentId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_ATTACHMENT[DbUtilsGetType()], [
    attachmentId,
  ]);
}

export async function getTaskAttachment(attachmentId: string): Promise<{
  id: string;
  taskId: string;
  fileName: string;
  filePath: string;
  dateCreated: string;
} | null> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_ATTACHMENT_BY_ID[DbUtilsGetType()],
    [attachmentId],
  );
  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    taskId: rows[0].taskId,
    fileName: rows[0].fileName,
    filePath: rows[0].filePath,
    dateCreated: rows[0].dateCreated,
  };
}

// ==================== HELPERS ====================

/** IN (...) placeholder list for a batch of ids ("?" style). */
export function buildInPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * Hydrates a list of task rows with their children in a bounded number of
 * queries (one per child type, batched with IN (...)) instead of four
 * queries per task.
 */
async function enrichTasks(
  rows: Record<string, unknown>[],
): Promise<Task[]> {
  const tasks = rows.map((row) => {
    const task = Task.fromJson(row);
    task.checklist =
      typeof row.checklist === "string"
        ? JSON.parse(row.checklist as string)
        : (row.checklist as ChecklistItem[]) || [];
    task.assignees = [];
    task.comments = [];
    task.attachments = [];
    task.labels = [];
    return task;
  });
  if (tasks.length === 0) {
    return tasks;
  }
  const dbType = DbUtilsGetType();
  const placeholders = buildInPlaceholders(tasks.length);
  const ids = tasks.map((t) => t.id);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const [assigneeRows, commentRows, attachmentRows, labelRows] =
    await Promise.all([
      DbUtilsQuerySQL(
        SQL_QUERIES.GET_ASSIGNEES_BY_TASK_IDS[dbType].replace(
          ":ids",
          placeholders,
        ),
        ids,
      ),
      DbUtilsQuerySQL(
        SQL_QUERIES.GET_COMMENTS_BY_TASK_IDS[dbType].replace(
          ":ids",
          placeholders,
        ),
        ids,
      ),
      DbUtilsQuerySQL(
        SQL_QUERIES.GET_ATTACHMENTS_BY_TASK_IDS[dbType].replace(
          ":ids",
          placeholders,
        ),
        ids,
      ),
      DbUtilsQuerySQL(
        SQL_QUERIES.GET_LABELS_BY_TASK_IDS[dbType].replace(
          ":ids",
          placeholders,
        ),
        ids,
      ),
    ]);

  for (const row of assigneeRows) {
    byId.get(row.taskId)?.assignees.push({
      userId: row.userId,
      userName: row.userName as string | undefined,
    });
  }
  for (const row of commentRows) {
    byId.get(row.taskId)?.comments.push({
      id: row.id,
      userId: row.userId,
      userName: row.userName as string | undefined,
      text: row.text,
      dateCreated: row.dateCreated,
      dateUpdated: row.dateUpdated as string | undefined,
    });
  }
  for (const row of attachmentRows) {
    byId.get(row.taskId)?.attachments.push({
      id: row.id,
      fileName: row.fileName,
      filePath: row.filePath,
      dateCreated: row.dateCreated,
    });
  }
  for (const row of labelRows) {
    byId.get(row.taskId)?.labels.push(row.name as string);
  }
  return tasks;
}

async function getAttachments(
  taskIds: string[],
): Promise<{ filePath: string }[]> {
  if (taskIds.length === 0) {
    return [];
  }
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_ATTACHMENTS_BY_TASK_IDS[DbUtilsGetType()].replace(
      ":ids",
      buildInPlaceholders(taskIds.length),
    ),
    taskIds,
  );
  return rows.map((r) => ({ filePath: r.filePath }));
}

// ==================== SQL ====================

const SQL_QUERIES = {
  GET_TASK: {
    postgres: 'SELECT * FROM tasks WHERE "id" = $1',
    sqlite: "SELECT * FROM tasks WHERE id = ?",
  },
  INSERT_TASK: {
    postgres:
      'INSERT INTO tasks ("id", "projectId", "title", "description", "status", "priority", "dueDate", "checklist", "dateCreated", "dateUpdated") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    sqlite:
      "INSERT INTO tasks (id, projectId, title, description, status, priority, dueDate, checklist, dateCreated, dateUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  },
  UPDATE_TASK: {
    postgres:
      'UPDATE tasks SET "title" = $1, "description" = $2, "status" = $3, "priority" = $4, "dueDate" = $5, "checklist" = $6, "dateUpdated" = $7, "projectId" = $8 WHERE "id" = $9',
    sqlite:
      "UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, dueDate = ?, checklist = ?, dateUpdated = ?, projectId = ? WHERE id = ?",
  },
  TOUCH_TASK: {
    postgres: 'UPDATE tasks SET "dateUpdated" = $1 WHERE "id" = $2',
    sqlite: "UPDATE tasks SET dateUpdated = ? WHERE id = ?",
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
  GET_ASSIGNEES_BY_TASK_IDS: {
    postgres:
      'SELECT ta."taskId", ta."userId", u."name" AS "userName" FROM task_assignees ta LEFT JOIN users u ON ta."userId" = u."id" WHERE ta."taskId" IN (:ids)',
    sqlite:
      "SELECT ta.taskId, ta.userId, u.name AS userName FROM task_assignees ta LEFT JOIN users u ON ta.userId = u.id WHERE ta.taskId IN (:ids)",
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
  GET_COMMENT_BY_ID: {
    postgres:
      'SELECT tc.*, u."name" AS "userName" FROM task_comments tc LEFT JOIN users u ON tc."userId" = u."id" WHERE tc."id" = $1',
    sqlite:
      "SELECT tc.*, u.name AS userName FROM task_comments tc LEFT JOIN users u ON tc.userId = u.id WHERE tc.id = ?",
  },
  UPDATE_COMMENT: {
    postgres:
      'UPDATE task_comments SET "text" = $1, "dateUpdated" = $2 WHERE "id" = $3',
    sqlite:
      "UPDATE task_comments SET text = ?, dateUpdated = ? WHERE id = ?",
  },
  GET_COMMENTS_BY_TASK_IDS: {
    postgres:
      'SELECT tc.*, u."name" AS "userName" FROM task_comments tc LEFT JOIN users u ON tc."userId" = u."id" WHERE tc."taskId" IN (:ids) ORDER BY tc."dateCreated"',
    sqlite:
      "SELECT tc.*, u.name AS userName FROM task_comments tc LEFT JOIN users u ON tc.userId = u.id WHERE tc.taskId IN (:ids) ORDER BY tc.dateCreated",
  },
  GET_ATTACHMENTS_BY_TASK_IDS: {
    postgres: 'SELECT * FROM task_attachments WHERE "taskId" IN (:ids)',
    sqlite: "SELECT * FROM task_attachments WHERE taskId IN (:ids)",
  },
  INSERT_ATTACHMENT: {
    postgres:
      'INSERT INTO task_attachments ("id", "taskId", "fileName", "filePath", "dateCreated") VALUES ($1, $2, $3, $4, $5)',
    sqlite:
      "INSERT INTO task_attachments (id, taskId, fileName, filePath, dateCreated) VALUES (?, ?, ?, ?, ?)",
  },
  DELETE_ATTACHMENT: {
    postgres: 'DELETE FROM task_attachments WHERE "id" = $1',
    sqlite: "DELETE FROM task_attachments WHERE id = ?",
  },
  GET_ATTACHMENT_BY_ID: {
    postgres: 'SELECT * FROM task_attachments WHERE "id" = $1',
    sqlite: "SELECT * FROM task_attachments WHERE id = ?",
  },
  INSERT_LABEL: {
    postgres:
      'INSERT INTO task_labels ("id", "taskId", "name") VALUES ($1, $2, $3)',
    sqlite: "INSERT INTO task_labels (id, taskId, name) VALUES (?, ?, ?)",
  },
  GET_LABELS_BY_TASK_IDS: {
    postgres: 'SELECT * FROM task_labels WHERE "taskId" IN (:ids)',
    sqlite: "SELECT * FROM task_labels WHERE taskId IN (:ids)",
  },
};
