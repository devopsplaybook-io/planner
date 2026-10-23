import * as cron from "node-cron";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { TaskTemplate } from "../model/TaskTemplate";
import {
  TaskTemplatesGet,
  TaskTemplatesList,
  TaskTemplateRunsGetLast,
} from "./TaskTemplatesData";
import { createInstanceFromTemplate } from "./TaskTemplatesInstance";

const logger = console;

/**
 * One node-cron job per scheduled template, kept in a module-level registry
 * (same pattern as the recommendation scheduler). Tick callbacks are async
 * but never await each other: node-cron fires them sequentially.
 */
const jobs = new Map<string, cron.ScheduledTask>();

/**
 * Per-template promise chain serializing refreshes and ticks. A refresh and
 * a tick of the same template never run concurrently, so a slow refresh
 * cannot re-register a stale schedule and two ticks cannot both pass the
 * skip check before an instance exists.
 */
const templateChains = new Map<string, Promise<unknown>>();

function serializeTemplateOperation<T>(
  templateId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = templateChains.get(templateId) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  templateChains.set(templateId, tail);
  tail.then(() => {
    if (templateChains.get(templateId) === tail) {
      templateChains.delete(templateId);
    }
  });
  return next;
}

/**
 * Registers the cron job of one template. Does nothing for templates
 * without a schedule. Any previous job of the same template is stopped
 * first, so scheduling is idempotent.
 */
function scheduleTemplate(template: TaskTemplate): void {
  if (!template.scheduleCron) {
    return;
  }
  jobs.get(template.id)?.destroy();
  jobs.delete(template.id);
  const task = cron.schedule(template.scheduleCron, () => {
    createScheduledInstance(template.id).catch((error) =>
      logger.error(
        `[TaskTemplates] Scheduled creation failed for template ${template.id}: ${error.message}`,
      ),
    );
  });
  jobs.set(template.id, task);
}

/**
 * (Re-)registers the cron job of a template after a create, update or
 * delete: the existing job (if any) is destroyed and a new one scheduled
 * from the current stored state. Safe to call for unknown templates
 * (deletes): it only stops the old job.
 */
export function TaskTemplatesSchedulerRefresh(templateId: string): void {
  serializeTemplateOperation(templateId, async () => {
    jobs.get(templateId)?.destroy();
    jobs.delete(templateId);
    // Re-read the template only after the previous operation of this
    // template finished, so a slow earlier fetch cannot win the race
    const template = await TaskTemplatesGet(templateId);
    if (template) {
      scheduleTemplate(template);
    }
  }).catch((error) =>
    logger.error(
      `[TaskTemplates] Failed to re-schedule template ${templateId}: ${error.message}`,
    ),
  );
}

/** Schedules every template that has a cron schedule (server startup). */
export async function TaskTemplatesSchedulerInit(): Promise<void> {
  const templates = await TaskTemplatesList();
  for (const template of templates) {
    if (template.scheduleCron) {
      scheduleTemplate(template);
    }
  }
  logger.info(
    `[TaskTemplates] Scheduled ${jobs.size} task template(s) with a cron automation`,
  );
}

/**
 * One scheduler tick: applies the "skip if the previous instance is still
 * open" rule, then creates the task instance and records the run. Returns
 * the created task id, or null when the tick was skipped.
 */
export async function createScheduledInstance(
  templateId: string,
): Promise<string | null> {
  return serializeTemplateOperation(templateId, () =>
    runScheduledInstance(templateId),
  );
}

async function runScheduledInstance(
  templateId: string,
): Promise<string | null> {
  const template = await TaskTemplatesGet(templateId);
  if (!template) {
    return null;
  }
  if (template.skipIfPreviousNotDone) {
    const lastRun = await TaskTemplateRunsGetLast(templateId);
    if (lastRun && lastRun.taskStatus !== null && lastRun.taskStatus !== "Done") {
      logger.info(
        `[TaskTemplates] Skipped template ${templateId}: the previous instance is still ${lastRun.taskStatus}`,
      );
      return null;
    }
  }
  const project = await ProjectsDataGet(template.projectId);
  if (!project || project.archived) {
    logger.info(
      `[TaskTemplates] Skipped template ${templateId}: project missing or archived`,
    );
    return null;
  }
  const task = await createInstanceFromTemplate(template, project);
  logger.info(
    `[TaskTemplates] Created task ${task.id} from template ${templateId}`,
  );
  return task.id;
}

/** Test helper: the currently registered jobs (id -> ScheduledTask). */
export function TaskTemplatesSchedulerJobs(): Map<string, cron.ScheduledTask> {
  return jobs;
}

/** Test helper: waits until no serialized template operation is pending. */
export async function TaskTemplatesSchedulerWaitIdle(): Promise<void> {
  while (templateChains.size > 0) {
    await Promise.allSettled(templateChains.values());
  }
}
