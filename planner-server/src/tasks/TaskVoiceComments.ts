import { v4 as uuidv4 } from "uuid";
import * as fs from "fs-extra";
import { Config } from "../Config";
import { DictationTranscribeAndPolish } from "../dictation/Dictation";
import { NormalizeLanguage } from "../dictation/DictationRoutes";
import { addComment, TasksDataGet, TasksDataTouch } from "./TasksData";
import { UsersDataGet } from "../users/UsersData";

const logger = console;

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

let config: Config | null = null;

// userId -> transcription start timestamps within the current hourly window
const recentTranscriptions = new Map<string, number[]>();
// userId -> tail of that user's FIFO chain of voice comment jobs
const userQueues = new Map<string, Promise<void>>();

export interface TaskVoiceCommentRequest {
  taskId: string;
  userId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  requestedLanguage?: string;
  userName?: string;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export async function TaskVoiceCommentsInit(configIn: Config): Promise<void> {
  config = configIn;
  if (configIn.DICTATION_ENABLED && configIn.IsDictationSttConfigured()) {
    logger.info(
      "[VoiceComments] Enabled (audio attachments on tasks are transcribed in the background)",
    );
  } else {
    logger.info(
      "[VoiceComments] Feature disabled (dictation disabled or STT not configured)",
    );
  }
  if (!sweepTimer) {
    sweepTimer = setInterval(() => {
      TaskVoiceCommentsSweep();
    }, RATE_LIMIT_WINDOW_MS);
    sweepTimer.unref?.();
  }
}

/**
 * Schedules a background transcription for an audio attachment uploaded to a
 * task. Fire-and-forget and never throws: the upload is already done and
 * must never be impacted by the voice comment feature. A no-op whenever the
 * feature is not enabled or STT is not configured.
 */
export function TaskVoiceCommentsEnqueue(request: TaskVoiceCommentRequest): void {
  try {
    if (!config || !config.DICTATION_ENABLED || !config.IsDictationSttConfigured()) {
      return;
    }
    if (!request.mimeType || !request.mimeType.startsWith("audio/")) {
      return;
    }
    // Per-user FIFO queue: one transcription at a time, later uploads queue
    // behind the running one so every voice message gets its transcript
    const previous = userQueues.get(request.userId) || Promise.resolve();
    const next = previous
      .then(() => runVoiceJob(request))
      .catch((error) => {
        logger.error(
          `[VoiceComments] Unexpected failure in a voice comment job: ${(error as Error).message}`,
        );
      });
    userQueues.set(request.userId, next);
    // Drop the queue entry once this user's chain is idle: settled queues
    // must not accumulate per user for the lifetime of the process
    next.finally(() => {
      if (userQueues.get(request.userId) === next) {
        userQueues.delete(request.userId);
      }
    });
  } catch (error) {
    logger.error(
      `[VoiceComments] Failed to enqueue a voice comment job: ${(error as Error).message}`,
    );
  }
}

/**
 * Drops expired rate-limit timestamps and deletes the users that have none
 * left. Returns the number of removed users.
 */
export function TaskVoiceCommentsSweep(now: number = Date.now()): number {
  let removed = 0;
  for (const [userId, timestamps] of recentTranscriptions) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) {
      recentTranscriptions.delete(userId);
      removed++;
    } else {
      recentTranscriptions.set(userId, recent);
    }
  }
  return removed;
}

/** Test helper: users with a pending voice-comment queue. */
export function TaskVoiceCommentsQueueCount(): number {
  return userQueues.size;
}

/** Test helper: users currently tracked by the hourly rate limiter. */
export function TaskVoiceCommentsRateLimitedUsers(): number {
  return recentTranscriptions.size;
}

/**
 * Consumes one slot of the user's hourly transcription budget. Returns true
 * (without consuming) when the configured dictation rate limit is reached.
 */
function consumeRateLimitSlot(userId: string): boolean {
  if (!config) {
    return true;
  }
  const now = Date.now();
  const timestamps = (recentTranscriptions.get(userId) || []).filter(
    (start) => now - start < RATE_LIMIT_WINDOW_MS,
  );
  if (timestamps.length >= config.RATE_LIMIT_DICTATION_MAX) {
    recentTranscriptions.set(userId, timestamps);
    return false;
  }
  timestamps.push(now);
  recentTranscriptions.set(userId, timestamps);
  return true;
}

async function runVoiceJob(request: TaskVoiceCommentRequest): Promise<void> {
  const jobId = uuidv4();
  try {
    if (!config || !consumeRateLimitSlot(request.userId)) {
      logger.warn(
        `[VoiceComments] Hourly transcription limit reached; skipping job ${jobId}`,
      );
      return;
    }
    const task = await TasksDataGet(request.taskId);
    if (!task) {
      logger.info(
        `[VoiceComments] Task is gone before job ${jobId} started; dropping the transcript`,
      );
      return;
    }
    if (!(await fs.pathExists(request.filePath))) {
      logger.info(
        `[VoiceComments] Audio file is gone before job ${jobId} started; dropping the transcript`,
      );
      return;
    }
    const language = NormalizeLanguage(
      request.requestedLanguage,
      config.DICTATION_LANGUAGE,
    );
    const { polishedText } = await DictationTranscribeAndPolish(
      request.filePath,
      request.mimeType,
      language,
    );
    if (!polishedText.trim()) {
      logger.warn(
        `[VoiceComments] Empty transcript for job ${jobId}; no comment posted`,
      );
      return;
    }
    const userName = request.userName || (await UsersDataGet(request.userId))?.name;
    await addComment(request.taskId, {
      id: uuidv4(),
      userId: request.userId,
      userName,
      text: `**Voice message transcript** (${request.fileName}):\n\n${polishedText}`,
      dateCreated: new Date().toISOString(),
    });
    await TasksDataTouch(request.taskId);
    logger.info(`[VoiceComments] Job ${jobId} done`);
  } catch (error) {
    // Never rethrow: the upload succeeded independently and the audio
    // attachment stays as the voice message. Never log transcript content.
    logger.error(
      `[VoiceComments] Transcription failed for job ${jobId}: ${(error as Error).message}`,
    );
  }
}
