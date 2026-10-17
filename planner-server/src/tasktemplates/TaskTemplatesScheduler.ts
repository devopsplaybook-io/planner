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
 * Registers the cron job of one template. Does nothing for templates
 * without a schedule.
 */
function scheduleTemplate(template: TaskTemplate): void {
  if (!template.scheduleCron) {
    return;
  }
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
  jobs.get(templateId)?.destroy();
  jobs.delete(templateId);
  TaskTemplatesGet(templateId)
    .then((template) => {
      if (template) {
        scheduleTemplate(template);
      }
    })
    .catch((error) =>
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
