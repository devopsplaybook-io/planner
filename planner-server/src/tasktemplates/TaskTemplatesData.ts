import { TaskTemplate, TaskTemplateComment } from "../model/TaskTemplate";
import { ChecklistItem } from "../model/Task";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
  DbUtilsTransaction,
} from "../utils/DbUtils";
import { visibleProjectsCondition } from "../projects/ProjectVisibility";
import { buildInPlaceholders } from "../tasks/TasksData";
import { removeFilesQuietly } from "../utils/FileUtils";

export async function TaskTemplatesGet(id: string): Promise<TaskTemplate> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_TEMPLATE[DbUtilsGetType()],
    [id],
  );
  if (rows.length === 0) {
    return null;
  }
  const enriched = await enrichTemplates(rows);
  return enriched[0];
}

export interface TaskTemplateListFilters {
  projectId?: string;
  /** Subtree filter: matches templates in any of these projects (IN). */
  projectIds?: string[];
  /** Case-insensitive substring matched against title and description. */
  q?: string;
  /** When set, restricts results to projects visible to this user (non-admin viewers). */
  visibleTo?: { userId: string };
}

/**
 * Builds the template list query for the given filters. Pure so it can be
 * unit-tested for both SQL dialects without a database. Placeholders use
 * SQLite "?" style — DbUtilsQuerySQL converts them to $n for postgres.
 */
export function buildListTemplatesQuery(
  filters: TaskTemplateListFilters,
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
  const whereClause =
    conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  return {
    sql: `SELECT * FROM task_templates${whereClause} ORDER BY ${quote("dateCreated")} DESC`,
    params,
  };
}

export async function TaskTemplatesList(
  filters: TaskTemplateListFilters = {},
): Promise<TaskTemplate[]> {
  const { sql, params } = buildListTemplatesQuery(filters);
  const rows = await DbUtilsQuerySQL(sql, params);
  return enrichTemplates(rows);
}

export async function TaskTemplatesAdd(template: TaskTemplate): Promise<void> {
  await DbUtilsTransaction(async () => {
    await DbUtilsExecSQL(SQL_QUERIES.INSERT_TEMPLATE[DbUtilsGetType()], [
      template.id,
      template.projectId,
      template.title,
      template.description,
      template.priority,
      JSON.stringify(template.checklist),
      template.scheduleCron || null,
      template.skipIfPreviousNotDone ? 1 : 0,
      template.addDateToTitle ? 1 : 0,
      template.instanceStatus || null,
      template.dateCreated,
      template.dateUpdated,
    ]);
    for (const assignee of template.assignees) {
      await addTemplateAssignee(template.id, assignee.userId);
    }
    for (const label of template.labels) {
      await addTemplateLabel(template.id, label);
    }
  });
}

export async function TaskTemplatesUpdate(
  template: TaskTemplate,
): Promise<void> {
  template.dateUpdated = new Date().toISOString();
  await DbUtilsExecSQL(SQL_QUERIES.UPDATE_TEMPLATE[DbUtilsGetType()], [
    template.title,
    template.description,
    template.priority,
    JSON.stringify(template.checklist),
    template.scheduleCron || null,
    template.skipIfPreviousNotDone ? 1 : 0,
    template.addDateToTitle ? 1 : 0,
    template.instanceStatus || null,
    template.projectId,
    template.dateUpdated,
    template.id,
  ]);
}

export async function TaskTemplatesDelete(id: string): Promise<void> {
  const attachments = await getAttachments([id]);
  await DbUtilsTransaction(async () => {
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_LABELS[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_ASSIGNEES[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_COMMENTS[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_ATTACHMENTS[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_TEMPLATE_RUNS[DbUtilsGetType()], [
      id,
    ]);
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_TEMPLATE[DbUtilsGetType()], [id]);
  });
  await removeFilesQuietly(attachments.map((a) => a.filePath));
}

/** Ids of the templates of a project (used to stop scheduler jobs). */
export async function TaskTemplatesListIdsByProject(
  projectId: string,
): Promise<string[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_TEMPLATE_IDS_BY_PROJECT[DbUtilsGetType()],
    [projectId],
  );
  return rows.map((r) => r.id as string);
}

// ==================== ASSIGNEES ====================

export async function addTemplateAssignee(
  templateId: string,
  userId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_ASSIGNEE[DbUtilsGetType()], [
    templateId,
    userId,
  ]);
}

/**
 * Replaces the template assignees atomically: the clear and the inserts run
 * in one transaction, so a failure cannot leave the template half-assigned.
 */
export async function replaceTemplateAssignees(
  templateId: string,
  userIds: string[],
): Promise<void> {
  await DbUtilsTransaction(async () => {
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_ASSIGNEES[DbUtilsGetType()],
      [templateId],
    );
    for (const userId of userIds) {
      await DbUtilsExecSQL(SQL_QUERIES.INSERT_ASSIGNEE[DbUtilsGetType()], [
        templateId,
        userId,
      ]);
    }
  });
}

// ==================== COMMENTS ====================

export async function addTemplateComment(
  templateId: string,
  comment: TaskTemplateComment,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_COMMENT[DbUtilsGetType()], [
    comment.id,
    templateId,
    comment.userId,
    comment.text,
    comment.dateCreated,
  ]);
}

export async function deleteTemplateComment(commentId: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_COMMENT[DbUtilsGetType()], [
    commentId,
  ]);
}

export async function getTemplateComment(
  commentId: string,
): Promise<TaskTemplateComment | null> {
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

export async function updateTemplateComment(
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

export async function addTemplateLabel(
  templateId: string,
  name: string,
): Promise<void> {
  const { v4: uuidv4 } = await import("uuid");
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_LABEL[DbUtilsGetType()], [
    uuidv4(),
    templateId,
    name,
  ]);
}

/**
 * Replaces the template labels atomically: the clear and the inserts run in
 * one transaction, so a failure cannot leave the template label-less.
 */
export async function replaceTemplateLabels(
  templateId: string,
  labels: string[],
): Promise<void> {
  const { v4: uuidv4 } = await import("uuid");
  await DbUtilsTransaction(async () => {
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_LABELS[DbUtilsGetType()],
      [templateId],
    );
    for (const label of labels) {
      await DbUtilsExecSQL(SQL_QUERIES.INSERT_LABEL[DbUtilsGetType()], [
        uuidv4(),
        templateId,
        label,
      ]);
    }
  });
}

// ==================== ATTACHMENTS ====================

export async function addTemplateAttachment(
  templateId: string,
  fileName: string,
  filePath: string,
  id: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_ATTACHMENT[DbUtilsGetType()], [
    id,
    templateId,
    fileName,
    filePath,
    new Date().toISOString(),
  ]);
}

export async function deleteTemplateAttachment(
  attachmentId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_ATTACHMENT[DbUtilsGetType()], [
    attachmentId,
  ]);
}

export async function getTemplateAttachment(attachmentId: string): Promise<{
  id: string;
  templateId: string;
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
    templateId: rows[0].templateId,
    fileName: rows[0].fileName,
    filePath: rows[0].filePath,
    dateCreated: rows[0].dateCreated,
  };
}

// ==================== RUNS ====================

/** Records one instance creation (scheduled or manual) for the template. */
export async function TaskTemplateRunsAdd(
  templateId: string,
  taskId: string,
): Promise<void> {
  const { v4: uuidv4 } = await import("uuid");
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_RUN[DbUtilsGetType()], [
    uuidv4(),
    templateId,
    taskId,
    new Date().toISOString(),
  ]);
}

/**
 * The most recent run of a template, with the task's current status joined
 * so the scheduler can apply "skip if the previous instance is still open".
 * The run row survives task deletion (no FK on taskId), in which case
 * taskStatus is null and the next tick must create.
 */
export async function TaskTemplateRunsGetLast(
  templateId: string,
): Promise<{ taskId: string; taskStatus: string | null; dateCreated: string } | null> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_LAST_RUN[DbUtilsGetType()],
    [templateId],
  );
  if (rows.length === 0) {
    return null;
  }
  return {
    taskId: rows[0].taskId,
    taskStatus: (rows[0].taskStatus as string | null) ?? null,
    dateCreated: rows[0].dateCreated,
  };
}

// ==================== HELPERS ====================

/**
 * Hydrates a list of template rows with their children in a bounded number
 * of queries (one per child type, batched with IN (...)) instead of four
 * queries per template.
 */
async function enrichTemplates(
  rows: Record<string, unknown>[],
): Promise<TaskTemplate[]> {
  const templates = rows.map((row) => {
    const template = TaskTemplate.fromJson(row);
    template.checklist =
      typeof row.checklist === "string"
        ? JSON.parse(row.checklist as string)
        : (row.checklist as ChecklistItem[]) || [];
    template.assignees = [];
    template.comments = [];
    template.attachments = [];
    template.labels = [];
    return template;
  });
  if (templates.length === 0) {
    return templates;
  }
  const dbType = DbUtilsGetType();
  const placeholders = buildInPlaceholders(templates.length);
  const ids = templates.map((t) => t.id);
  const byId = new Map(templates.map((t) => [t.id, t]));

  const [assigneeRows, commentRows, attachmentRows, labelRows] =
    await Promise.all([
      DbUtilsQuerySQL(
        SQL_QUERIES.GET_ASSIGNEES_BY_TEMPLATE_IDS[dbType].replace(
          ":ids",
          placeholders,
        ),
        ids,
      ),
      DbUtilsQuerySQL(
        SQL_QUERIES.GET_COMMENTS_BY_TEMPLATE_IDS[dbType].replace(
          ":ids",
          placeholders,
        ),
        ids,
      ),
      DbUtilsQuerySQL(
        SQL_QUERIES.GET_ATTACHMENTS_BY_TEMPLATE_IDS[dbType].replace(
          ":ids",
          placeholders,
        ),
        ids,
      ),
      DbUtilsQuerySQL(
        SQL_QUERIES.GET_LABELS_BY_TEMPLATE_IDS[dbType].replace(
          ":ids",
          placeholders,
        ),
        ids,
      ),
    ]);

  for (const row of assigneeRows) {
    byId.get(row.templateId)?.assignees.push({
      userId: row.userId,
      userName: row.userName as string | undefined,
    });
  }
  for (const row of commentRows) {
    byId.get(row.templateId)?.comments.push({
      id: row.id,
      userId: row.userId,
      userName: row.userName as string | undefined,
      text: row.text,
      dateCreated: row.dateCreated,
      dateUpdated: row.dateUpdated as string | undefined,
    });
  }
  for (const row of attachmentRows) {
    byId.get(row.templateId)?.attachments.push({
      id: row.id,
      fileName: row.fileName,
      filePath: row.filePath,
      dateCreated: row.dateCreated,
    });
  }
  for (const row of labelRows) {
    byId.get(row.templateId)?.labels.push(row.name as string);
  }
  return templates;
}

async function getAttachments(
  templateIds: string[],
): Promise<{ filePath: string }[]> {
  if (templateIds.length === 0) {
    return [];
  }
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_ATTACHMENTS_BY_TEMPLATE_IDS[DbUtilsGetType()].replace(
      ":ids",
      buildInPlaceholders(templateIds.length),
    ),
    templateIds,
  );
  return rows.map((r) => ({ filePath: r.filePath }));
}

// ==================== SQL ====================

const SQL_QUERIES = {
  GET_TEMPLATE: {
    postgres: 'SELECT * FROM task_templates WHERE "id" = $1',
    sqlite: "SELECT * FROM task_templates WHERE id = ?",
  },
  INSERT_TEMPLATE: {
    postgres:
      'INSERT INTO task_templates ("id", "projectId", "title", "description", "priority", "checklist", "scheduleCron", "skipIfPreviousNotDone", "addDateToTitle", "instanceStatus", "dateCreated", "dateUpdated") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
    sqlite:
      "INSERT INTO task_templates (id, projectId, title, description, priority, checklist, scheduleCron, skipIfPreviousNotDone, addDateToTitle, instanceStatus, dateCreated, dateUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  },
  UPDATE_TEMPLATE: {
    postgres:
      'UPDATE task_templates SET "title" = $1, "description" = $2, "priority" = $3, "checklist" = $4, "scheduleCron" = $5, "skipIfPreviousNotDone" = $6, "addDateToTitle" = $7, "instanceStatus" = $8, "projectId" = $9, "dateUpdated" = $10 WHERE "id" = $11',
    sqlite:
      "UPDATE task_templates SET title = ?, description = ?, priority = ?, checklist = ?, scheduleCron = ?, skipIfPreviousNotDone = ?, addDateToTitle = ?, instanceStatus = ?, projectId = ?, dateUpdated = ? WHERE id = ?",
  },
  DELETE_TEMPLATE: {
    postgres: 'DELETE FROM task_templates WHERE "id" = $1',
    sqlite: "DELETE FROM task_templates WHERE id = ?",
  },
  GET_TEMPLATE_IDS_BY_PROJECT: {
    postgres: 'SELECT "id" FROM task_templates WHERE "projectId" = $1',
    sqlite: "SELECT id FROM task_templates WHERE projectId = ?",
  },
  DELETE_TEMPLATE_LABELS: {
    postgres: 'DELETE FROM task_template_labels WHERE "templateId" = $1',
    sqlite: "DELETE FROM task_template_labels WHERE templateId = ?",
  },
  DELETE_TEMPLATE_ASSIGNEES: {
    postgres: 'DELETE FROM task_template_assignees WHERE "templateId" = $1',
    sqlite: "DELETE FROM task_template_assignees WHERE templateId = ?",
  },
  DELETE_TEMPLATE_COMMENTS: {
    postgres: 'DELETE FROM task_template_comments WHERE "templateId" = $1',
    sqlite: "DELETE FROM task_template_comments WHERE templateId = ?",
  },
  DELETE_TEMPLATE_ATTACHMENTS: {
    postgres: 'DELETE FROM task_template_attachments WHERE "templateId" = $1',
    sqlite: "DELETE FROM task_template_attachments WHERE templateId = ?",
  },
  DELETE_TEMPLATE_RUNS: {
    postgres: 'DELETE FROM task_template_runs WHERE "templateId" = $1',
    sqlite: "DELETE FROM task_template_runs WHERE templateId = ?",
  },
  INSERT_ASSIGNEE: {
    postgres:
      'INSERT INTO task_template_assignees ("templateId", "userId") VALUES ($1, $2)',
    sqlite:
      "INSERT INTO task_template_assignees (templateId, userId) VALUES (?, ?)",
  },
  GET_ASSIGNEES_BY_TEMPLATE_IDS: {
    postgres:
      'SELECT ta."templateId", ta."userId", u."name" AS "userName" FROM task_template_assignees ta LEFT JOIN users u ON ta."userId" = u."id" WHERE ta."templateId" IN (:ids)',
    sqlite:
      "SELECT ta.templateId, ta.userId, u.name AS userName FROM task_template_assignees ta LEFT JOIN users u ON ta.userId = u.id WHERE ta.templateId IN (:ids)",
  },
  INSERT_COMMENT: {
    postgres:
      'INSERT INTO task_template_comments ("id", "templateId", "userId", "text", "dateCreated") VALUES ($1, $2, $3, $4, $5)',
    sqlite:
      "INSERT INTO task_template_comments (id, templateId, userId, text, dateCreated) VALUES (?, ?, ?, ?, ?)",
  },
  DELETE_COMMENT: {
    postgres: 'DELETE FROM task_template_comments WHERE "id" = $1',
    sqlite: "DELETE FROM task_template_comments WHERE id = ?",
  },
  GET_COMMENT_BY_ID: {
    postgres:
      'SELECT tc.*, u."name" AS "userName" FROM task_template_comments tc LEFT JOIN users u ON tc."userId" = u."id" WHERE tc."id" = $1',
    sqlite:
      "SELECT tc.*, u.name AS userName FROM task_template_comments tc LEFT JOIN users u ON tc.userId = u.id WHERE tc.id = ?",
  },
  UPDATE_COMMENT: {
    postgres:
      'UPDATE task_template_comments SET "text" = $1, "dateUpdated" = $2 WHERE "id" = $3',
    sqlite:
      "UPDATE task_template_comments SET text = ?, dateUpdated = ? WHERE id = ?",
  },
  GET_COMMENTS_BY_TEMPLATE_IDS: {
    postgres:
      'SELECT tc.*, u."name" AS "userName" FROM task_template_comments tc LEFT JOIN users u ON tc."userId" = u."id" WHERE tc."templateId" IN (:ids) ORDER BY tc."dateCreated"',
    sqlite:
      "SELECT tc.*, u.name AS userName FROM task_template_comments tc LEFT JOIN users u ON tc.userId = u.id WHERE tc.templateId IN (:ids) ORDER BY tc.dateCreated",
  },
  INSERT_ATTACHMENT: {
    postgres:
      'INSERT INTO task_template_attachments ("id", "templateId", "fileName", "filePath", "dateCreated") VALUES ($1, $2, $3, $4, $5)',
    sqlite:
      "INSERT INTO task_template_attachments (id, templateId, fileName, filePath, dateCreated) VALUES (?, ?, ?, ?, ?)",
  },
  DELETE_ATTACHMENT: {
    postgres: 'DELETE FROM task_template_attachments WHERE "id" = $1',
    sqlite: "DELETE FROM task_template_attachments WHERE id = ?",
  },
  GET_ATTACHMENT_BY_ID: {
    postgres: 'SELECT * FROM task_template_attachments WHERE "id" = $1',
    sqlite: "SELECT * FROM task_template_attachments WHERE id = ?",
  },
  GET_ATTACHMENTS_BY_TEMPLATE_IDS: {
    postgres: 'SELECT * FROM task_template_attachments WHERE "templateId" IN (:ids)',
    sqlite: "SELECT * FROM task_template_attachments WHERE templateId IN (:ids)",
  },
  INSERT_LABEL: {
    postgres:
      'INSERT INTO task_template_labels ("id", "templateId", "name") VALUES ($1, $2, $3)',
    sqlite:
      "INSERT INTO task_template_labels (id, templateId, name) VALUES (?, ?, ?)",
  },
  GET_LABELS_BY_TEMPLATE_IDS: {
    postgres: 'SELECT * FROM task_template_labels WHERE "templateId" IN (:ids)',
    sqlite: "SELECT * FROM task_template_labels WHERE templateId IN (:ids)",
  },
  INSERT_RUN: {
    postgres:
      'INSERT INTO task_template_runs ("id", "templateId", "taskId", "dateCreated") VALUES ($1, $2, $3, $4)',
    sqlite:
      "INSERT INTO task_template_runs (id, templateId, taskId, dateCreated) VALUES (?, ?, ?, ?)",
  },
  GET_LAST_RUN: {
    postgres:
      'SELECT r."taskId", t."status" AS "taskStatus", r."dateCreated" FROM task_template_runs r LEFT JOIN tasks t ON r."taskId" = t."id" WHERE r."templateId" = $1 ORDER BY r."dateCreated" DESC LIMIT 1',
    sqlite:
      "SELECT r.taskId, t.status AS taskStatus, r.dateCreated FROM task_template_runs r LEFT JOIN tasks t ON r.taskId = t.id WHERE r.templateId = ? ORDER BY r.dateCreated DESC LIMIT 1",
  },
};
