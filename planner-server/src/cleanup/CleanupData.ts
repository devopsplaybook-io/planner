import { Task } from "../model/Task";
import { DbUtilsGetType, DbUtilsQuerySQL } from "../utils/DbUtils";
import { deleteTaskAttachment } from "../tasks/TasksData";

export interface CleanupAttachmentRow {
  id: string;
  taskId: string;
  fileName: string;
  filePath: string;
  dateCreated: string;
}

/**
 * Pure query builders (SQLite "?" style — DbUtilsQuerySQL renumbers them for
 * postgres) so both dialects can be unit-tested without a database.
 */

export function buildDoneTasksQuery(
  projectId: string,
  cutoffIso: string,
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string; params: unknown[] } {
  const quote = (name: string) => (dbType === "postgres" ? `"${name}"` : name);
  // "Done" is the mandated catalog status and is hardcoded in the existing
  // task queries too; dateUpdated doubles as the completion timestamp.
  return {
    sql: `SELECT * FROM tasks WHERE ${quote("projectId")} = ? AND ${quote("status")} = 'Done' AND ${quote("dateUpdated")} < ?`,
    params: [projectId, cutoffIso],
  };
}

export function buildAttachmentsQuery(
  projectId: string,
  cutoffIso: string,
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string; params: unknown[] } {
  const quote = (name: string) => (dbType === "postgres" ? `"${name}"` : name);
  return {
    sql: `SELECT a.* FROM task_attachments a JOIN tasks t ON a.${quote("taskId")} = t.${quote("id")} WHERE t.${quote("projectId")} = ? AND a.${quote("dateCreated")} < ?`,
    params: [projectId, cutoffIso],
  };
}

export async function CleanupDataListDoneTasksOlderThan(
  projectId: string,
  cutoffIso: string,
): Promise<Task[]> {
  const { sql, params } = buildDoneTasksQuery(projectId, cutoffIso);
  const rows = await DbUtilsQuerySQL(sql, params);
  return rows.map((row) => Task.fromJson(row));
}

export async function CleanupDataListTaskAttachmentsOlderThan(
  projectId: string,
  cutoffIso: string,
): Promise<CleanupAttachmentRow[]> {
  const { sql, params } = buildAttachmentsQuery(projectId, cutoffIso);
  const rows = await DbUtilsQuerySQL(sql, params);
  return rows.map((row) => ({
    id: row.id as string,
    taskId: row.taskId as string,
    fileName: row.fileName as string,
    filePath: row.filePath as string,
    dateCreated: row.dateCreated as string,
  }));
}

/**
 * Removes the attachment row through the existing task-attachment delete so
 * the row handling stays identical to the manual deletion path.
 */
export async function CleanupDataDeleteTaskAttachment(
  attachmentId: string,
): Promise<void> {
  await deleteTaskAttachment(attachmentId);
}
