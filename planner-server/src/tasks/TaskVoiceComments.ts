import { v4 as uuidv4 } from "uuid";
import * as fs from "fs-extra";
import { Config } from "../Config";
import {
  DictationNotifyJobChange,
  DictationPolishTranscript,
  DictationTranscribeAudio,
} from "../dictation/Dictation";
import { NormalizeLanguage } from "../dictation/DictationRoutes";
import {
  DictationDataCreate,
  DictationDataGet,
  DictationDataGetLatestByAttachment,
  DictationDataUpdate,
} from "../dictation/DictationData";
import {
  DictationTelemetryRecordError,
  DictationTelemetryRecordJob,
  DictationTelemetryRecordNoSpeech,
  DictationTelemetryRecordStage,
  DictationTelemetryStartSpan,
} from "../dictation/DictationTelemetry";
import { SttNoSpeechError } from "../dictation/SttWhisperCpp";
import { DbUtilsIsUniqueViolation } from "../utils/DbUtils";
import { addComment, TasksDataGet, TasksDataTouch } from "./TasksData";
import { recordTaskUpdate } from "./TaskUpdates";
import { UsersDataGet } from "../users/UsersData";

const logger = console;

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DICTATION_JOB_TTL_MS = 60 * 60 * 1000;
const NO_SPEECH_ERROR = "No speech detected, please try again.";
const TRANSCRIPT_COMMENT_PREFIX = "**Voice message transcript**";
const TRANSCRIPT_COMMENT_TOKEN = "**Voice message transcript** (";
const INTERRUPTED_ERROR = "Transcription interrupted, please retry.";

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
  attachmentId?: string;
  requestedLanguage?: string;
  userName?: string;
}

export interface TaskVoiceCommentsEnqueueResult {
  queued: boolean;
  rateLimited: boolean;
  jobId?: string;
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
 * task. Never throws: the upload is already done and must never be impacted
 * by the voice comment feature. A no-op whenever the feature is not enabled
 * or STT is not configured. The hourly rate-limit slot is consumed here,
 * synchronously, so the caller can report a skipped transcription in the
 * upload response. A job row is persisted before queueing so its status can
 * be read and retried later.
 */
export async function TaskVoiceCommentsEnqueue(
  request: TaskVoiceCommentRequest,
): Promise<TaskVoiceCommentsEnqueueResult> {
  try {
    if (
      !config ||
      !config.DICTATION_ENABLED ||
      !config.IsDictationSttConfigured()
    ) {
      return { queued: false, rateLimited: false };
    }
    if (!request.mimeType || !request.mimeType.startsWith("audio/")) {
      return { queued: false, rateLimited: false };
    }
    if (!consumeRateLimitSlot(request.userId)) {
      logger.warn(
        "[VoiceComments] Hourly transcription limit reached; skipping transcription",
      );
      return { queued: false, rateLimited: true };
    }
    const jobId = uuidv4();
    const language = NormalizeLanguage(
      request.requestedLanguage,
      config.DICTATION_LANGUAGE,
    );
    try {
      await DictationDataCreate({
        id: jobId,
        userId: request.userId,
        source: "voice_comment",
        taskId: request.taskId,
        attachmentId: request.attachmentId ?? null,
        status: "processing",
        stage: "transcribing",
        language,
        engine: config.STT_MODE === "external" ? "external" : "embedded",
        model:
          config.STT_MODE === "embedded"
            ? config.STT_EMBEDDED_MODEL
            : config.STT_MODEL,
        expiresAt: new Date(Date.now() + DICTATION_JOB_TTL_MS).toISOString(),
      });
    } catch (error) {
      // The partial unique index rejects a second processing job for the
      // same attachment (concurrent upload/retry): treat as already queued.
      if (DbUtilsIsUniqueViolation(error)) {
        return { queued: false, rateLimited: false };
      }
      throw error;
    }
    enqueueUserJob(request.userId, () =>
      runVoiceJob(request, jobId, language),
    );
    return { queued: true, rateLimited: false, jobId };
  } catch (error) {
    logger.error(
      `[VoiceComments] Failed to enqueue a voice comment job: ${(error as Error).message}`,
    );
    return { queued: false, rateLimited: false };
  }
}

export interface TaskVoiceTranscriptionStatus {
  attachmentId: string;
  status: string;
  stage: string | null;
  error: string | null;
  dateCreated: string;
  dateUpdated: string;
}

/** Latest persisted voice-comment job of an attachment (status source). */
export async function TaskVoiceCommentsGetLatest(
  attachmentId: string,
): Promise<TaskVoiceTranscriptionStatus | null> {
  const record = await DictationDataGetLatestByAttachment(attachmentId);
  if (!record) {
    return null;
  }
  return {
    attachmentId,
    status: record.status,
    stage: record.stage,
    error: record.error,
    dateCreated: record.dateCreated,
    dateUpdated: record.dateUpdated,
  };
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

/** True when dictation is enabled and an STT engine is configured. */
export function TaskVoiceCommentsIsAvailable(): boolean {
  return !!config && config.DICTATION_ENABLED && config.IsDictationSttConfigured();
}

/** True when the user still has an hourly transcription slot available. */
export function TaskVoiceCommentsCanConsumeRateLimit(userId: string): boolean {
  if (!config) {
    return true;
  }
  const now = Date.now();
  const timestamps = (recentTranscriptions.get(userId) || []).filter(
    (start) => now - start < RATE_LIMIT_WINDOW_MS,
  );
  return timestamps.length < config.RATE_LIMIT_DICTATION_MAX;
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

function enqueueUserJob(userId: string, job: () => Promise<void>): void {
  // Per-user FIFO queue: one transcription at a time, later uploads queue
  // behind the running one so every voice message gets its transcript
  const previous = userQueues.get(userId) || Promise.resolve();
  const next = previous.then(job).catch((error) => {
    logger.error(
      `[VoiceComments] Unexpected failure in a voice comment job: ${(error as Error).message}`,
    );
  });
  userQueues.set(userId, next);
  // Drop the queue entry once this user's chain is idle: settled queues
  // must not accumulate per user for the lifetime of the process
  next.finally(() => {
    if (userQueues.get(userId) === next) {
      userQueues.delete(userId);
    }
  });
}

async function runVoiceJob(
  request: TaskVoiceCommentRequest,
  jobId: string,
  language: string | null,
): Promise<void> {
  const startedAt = Date.now();
  const root = DictationTelemetryStartSpan("dictation.job", undefined, {
    "dictation.job_id": jobId,
    "dictation.source": "voice_comment",
  });
  try {
    const task = await TasksDataGet(request.taskId);
    if (!task) {
      await failJob(jobId, "Task Not Found", startedAt);
      return;
    }
    if (!(await fs.pathExists(request.filePath))) {
      await failJob(jobId, "Audio file not found", startedAt);
      return;
    }

    const sttStart = Date.now();
    const transcription = await DictationTranscribeAudio(
      request.filePath,
      request.mimeType,
      language,
    );
    DictationTelemetryRecordStage("stt", Date.now() - sttStart, "voice_comment");
    await DictationDataUpdate(jobId, {
      rawTranscript: transcription.text,
      audioDurationMs: transcription.audioDurationMs,
      sttMs: transcription.sttMs,
      stage: "polishing",
    });
    DictationNotifyJobChange(jobId);

    const polishStart = Date.now();
    const { polishedText, polished } = await DictationPolishTranscript(
      transcription.text,
      language,
    );
    const polishMs = Date.now() - polishStart;
    DictationTelemetryRecordStage("polish", polishMs, "voice_comment");
    await DictationDataUpdate(jobId, {
      polishedText,
      polished,
      polishMs,
    });
    DictationNotifyJobChange(jobId);

    if (!polishedText.trim()) {
      await failJob(jobId, "No speech detected, please try again.", startedAt);
      return;
    }

    // Idempotent posting: a recovery never posts the transcript twice
    const commentId = await postTranscriptComment(
      request,
      polishedText,
      task,
      jobId,
    );
    await DictationDataUpdate(jobId, {
      commentId,
      status: "done",
      stage: null,
      totalMs: Date.now() - startedAt,
    });
    DictationNotifyJobChange(jobId);
    DictationTelemetryRecordJob("voice_comment", "done", Date.now() - startedAt);
    root.setAttribute("transcript.chars", polishedText.length);
    root.setAttribute("dictation.status", "done");
    logger.info(`[VoiceComments] Job ${jobId} done`);
  } catch (error) {
    root.fail(error);
    const noSpeech = error instanceof SttNoSpeechError;
    if (noSpeech) {
      DictationTelemetryRecordNoSpeech("voice_comment");
    }
    await failJob(
      jobId,
      noSpeech ? NO_SPEECH_ERROR : "Transcription failed, please try again.",
      startedAt,
    );
    // Never rethrow: the upload succeeded independently and the audio
    // attachment stays as the voice message. Never log transcript content.
    logger.error(
      `[VoiceComments] Transcription failed for job ${jobId}: ${(error as Error).message}`,
    );
  } finally {
    root.end();
  }
}

async function postTranscriptComment(
  request: TaskVoiceCommentRequest,
  polishedText: string,
  task: Awaited<ReturnType<typeof TasksDataGet>>,
  jobId: string,
): Promise<string> {
  const record = await DictationDataGet(jobId);
  if (record?.commentId) {
    return record.commentId;
  }

  const existing = (task?.comments || []).find((comment) =>
    (comment.text || "").startsWith(TRANSCRIPT_COMMENT_TOKEN),
  );
  if (existing) {
    return existing.id;
  }

  const commentId = uuidv4();
  const userName =
    request.userName || (await UsersDataGet(request.userId))?.name;
  await addComment(request.taskId, {
    id: commentId,
    userId: request.userId,
    userName,
    text: `${TRANSCRIPT_COMMENT_PREFIX} (${request.fileName}):\n\n${polishedText}`,
    dateCreated: new Date().toISOString(),
  });
  await TasksDataTouch(request.taskId);
  // Same activity entry and assignee push as a comment posted normally
  await recordTaskUpdate(request.taskId, request.userId, "New comment");
  return commentId;
}

async function failJob(
  jobId: string,
  message: string,
  startedAt: number,
): Promise<void> {
  try {
    const totalMs = Date.now() - startedAt;
    await DictationDataUpdate(jobId, {
      status: "error",
      stage: null,
      error: message,
      totalMs,
    });
    DictationNotifyJobChange(jobId);
    DictationTelemetryRecordError("voice_comment", "stt_or_pipeline");
    DictationTelemetryRecordJob("voice_comment", "error", totalMs);
  } catch (error) {
    logger.error(
      `[VoiceComments] Failed to persist the failure of job ${jobId}: ${(error as Error).message}`,
    );
  }
}

export { INTERRUPTED_ERROR };
