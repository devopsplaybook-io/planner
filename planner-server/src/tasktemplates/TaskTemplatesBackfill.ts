import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
  DbUtilsTransaction,
} from "../utils/DbUtils";
import { ChecklistItem } from "../model/Task";
import { TaskTemplate } from "../model/TaskTemplate";
import { describeTemplateCron } from "./TaskTemplatesInstance";

const logger = console;

const BACKFILL_FLAG_KEY = "taskTemplatesRecurrenceBackfill";
const CANCELLED_SUFFIX = " [cancelled]";

/**
 * One-time startup migration of the recurrence mechanism: every task
 * carrying a recurrence rule becomes a task template with the same content
 * (title, description, priority, checklist, labels, assignees — a trailing
 * " [cancelled]" suffix is stripped) and a best-effort cron equivalent of
 * the rule. Runs after RunMigrations, before the scheduler starts.
 *
 * Crash-safe and re-runnable: each task is converted in its own
 * transaction that also nulls the task's recurrence column, so an
 * interrupted run only re-processes the not-yet-converted rows. When no
 * rows remain, the recurrence column is dropped and the metadata flag is
 * recorded; a failing drop is logged and skipped (the column stays, empty).
 */
export async function TaskTemplatesBackfillFromRecurrence(): Promise<void> {
  // The backfill drops the tasks.recurrence column once it finishes, so
  // after a completed backfill the SELECT below would crash every later
  // startup with "no such column" — the flag is checked first
  if (await isBackfillDone()) {
    return;
  }
  const rows = await DbUtilsQuerySQL(
    "SELECT * FROM tasks WHERE recurrence IS NOT NULL",
  );
  if (rows.length === 0) {
    if (!(await isBackfillDone())) {
      await dropRecurrenceColumn();
      await markBackfillDone();
    }
    return;
  }
  logger.info(
    `[TaskTemplates] Backfilling ${rows.length} recurring task(s) into task templates`,
  );
  for (const row of rows) {
    try {
      await convertTaskRow(row);
    } catch (error) {
      logger.error(
        `[TaskTemplates] Failed to convert recurring task ${row.id}: ${(error as Error).message}`,
      );
    }
  }
  const remaining = await DbUtilsQuerySQL(
    "SELECT COUNT(*) AS count FROM tasks WHERE recurrence IS NOT NULL",
  );
  if (Number(remaining[0]?.count || 0) === 0) {
    await dropRecurrenceColumn();
    await markBackfillDone();
  }
}

async function isBackfillDone(): Promise<boolean> {
  const rows = await DbUtilsQuerySQL(
    "SELECT value FROM metadata WHERE key = ?",
    [BACKFILL_FLAG_KEY],
  );
  return rows.length > 0 && rows[0].value === "done";
}

async function markBackfillDone(): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO metadata (key, value) VALUES (?, 'done') ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [BACKFILL_FLAG_KEY],
  );
}

async function dropRecurrenceColumn(): Promise<void> {
  try {
    const column =
      DbUtilsGetType() === "postgres"
        ? 'ALTER TABLE tasks DROP COLUMN "recurrence"'
        : "ALTER TABLE tasks DROP COLUMN recurrence";
    await DbUtilsExecSQL(column, []);
    logger.info("[TaskTemplates] Dropped the tasks.recurrence column");
  } catch (error) {
    logger.error(
      `[TaskTemplates] Could not drop the tasks.recurrence column: ${(error as Error).message}`,
    );
  }
}

/**
 * Converts one task row into a task template: the template (with children)
 * and the nulling of the task's recurrence run in one transaction, so a
 * crash never duplicates a template.
 */
async function convertTaskRow(row: Record<string, unknown>): Promise<void> {
  let rule: {
    frequency: string;
    interval: number;
    weekdays?: number[];
    monthDay?: number;
  } | null = null;
  try {
    const raw =
      typeof row.recurrence === "string"
        ? JSON.parse(row.recurrence as string)
        : row.recurrence;
    if (raw && typeof raw === "object") {
      rule = raw;
    }
  } catch {
    // Unparseable rule: still convert the task, without automation
  }

  const template = new TaskTemplate();
  template.projectId = row.projectId as string;
  template.title = stripCancelledSuffix((row.title as string) || "");
  template.description = (row.description as string) || "";
  template.priority = (row.priority as string) || "medium";
  template.checklist = parseChecklist(row.checklist);
  template.scheduleCron = rule ? describeTemplateCron({ ...rule, dueDate: row.dueDate as string }) || undefined : undefined;

  const sourceIsDone = row.status === "Done";

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
      template.dateCreated,
      template.dateUpdated,
    ]);
    for (const label of await getTaskLabels(row.id as string)) {
      const { v4: uuidv4 } = await import("uuid");
      await DbUtilsExecSQL(SQL_QUERIES.INSERT_TEMPLATE_LABEL[DbUtilsGetType()], [
        uuidv4(),
        template.id,
        label,
      ]);
    }
    for (const userId of await getTaskAssignees(row.id as string)) {
      await DbUtilsExecSQL(
        SQL_QUERIES.INSERT_TEMPLATE_ASSIGNEE[DbUtilsGetType()],
        [template.id, userId],
      );
    }
    // An open source task is the previous instance: seed the run so
    // "skip if the previous instance is still open" sees it
    if (!sourceIsDone) {
      const { v4: uuidv4 } = await import("uuid");
      await DbUtilsExecSQL(SQL_QUERIES.INSERT_RUN[DbUtilsGetType()], [
        uuidv4(),
        template.id,
        row.id as string,
        new Date().toISOString(),
      ]);
    }
    await DbUtilsExecSQL(
      SQL_QUERIES.NULL_TASK_RECURRENCE[DbUtilsGetType()],
      [row.id as string],
    );
  });

  logger.info(
    `[TaskTemplates] Converted task ${row.id} into template ${template.id}` +
      (template.scheduleCron ? ` (cron: ${template.scheduleCron})` : " (no cron equivalent — set a schedule)"),
  );
}

function stripCancelledSuffix(title: string): string {
  return title.endsWith(CANCELLED_SUFFIX)
    ? title.slice(0, -CANCELLED_SUFFIX.length)
    : title;
}

function parseChecklist(value: unknown): ChecklistItem[] {
  try {
    const checklist =
      typeof value === "string" ? JSON.parse(value as string) : value;
    return Array.isArray(checklist) ? checklist : [];
  } catch {
    return [];
  }
}

async function getTaskLabels(taskId: string): Promise<string[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_TASK_LABELS[DbUtilsGetType()],
    [taskId],
  );
  return rows.map((r) => r.name as string);
}

async function getTaskAssignees(taskId: string): Promise<string[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_TASK_ASSIGNEES[DbUtilsGetType()],
    [taskId],
  );
  return rows.map((r) => r.userId as string);
}

const SQL_QUERIES = {
  INSERT_TEMPLATE: {
    postgres:
      'INSERT INTO task_templates ("id", "projectId", "title", "description", "priority", "checklist", "scheduleCron", "skipIfPreviousNotDone", "addDateToTitle", "dateCreated", "dateUpdated") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
    sqlite:
      "INSERT INTO task_templates (id, projectId, title, description, priority, checklist, scheduleCron, skipIfPreviousNotDone, addDateToTitle, dateCreated, dateUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  },
  INSERT_TEMPLATE_LABEL: {
    postgres:
      'INSERT INTO task_template_labels ("id", "templateId", "name") VALUES ($1, $2, $3)',
    sqlite:
      "INSERT INTO task_template_labels (id, templateId, name) VALUES (?, ?, ?)",
  },
  INSERT_TEMPLATE_ASSIGNEE: {
    postgres:
      'INSERT INTO task_template_assignees ("templateId", "userId") VALUES ($1, $2)',
    sqlite:
      "INSERT INTO task_template_assignees (templateId, userId) VALUES (?, ?)",
  },
  INSERT_RUN: {
    postgres:
      'INSERT INTO task_template_runs ("id", "templateId", "taskId", "dateCreated") VALUES ($1, $2, $3, $4)',
    sqlite:
      "INSERT INTO task_template_runs (id, templateId, taskId, dateCreated) VALUES (?, ?, ?, ?)",
  },
  NULL_TASK_RECURRENCE: {
    postgres: 'UPDATE tasks SET "recurrence" = NULL WHERE "id" = $1',
    sqlite: "UPDATE tasks SET recurrence = NULL WHERE id = ?",
  },
  GET_TASK_LABELS: {
    postgres: 'SELECT "name" FROM task_labels WHERE "taskId" = $1',
    sqlite: "SELECT name FROM task_labels WHERE taskId = ?",
  },
  GET_TASK_ASSIGNEES: {
    postgres: 'SELECT "userId" FROM task_assignees WHERE "taskId" = $1',
    sqlite: "SELECT userId FROM task_assignees WHERE taskId = ?",
  },
};
