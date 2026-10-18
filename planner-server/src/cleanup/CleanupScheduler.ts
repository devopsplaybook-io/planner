import * as fs from "fs-extra";
import { ProjectsDataList } from "../projects/ProjectsData";
import { SettingsDataGet } from "../settings/SettingsData";
import { TasksDataDelete } from "../tasks/TasksData";
import {
  CleanupAttachmentRow,
  CleanupDataDeleteTaskAttachment,
  CleanupDataListDoneTasksOlderThan,
  CleanupDataListTaskAttachmentsOlderThan,
} from "./CleanupData";
import {
  CLEANUP_SETTINGS_CATEGORY,
  CleanupCutoffIso,
  CleanupRule,
  IsAttachmentEligible,
  IsAudioAttachmentFileName,
  IsDoneTaskEligible,
  ParseCleanupRules,
} from "./CleanupRules";

const logger = console;

export interface CleanupRunSummary {
  projects: number;
  tasksDeleted: number;
  attachmentsDeleted: number;
  voiceMessagesDeleted: number;
  failures: number;
}

export interface CleanupPreviewTaskSample {
  id: string;
  title: string;
  ageDays: number;
}

export interface CleanupPreviewAttachmentSample {
  id: string;
  fileName: string;
  taskId: string;
  isVoiceMessage: boolean;
  ageDays: number;
}

export interface CleanupPreviewProject {
  projectId: string;
  taskCount: number;
  attachmentCount: number;
  voiceMessageCount: number;
  taskSamples: CleanupPreviewTaskSample[];
  attachmentSamples: CleanupPreviewAttachmentSample[];
}

const PREVIEW_SAMPLE_CAP = 50;

function ageDaysFrom(isoDate: string | undefined, nowMs: number): number {
  if (!isoDate) {
    return 0;
  }
  const created = new Date(isoDate).getTime();
  if (Number.isNaN(created)) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - created) / (24 * 60 * 60 * 1000)));
}

/**
 * Runs the enabled rules once and returns the counts. Never throws: every
 * project, aspect and item is individually guarded so a failure neither
 * aborts the run nor crashes the process. Attachment file-removal failures
 * keep the row so the next run retries.
 */
export async function CleanupRunOnce(
  now = new Date(),
): Promise<CleanupRunSummary> {
  const summary: CleanupRunSummary = {
    projects: 0,
    tasksDeleted: 0,
    attachmentsDeleted: 0,
    voiceMessagesDeleted: 0,
    failures: 0,
  };
  const rules = await loadRules();
  if (rules.length === 0) {
    return summary;
  }
  let projectIds: Set<string>;
  try {
    projectIds = new Set((await ProjectsDataList()).map((p) => p.id));
  } catch (error) {
    logger.error(
      `[Cleanup] Run aborted (projects unavailable): ${(error as Error).message}`,
    );
    return summary;
  }
  // An audio file is removed once per run, by whichever rule covers it
  const processedAttachmentIds = new Set<string>();
  const nowIso = now.toISOString();
  for (const rule of rules) {
    if (!rule.enabled || !projectIds.has(rule.projectId)) {
      continue;
    }
    summary.projects++;
    await cleanupDoneTasks(rule, nowIso, summary);
    await cleanupAttachments(rule, nowIso, processedAttachmentIds, summary);
  }
  logger.info(
    `[Cleanup] Run summary: projects=${summary.projects} tasksDeleted=${summary.tasksDeleted} attachmentsDeleted=${summary.attachmentsDeleted} voiceMessagesDeleted=${summary.voiceMessagesDeleted} failures=${summary.failures}`,
  );
  return summary;
}

async function loadRules(): Promise<CleanupRule[]> {
  let raw: string | null;
  try {
    raw = await SettingsDataGet(CLEANUP_SETTINGS_CATEGORY);
  } catch (error) {
    logger.error(
      `[Cleanup] Run aborted (rules unreadable): ${(error as Error).message}`,
    );
    return [];
  }
  if (raw === null || !raw.trim()) {
    return [];
  }
  try {
    return ParseCleanupRules(JSON.parse(raw));
  } catch {
    logger.warn("[Cleanup] Ignoring malformed cleanup rules document");
    return [];
  }
}

async function cleanupDoneTasks(
  rule: CleanupRule,
  nowIso: string,
  summary: CleanupRunSummary,
): Promise<void> {
  if (!rule.deleteDoneTasksOlderThanDays) {
    return;
  }
  const cutoff = CleanupCutoffIso(rule.deleteDoneTasksOlderThanDays, nowIso);
  let tasks;
  try {
    tasks = await CleanupDataListDoneTasksOlderThan(rule.projectId, cutoff);
  } catch (error) {
    summary.failures++;
    logger.error(
      `[Cleanup] Task listing failed for project ${rule.projectId}: ${(error as Error).message}`,
    );
    return;
  }
  for (const task of tasks) {
    // Guardrail: only a Done task older than the cutoff may ever be deleted
    if (!IsDoneTaskEligible(task, cutoff)) {
      continue;
    }
    try {
      await TasksDataDelete(task.id);
      summary.tasksDeleted++;
    } catch (error) {
      summary.failures++;
      logger.error(
        `[Cleanup] Failed to delete task ${task.id}: ${(error as Error).message}`,
      );
    }
  }
}

async function cleanupAttachments(
  rule: CleanupRule,
  nowIso: string,
  processedAttachmentIds: Set<string>,
  summary: CleanupRunSummary,
): Promise<void> {
  if (
    !rule.deleteAttachmentsOlderThanDays &&
    !rule.deleteVoiceMessagesOlderThanDays
  ) {
    return;
  }
  interface Selection {
    attachments: CleanupAttachmentRow[];
    cutoff: string;
    audioOnly: boolean;
  }
  const selections: Selection[] = [];
  if (rule.deleteAttachmentsOlderThanDays) {
    try {
      selections.push({
        attachments: await CleanupDataListTaskAttachmentsOlderThan(
          rule.projectId,
          CleanupCutoffIso(rule.deleteAttachmentsOlderThanDays, nowIso),
        ),
        cutoff: CleanupCutoffIso(rule.deleteAttachmentsOlderThanDays, nowIso),
        audioOnly: false,
      });
    } catch (error) {
      summary.failures++;
      logger.error(
        `[Cleanup] Attachment listing failed for project ${rule.projectId}: ${(error as Error).message}`,
      );
    }
  }
  if (rule.deleteVoiceMessagesOlderThanDays) {
    try {
      selections.push({
        attachments: await CleanupDataListTaskAttachmentsOlderThan(
          rule.projectId,
          CleanupCutoffIso(rule.deleteVoiceMessagesOlderThanDays, nowIso),
        ),
        cutoff: CleanupCutoffIso(rule.deleteVoiceMessagesOlderThanDays, nowIso),
        audioOnly: true,
      });
    } catch (error) {
      summary.failures++;
      logger.error(
        `[Cleanup] Voice message listing failed for project ${rule.projectId}: ${(error as Error).message}`,
      );
    }
  }
  for (const selection of selections) {
    for (const attachment of selection.attachments) {
      if (processedAttachmentIds.has(attachment.id)) {
        continue;
      }
      if (
        !IsAttachmentEligible(attachment, selection.cutoff, selection.audioOnly)
      ) {
        continue;
      }
      processedAttachmentIds.add(attachment.id);
      const removed = await removeAttachmentFile(attachment, summary);
      if (!removed) {
        continue;
      }
      try {
        await CleanupDataDeleteTaskAttachment(attachment.id);
        if (IsAudioAttachmentFileName(attachment.fileName)) {
          summary.voiceMessagesDeleted++;
        } else {
          summary.attachmentsDeleted++;
        }
      } catch (error) {
        summary.failures++;
        logger.error(
          `[Cleanup] Failed to delete attachment ${attachment.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}

/**
 * Removes the file on disk first; the row is only deleted when the file is
 * gone (or was already missing, which self-heals). A file failure keeps the
 * row so the next run retries.
 */
async function removeAttachmentFile(
  attachment: CleanupAttachmentRow,
  summary: CleanupRunSummary,
): Promise<boolean> {
  try {
    if (await fs.pathExists(attachment.filePath)) {
      await fs.remove(attachment.filePath);
    }
    return true;
  } catch (error) {
    summary.failures++;
    logger.error(
      `[Cleanup] Failed to remove attachment file (will retry next run): ${(error as Error).message}`,
    );
    return false;
  }
}

/**
 * Dry-run of the given (edited, possibly not-yet-saved) rules using the same
 * selection code as the scheduler. Deletes nothing.
 */
export async function CleanupPreviewRules(
  rules: CleanupRule[],
  now = new Date(),
): Promise<CleanupPreviewProject[]> {
  let projectIds: Set<string>;
  try {
    projectIds = new Set((await ProjectsDataList()).map((p) => p.id));
  } catch {
    return [];
  }
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const previews: CleanupPreviewProject[] = [];
  for (const rule of rules) {
    if (!rule.enabled || !projectIds.has(rule.projectId)) {
      continue;
    }
    const preview: CleanupPreviewProject = {
      projectId: rule.projectId,
      taskCount: 0,
      attachmentCount: 0,
      voiceMessageCount: 0,
      taskSamples: [],
      attachmentSamples: [],
    };
    if (rule.deleteDoneTasksOlderThanDays) {
      try {
        const cutoff = CleanupCutoffIso(
          rule.deleteDoneTasksOlderThanDays,
          nowIso,
        );
        const tasks = await CleanupDataListDoneTasksOlderThan(
          rule.projectId,
          cutoff,
        );
        for (const task of tasks) {
          if (!IsDoneTaskEligible(task, cutoff)) {
            continue;
          }
          preview.taskCount++;
          if (preview.taskSamples.length < PREVIEW_SAMPLE_CAP) {
            preview.taskSamples.push({
              id: task.id,
              title: task.title,
              ageDays: ageDaysFrom(task.dateUpdated, nowMs),
            });
          }
        }
      } catch (error) {
        logger.error(
          `[Cleanup] Preview task listing failed for project ${rule.projectId}: ${(error as Error).message}`,
        );
      }
    }
    const attachments: {
      attachment: CleanupAttachmentRow;
      cutoff: string;
      audioOnly: boolean;
    }[] = [];
    if (rule.deleteAttachmentsOlderThanDays) {
      const cutoff = CleanupCutoffIso(
        rule.deleteAttachmentsOlderThanDays,
        nowIso,
      );
      try {
        const rows = await CleanupDataListTaskAttachmentsOlderThan(
          rule.projectId,
          cutoff,
        );
        for (const row of rows) {
          attachments.push({ attachment: row, cutoff, audioOnly: false });
        }
      } catch (error) {
        logger.error(
          `[Cleanup] Preview attachment listing failed for project ${rule.projectId}: ${(error as Error).message}`,
        );
      }
    }
    if (rule.deleteVoiceMessagesOlderThanDays) {
      const cutoff = CleanupCutoffIso(
        rule.deleteVoiceMessagesOlderThanDays,
        nowIso,
      );
      try {
        const rows = await CleanupDataListTaskAttachmentsOlderThan(
          rule.projectId,
          cutoff,
        );
        for (const row of rows) {
          attachments.push({ attachment: row, cutoff, audioOnly: true });
        }
      } catch (error) {
        logger.error(
          `[Cleanup] Preview voice message listing failed for project ${rule.projectId}: ${(error as Error).message}`,
        );
      }
    }
    const seen = new Set<string>();
    for (const { attachment, cutoff, audioOnly } of attachments) {
      if (seen.has(attachment.id)) {
        continue;
      }
      seen.add(attachment.id);
      if (!IsAttachmentEligible(attachment, cutoff, audioOnly)) {
        continue;
      }
      const isVoice = IsAudioAttachmentFileName(attachment.fileName);
      if (isVoice) {
        preview.voiceMessageCount++;
      } else {
        preview.attachmentCount++;
      }
      if (preview.attachmentSamples.length < PREVIEW_SAMPLE_CAP) {
        preview.attachmentSamples.push({
          id: attachment.id,
          fileName: attachment.fileName,
          taskId: attachment.taskId,
          isVoiceMessage: isVoice,
          ageDays: ageDaysFrom(attachment.dateCreated, nowMs),
        });
      }
    }
    previews.push(preview);
  }
  return previews;
}

// ── Background scheduler ──────────────────────────────────────────────────────

const CLEANUP_FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let runInFlight = false;

/**
 * Runs the cleanup once, guarded so an overlapping slow run is skipped.
 * Never throws.
 */
export async function CleanupTick(): Promise<void> {
  if (runInFlight) {
    return;
  }
  runInFlight = true;
  try {
    await CleanupRunOnce();
  } catch (error) {
    logger.error(`[Cleanup] Run failed: ${(error as Error).message}`);
  } finally {
    runInFlight = false;
  }
}

/**
 * Starts the daily cleanup scheduler: first run 5 minutes after startup,
 * then every 24 hours. The timer never blocks process exit and a failing
 * run never breaks the process.
 */
export function CleanupInit(): void {
  if (cleanupTimer) {
    return;
  }
  const firstRun = setTimeout(() => {
    CleanupTick();
  }, CLEANUP_FIRST_RUN_DELAY_MS);
  firstRun.unref?.();
  cleanupTimer = setInterval(() => {
    CleanupTick();
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
  logger.info(
    "[Cleanup] Scheduler started (first run in 5 minutes, then every 24 hours)",
  );
}
