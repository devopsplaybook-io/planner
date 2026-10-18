import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs-extra";
import { Task } from "../model/Task";
import { TaskTemplate } from "../model/TaskTemplate";
import { Project } from "../model/Project";
import { TasksDataAdd, addTaskAttachment } from "../tasks/TasksData";
import { TaskTemplateRunsAdd } from "./TaskTemplatesData";

/**
 * "YYYY.MN.DD" title suffix of instances created from a template when
 * "add the day date to the title" is enabled: zero-padded month and day of
 * the creation date (e.g. "2026.10.17"). Pure so it can be unit-tested.
 */
export function buildDatedTitle(title: string, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${title} ${year}.${month}.${day}`;
}

/**
 * Builds the task created from a template: the title (optionally suffixed
 * with the creation date " YYYY.MN.DD"), description, priority, checklist
 * (starting done states as defined on the template), labels and assignees
 * are carried over; comments stay on the template (discussion, not content)
 * and attachment files are copied by the caller. The instance starts in the
 * template's configured initial status when valid, else the project's first
 * status (or "To Do" when the catalog has no statuses), with no due date.
 */
export function buildTaskFromTemplate(
  template: TaskTemplate,
  project: Project,
  options: { addDateSuffix: boolean },
): Task {
  const task = new Task();
  task.projectId = template.projectId;
  task.title = options.addDateSuffix
    ? buildDatedTitle(template.title, new Date())
    : template.title;
  task.description = template.description;
  task.status =
    template.instanceStatus && project.statuses.includes(template.instanceStatus)
      ? template.instanceStatus
      : project.statuses[0] || "To Do";
  task.priority = template.priority;
  task.labels = [...(template.labels || [])];
  task.assignees = (template.assignees || []).map((a) => ({ userId: a.userId }));
  task.checklist = (template.checklist || []).map((item) => ({
    text: item.text,
    done: !!item.done,
  }));
  return task;
}

/**
 * Computes the on-disk path of a copied template attachment: same directory
 * and extension as the source file, named after the new attachment id.
 */
export function buildTemplateAttachmentCopyPath(
  sourceFilePath: string,
  newAttachmentId: string,
): string {
  return path.join(
    path.dirname(sourceFilePath),
    newAttachmentId + path.extname(sourceFilePath),
  );
}

/**
 * Creates the task instance of a template (used by the manual
 * create-instance route and by the scheduler): builds the task, inserts it,
 * copies the template's attachment files to the task and records the run.
 */
export async function createInstanceFromTemplate(
  template: TaskTemplate,
  project: Project,
): Promise<Task> {
  const task = buildTaskFromTemplate(template, project, {
    addDateSuffix: template.addDateToTitle,
  });
  await TasksDataAdd(task);
  for (const attachment of template.attachments || []) {
    if (!(await fs.pathExists(attachment.filePath))) {
      continue;
    }
    const attachmentId = uuidv4();
    const copyPath = buildTemplateAttachmentCopyPath(
      attachment.filePath,
      attachmentId,
    );
    await fs.copy(attachment.filePath, copyPath);
    await addTaskAttachment(task.id, attachment.fileName, copyPath, attachmentId);
    task.attachments.push({
      id: attachmentId,
      fileName: attachment.fileName,
      filePath: copyPath,
      dateCreated: new Date().toISOString(),
    });
  }
  await TaskTemplateRunsAdd(template.id, task.id);
  return task;
}

/**
 * Best-effort cron equivalent of a legacy recurrence rule, used by the
 * startup backfill. Returns null when no faithful cron exists (interval >
 * 1 has none). Fires at midnight in the server timezone.
 */
export function describeTemplateCron(rule: {
  frequency: string;
  interval: number;
  weekdays?: number[];
  monthDay?: number;
  dueDate?: string;
}): string | null {
  if (rule.interval !== 1) {
    return null;
  }
  if (rule.frequency === "daily") {
    return "0 0 * * *";
  }
  if (rule.frequency === "weekly") {
    if (rule.weekdays && rule.weekdays.length > 0) {
      const days = [...new Set(rule.weekdays)].sort((a, b) => a - b);
      return `0 0 * * ${days.join(",")}`;
    }
    // Weekly without a weekday set: keep the due date's weekday
    const day = weekdayOf(rule.dueDate);
    return day === null ? "0 0 * * 1" : `0 0 * * ${day}`;
  }
  if (rule.frequency === "monthly") {
    // Monthly: the pinned monthDay or the due date's day; cron only fires
    // in months containing the day (a cron cannot express "last day")
    let day = rule.monthDay;
    if (day === undefined) {
      day = dayOfMonthOf(rule.dueDate);
    }
    return day === null ? "0 0 1 * *" : `0 0 ${day} * *`;
  }
  return null;
}

/** Weekday (0–6, 0 = Sunday) of a "YYYY-MM-DD" date; null when malformed. */
function weekdayOf(date?: string): number | null {
  const parts = parseDateParts(date);
  if (!parts) {
    return null;
  }
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/** Day of month (1–31) of a "YYYY-MM-DD" date; null when malformed. */
function dayOfMonthOf(date?: string): number | null {
  const parts = parseDateParts(date);
  return parts ? parts.day : null;
}

function parseDateParts(date?: string): {
  year: number;
  month: number;
  day: number;
} | null {
  if (!date) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}
