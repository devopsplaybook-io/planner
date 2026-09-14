import * as path from "path";
import { Task } from "../model/Task";

/**
 * Builds a copy of the source task: a new id, the same fields (project,
 * title, description, priority, due date, labels, assignees, checklist)
 * and no comments or attachments. Comments never carry over; attachments
 * are copied file-by-file by the caller. The clone lands in the first
 * status of the project (resolved by the caller; without it the source
 * status is kept).
 */
export function cloneTaskFrom(source: Task, firstStatus?: string): Task {
  const clone = new Task();
  clone.projectId = source.projectId;
  clone.title = source.title;
  clone.description = source.description;
  clone.status = firstStatus || source.status;
  clone.priority = source.priority;
  clone.dueDate = source.dueDate;
  clone.labels = [...(source.labels || [])];
  clone.assignees = (source.assignees || []).map((a) => ({ userId: a.userId }));
  clone.checklist = (source.checklist || []).map((item) => ({ ...item }));
  return clone;
}

/**
 * Computes the on-disk path of a cloned attachment: same directory and
 * extension as the source file, named after the new attachment id.
 */
export function buildAttachmentCopyPath(
  sourceFilePath: string,
  newAttachmentId: string,
): string {
  return path.join(
    path.dirname(sourceFilePath),
    newAttachmentId + path.extname(sourceFilePath),
  );
}
