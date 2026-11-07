import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Config } from "../Config";
import { ReadEffectiveCpuCount } from "../utils/CpuLimits";
import {
  ACTIONS_SYSTEM_PROMPT,
  BuildActionsPrompt,
  BuildPolishPrompt,
  ComputeMaxTokens,
  DictationActionProposal,
  ParseActionProposals,
  ParsePolishedText,
  POLISH_SYSTEM_PROMPT,
} from "./DictationLlm";
import {
  SttNoSpeechError,
  SttWhisperCppCleanStalePartFiles,
  SttWhisperCppGetStatus,
  SttWhisperCppGetThreads,
  SttWhisperCppPrepareModel,
  SttWhisperCppTranscribe,
} from "./SttWhisperCpp";
import {
  DictationJobRecord,
  DictationJobSource,
  DictationDataCreate,
  DictationDataDeleteExpired,
  DictationDataGet,
  DictationDataGetForUser,
  DictationDataGetInFlightForUser,
  DictationDataListRecent,
  DictationDataListResumable,
  DictationDataMarkInterruptedBeforeStt,
  DictationDataUpdate,
} from "./DictationData";
import {
  DictationTelemetryRecordError,
  DictationTelemetryRecordJob,
  DictationTelemetryRecordNoSpeech,
  DictationTelemetryRecordQueue,
  DictationTelemetryRecordStage,
  DictationTelemetryStartSpan,
} from "./DictationTelemetry";

const logger = console;

let config: Config;

const DICTATION_JOB_TTL_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const WAIT_DEFAULT_TIMEOUT_MS = 25 * 1000;
const WAIT_RECHECK_MS = 1000;
const NO_SPEECH_ERROR = "No speech detected, please try again.";
const GENERIC_ERROR = "Dictation failed, please try again";
const INTERRUPTED_ERROR = "Interrupted, please record again.";

// ── Public Interface ──────────────────────────────────────────────────────────

export type DictationStage = "transcribing" | "polishing" | "actions";
export type DictationStatus = "processing" | "done" | "error";

export interface DictationResult {
  rawTranscript: string;
  polishedText: string;
  polished: boolean;
  actions: DictationActionProposal[];
  actionsAvailable: boolean;
}

export interface DictationAvailability {
  rawTranscript: boolean;
  polishedText: boolean;
  actions: boolean;
}

export interface DictationTimings {
  queueMs: number | null;
  sttMs: number | null;
  polishMs: number | null;
  actionsMs: number | null;
  totalMs: number | null;
  audioDurationMs: number | null;
}

export interface DictationJobView {
  jobId: string;
  source: DictationJobSource;
  status: DictationStatus;
  stage: DictationStage | null;
  engine: string;
  language: string | null;
  revision: number;
  result: DictationResult | null;
  availability: DictationAvailability;
  timings: DictationTimings;
  engineState: "idle" | "downloading" | "ready" | "error";
  error: string | null;
  dateCreated: string;
  dateUpdated: string;
}

export interface DictationAudioResult {
  text: string;
  audioDurationMs: number | null;
  threads: number;
  sttMs: number;
}

export async function DictationInit(configIn: Config): Promise<void> {
  config = configIn;
  startSweepTimer();
  // Resolve jobs left by a previous process: audio is never reused, so a
  // pre-STT job becomes an error and a post-STT job resumes from its text.
  await DictationStartupRecovery();
  if (configIn.DICTATION_ENABLED && configIn.STT_MODE === "embedded" && configIn.STT_EMBEDDED_MODEL) {
    const threads = SttWhisperCppGetThreads(configIn);
    logger.info(
      `[SttWhisperCpp] CPUs: cgroup=${ReadEffectiveCpuCount()}, os=${os.cpus().length}, threads=${threads}`,
    );
    logger.info(
      `[Dictation] Enabled (embedded STT model: ${configIn.STT_EMBEDDED_MODEL}, language: ${configIn.DICTATION_LANGUAGE})`,
    );
    await SttWhisperCppCleanStalePartFiles(configIn);
    // Never awaited: readiness (/api/status) must not wait for the download
    void SttWhisperCppPrepareModel(configIn).catch((error) => {
      logger.error(
        `[Dictation] Embedded STT model preparation failed: ${(error as Error).message}`,
      );
    });
  } else if (configIn.DICTATION_ENABLED && configIn.STT_API_URL && configIn.STT_API_KEY) {
    logger.info(
      `[Dictation] Enabled (STT model: ${configIn.STT_MODEL}, language: ${configIn.DICTATION_LANGUAGE})`,
    );
  } else {
    logger.info("[Dictation] Feature disabled (not enabled or STT not configured)");
  }
}

// ── Job store (database-backed, revision + in-process notifier) ───────────────

// userId -> job id of the running plain dictation (single-flight per user)
const inFlightJobIds = new Map<string, string>();
// jobId -> long-poll waiters resolved on every persisted change
const waiters = new Map<string, Set<() => void>>();

function buildView(record: DictationJobRecord): DictationJobView {
  const hasRaw = !!record.rawTranscript;
  const result: DictationResult | null = hasRaw
    ? {
        rawTranscript: record.rawTranscript as string,
        polishedText: record.polishedText,
        polished: record.polished,
        actions: record.actions,
        actionsAvailable: record.actionsAvailable,
      }
    : null;
  let engineState: DictationJobView["engineState"] = "ready";
  if (record.engine === "embedded" && config) {
    engineState = SttWhisperCppGetStatus(config, record.model ?? undefined).state;
  }
  return {
    jobId: record.id,
    source: record.source,
    status: record.status,
    stage: record.stage as DictationStage | null,
    engine: record.engine,
    language: record.language,
    revision: record.revision,
    result,
    availability: {
      rawTranscript: hasRaw,
      polishedText: record.polishedText !== null,
      actions: record.actionsAvailable,
    },
    timings: {
      queueMs: record.queueMs,
      sttMs: record.sttMs,
      polishMs: record.polishMs,
      actionsMs: record.actionsMs,
      totalMs: record.totalMs,
      audioDurationMs: record.audioDurationMs,
    },
    engineState,
    error: record.error,
    dateCreated: record.dateCreated,
    dateUpdated: record.dateUpdated,
  };
}

function currentEngine(): string {
  return config?.STT_MODE === "external" ? "external" : "embedded";
}

function currentModel(): string | null {
  if (!config) {
    return null;
  }
  return config.STT_MODE === "embedded"
    ? config.STT_EMBEDDED_MODEL
    : config.STT_MODEL;
}

/**
 * Starts a background dictation job for the uploaded audio file. The caller
 * must have checked DictationGetInFlightJobId first (single-flight per user).
 * The audio file is deleted by the pipeline right after transcription.
 */
export async function DictationStartJob(
  userId: string,
  audioFilePath: string,
  audioMimeType: string,
  language: string | null,
): Promise<string> {
  const jobId = uuidv4();
  const startedAt = Date.now();
  await DictationDataCreate({
    id: jobId,
    userId,
    source: "dictation",
    status: "processing",
    stage: "transcribing",
    language,
    engine: currentEngine(),
    model: currentModel(),
    expiresAt: new Date(startedAt + DICTATION_JOB_TTL_MS).toISOString(),
  });
  inFlightJobIds.set(userId, jobId);
  void runDictationJob(jobId, audioFilePath, audioMimeType, language, startedAt)
    .catch((error) => {
      logger.error(
        `[Dictation] Unexpected failure in job ${jobId}: ${(error as Error).message}`,
      );
    })
    .finally(() => {
      if (inFlightJobIds.get(userId) === jobId) {
        inFlightJobIds.delete(userId);
      }
    });
  return jobId;
}

/**
 * Returns the id of the job currently running for the user, if any.
 */
export async function DictationGetInFlightJobId(
  userId: string,
): Promise<string | null> {
  const inFlight = inFlightJobIds.get(userId);
  if (inFlight) {
    return inFlight;
  }
  const record = await DictationDataGetInFlightForUser(userId, "dictation");
  if (record && Date.parse(record.expiresAt) >= Date.now()) {
    return record.id;
  }
  return null;
}

/**
 * Returns the view of a job when it exists, belongs to the user and has not
 * expired; null otherwise.
 */
export async function DictationGetJob(
  userId: string,
  jobId: string,
): Promise<DictationJobView | null> {
  const record = await DictationDataGetForUser(userId, jobId);
  if (!record || Date.parse(record.expiresAt) < Date.now()) {
    return null;
  }
  return buildView(record);
}

/** Recent non-expired jobs of the user (bounded), newest first. */
export async function DictationGetRecentJobs(
  userId: string,
  limit = 20,
  source?: DictationJobSource,
): Promise<DictationJobView[]> {
  const records = await DictationDataListRecent(userId, source, limit);
  return records.map(buildView);
}

/**
 * Long-poll: returns as soon as the job revision is newer than `since` or
 * the job is terminal, otherwise waits for an in-process notification with
 * a 1 s database re-check, bounded by `timeoutMs`.
 */
export async function DictationWaitForJob(
  userId: string,
  jobId: string,
  sinceRevision: number,
  timeoutMs = WAIT_DEFAULT_TIMEOUT_MS,
): Promise<DictationJobView | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let view = await DictationGetJob(userId, jobId);
  if (!view) {
    return null;
  }
  while (
    view.revision <= sinceRevision &&
    view.status === "processing" &&
    Date.now() < deadline
  ) {
    const remaining = deadline - Date.now();
    await waitForNotification(jobId, Math.min(WAIT_RECHECK_MS, remaining));
    view = await DictationGetJob(userId, jobId);
    if (!view) {
      return null;
    }
  }
  return view;
}

/** Resolves the waiters of a job as soon as a change is persisted. */
export function DictationNotifyJobChange(jobId: string): void {
  const set = waiters.get(jobId);
  if (!set) {
    return;
  }
  waiters.delete(jobId);
  for (const resolve of set) {
    resolve();
  }
}

function waitForNotification(
  jobId: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      waiters.get(jobId)?.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    let set = waiters.get(jobId);
    if (!set) {
      set = new Set();
      waiters.set(jobId, set);
    }
    set.add(finish);
  });
}

/**
 * Re-runs polish/actions for a job interrupted after STT, using the
 * persisted raw transcript (its audio is gone). Voice-comment jobs cannot be
 * resumed this way and are marked as failed for retry.
 */
export async function DictationResumeJob(jobId: string): Promise<void> {
  const record = await DictationDataGet(jobId);
  if (!record || record.status !== "processing") {
    return;
  }
  if (!record.rawTranscript) {
    return;
  }
  if (record.source !== "dictation") {
    await DictationDataUpdate(jobId, {
      status: "error",
      stage: null,
      error: "Transcription interrupted, please retry.",
      totalMs: Date.now() - Date.parse(record.dateCreated),
    });
    DictationNotifyJobChange(jobId);
    return;
  }
  const createdAt = Date.parse(record.dateCreated) || Date.now();
  const root = DictationTelemetryStartSpan("dictation.job", undefined, {
    "dictation.job_id": jobId,
    "dictation.source": record.source,
    "dictation.resumed": true,
  });
  try {
    await runPostTranscription(
      jobId,
      record.rawTranscript,
      record.language,
      createdAt,
      root,
    );
  } catch (error) {
    root.fail(error);
    await failJob(jobId, error, createdAt);
  } finally {
    root.end();
  }
}

/**
 * Removes expired jobs. Returns the number of jobs removed. Exported for
 * tests and called by the periodic sweep timer.
 */
export async function DictationSweepExpiredJobs(): Promise<number> {
  return DictationDataDeleteExpired();
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function startSweepTimer(): void {
  if (sweepTimer) {
    return;
  }
  sweepTimer = setInterval(() => {
    void (async () => {
      try {
        await DictationSweepExpiredJobs();
        await cleanupTempFiles(TEMP_FILE_MAX_AGE_MS);
      } catch {
        // Never let the sweep break the process
      }
    })();
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

async function cleanupTempFiles(maxAgeMs: number | null): Promise<number> {
  const dir = path.join(config?.TMP_DIR || "/tmp", "dictation");
  if (!(await fs.pathExists(dir))) {
    return 0;
  }
  const now = Date.now();
  let removed = 0;
  for (const file of await fs.readdir(dir)) {
    const filePath = path.join(dir, file);
    try {
      if (maxAgeMs !== null) {
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs < maxAgeMs) {
          continue;
        }
      }
      await fs.remove(filePath);
      removed++;
    } catch {
      // A file removed concurrently is fine
    }
  }
  return removed;
}

async function DictationStartupRecovery(): Promise<void> {
  try {
    // Single backend replica: every temp file belongs to a dead process
    const removedFiles = await cleanupTempFiles(null);
    if (removedFiles > 0) {
      logger.info(
        `[Dictation] Removed ${removedFiles} orphaned temporary file(s) at startup`,
      );
    }
    const interrupted = await DictationDataMarkInterruptedBeforeStt(
      INTERRUPTED_ERROR,
    );
    if (interrupted > 0) {
      logger.info(
        `[Dictation] Marked ${interrupted} job(s) interrupted before transcription`,
      );
    }
    const resumable = await DictationDataListResumable();
    for (const record of resumable) {
      void DictationResumeJob(record.id).catch((error) => {
        logger.error(
          `[Dictation] Failed to resume job ${record.id}: ${(error as Error).message}`,
        );
      });
    }
  } catch (error) {
    logger.error(
      `[Dictation] Startup recovery failed: ${(error as Error).message}`,
    );
  }
}

// ── Background pipeline ───────────────────────────────────────────────────────

async function runDictationJob(
  jobId: string,
  audioFilePath: string,
  audioMimeType: string,
  language: string | null,
  startedAt: number,
): Promise<void> {
  const root = DictationTelemetryStartSpan("dictation.job", undefined, {
    "dictation.job_id": jobId,
    "dictation.source": "dictation",
  });
  try {
    const queueMs = Math.max(0, Date.now() - startedAt);
    const queueSpan = DictationTelemetryStartSpan("dictation.queue");
    queueSpan.setAttribute("dictation.queue_ms", queueMs);
    queueSpan.end();
    DictationTelemetryRecordQueue(queueMs, "dictation");

    const sttStart = Date.now();
    let transcription: DictationAudioResult;
    try {
      transcription = await DictationTranscribeAudio(
        audioFilePath,
        audioMimeType,
        language,
      );
    } finally {
      // No audio retention: delete the temp file right after the STT call,
      // success or failure
      await deleteAudioFile(audioFilePath);
    }
    DictationTelemetryRecordStage("stt", Date.now() - sttStart, "dictation");

    await DictationDataUpdate(jobId, {
      rawTranscript: transcription.text,
      audioDurationMs: transcription.audioDurationMs,
      sttMs: transcription.sttMs,
      queueMs,
      stage: "polishing",
    });
    DictationNotifyJobChange(jobId);

    await runPostTranscription(
      jobId,
      transcription.text,
      language,
      startedAt,
      root,
      transcription,
    );
  } catch (error) {
    root.fail(error);
    await failJob(jobId, error, startedAt);
  } finally {
    await deleteAudioFile(audioFilePath);
    root.end();
  }
}

async function runPostTranscription(
  jobId: string,
  rawTranscript: string,
  language: string | null,
  startedAt: number,
  root: ReturnType<typeof DictationTelemetryStartSpan>,
  transcription?: DictationAudioResult,
): Promise<void> {
  root.setAttribute("transcript.chars", rawTranscript.length);
  if (transcription) {
    root.setAttribute("audio.duration_ms", transcription.audioDurationMs ?? 0);
    root.setAttribute("stt.threads", transcription.threads);
  }

  // Stage B: LLM polish (falls back to the raw transcript on failure)
  const polishStart = Date.now();
  const { polishedText, polished } = await DictationPolishTranscript(
    rawTranscript,
    language,
  );
  const polishMs = Date.now() - polishStart;
  DictationTelemetryRecordStage("polish", polishMs, "dictation");
  await DictationDataUpdate(jobId, {
    polishedText,
    polished,
    polishMs,
    stage: "actions",
  });
  DictationNotifyJobChange(jobId);

  // Stage C: LLM action proposals (skipped on failure)
  let actions: DictationActionProposal[] = [];
  let actionsAvailable = false;
  let actionsMs = 0;
  if (config.LLM_API_KEY) {
    const actionsStart = Date.now();
    const actionsSpan = DictationTelemetryStartSpan("dictation.actions");
    try {
      const content = await callLLMWithRetry(
        ACTIONS_SYSTEM_PROMPT,
        BuildActionsPrompt(polishedText, language),
        ComputeMaxTokens(polishedText),
      );
      const parsed = ParseActionProposals(content);
      if (parsed) {
        actions = parsed;
        actionsAvailable = true;
      } else {
        logger.warn(`[Dictation] Unparseable actions response for job ${jobId}`);
      }
    } catch (error) {
      actionsSpan.fail(error);
      logger.warn(
        `[Dictation] Actions failed for job ${jobId}: ${(error as Error).message}`,
      );
    } finally {
      actionsMs = Date.now() - actionsStart;
      actionsSpan.end();
    }
    DictationTelemetryRecordStage("actions", actionsMs, "dictation");
  }

  const totalMs = Date.now() - startedAt;
  await DictationDataUpdate(jobId, {
    actions,
    actionsAvailable,
    actionsMs,
    status: "done",
    stage: null,
    totalMs,
  });
  DictationNotifyJobChange(jobId);
  DictationTelemetryRecordJob("dictation", "done", totalMs);
  root.setAttribute("dictation.status", "done");
  logger.info(`[Dictation] Job ${jobId} done`);
}

async function failJob(
  jobId: string,
  error: unknown,
  startedAt: number,
): Promise<void> {
  const noSpeech = error instanceof SttNoSpeechError;
  const message = noSpeech ? NO_SPEECH_ERROR : GENERIC_ERROR;
  logger.error(`[Dictation] Job ${jobId} failed: ${(error as Error).message}`);
  DictationTelemetryRecordError("dictation", "stt_or_pipeline");
  if (noSpeech) {
    DictationTelemetryRecordNoSpeech("dictation");
  }
  await DictationDataUpdate(jobId, {
    status: "error",
    stage: null,
    error: message,
    totalMs: Date.now() - startedAt,
  });
  DictationNotifyJobChange(jobId);
  DictationTelemetryRecordJob("dictation", "error", Date.now() - startedAt);
}

async function deleteAudioFile(audioFilePath: string): Promise<void> {
  try {
    await fs.remove(audioFilePath);
  } catch (error) {
    logger.error(
      `[Dictation] Failed to delete the temporary audio file: ${(error as Error).message}`,
    );
  }
}

// ── STT API call ──────────────────────────────────────────────────────────────

/**
 * Transcribes an audio file with the configured STT engine (embedded
 * whisper.cpp or an external OpenAI-compatible endpoint). Never deletes the
 * file — retention is the caller's responsibility. Exported so the voice
 * comment feature can reuse the exact dictation STT stage.
 */
export async function DictationTranscribeAudio(
  audioFilePath: string,
  audioMimeType: string,
  language: string | null,
): Promise<DictationAudioResult> {
  if (config.STT_MODE === "embedded") {
    return SttWhisperCppTranscribe(
      config,
      audioFilePath,
      audioMimeType,
      language,
    );
  }
  const span = DictationTelemetryStartSpan("dictation.stt", undefined, {
    "stt.engine": "external",
    "stt.model": config.STT_MODEL,
  });
  const start = Date.now();
  try {
    const url = `${config.STT_API_URL.replace(/\/+$/, "")}/v1/audio/transcriptions`;
    const audioBuffer = await fs.readFile(audioFilePath);
    const form = new FormData();
    form.append("model", config.STT_MODEL);
    form.append("file", new Blob([audioBuffer], { type: audioMimeType }), "audio");
    if (language) {
      form.append("language", language);
    }
    const response = await axios.post(url, form, {
      headers: {
        Authorization: `Bearer ${config.STT_API_KEY}`,
      },
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const text = response.data?.text;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("STT returned an empty transcript");
    }
    const trimmed = text.trim();
    span.setAttribute("transcript.chars", trimmed.length);
    return {
      text: trimmed,
      audioDurationMs: null,
      threads: 0,
      sttMs: Date.now() - start,
    };
  } catch (error) {
    span.fail(error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Polishes a raw transcript with the LLM (Stage B), falling back to the raw
 * transcript on any LLM failure or unparseable response. Exported so the
 * voice comment feature reuses the exact dictation polish stage.
 */
export async function DictationPolishTranscript(
  transcript: string,
  language: string | null,
): Promise<{ polishedText: string; polished: boolean }> {
  if (!config.LLM_API_KEY) {
    return { polishedText: transcript, polished: false };
  }
  try {
    const content = await callLLMWithRetry(
      POLISH_SYSTEM_PROMPT,
      BuildPolishPrompt(transcript, language),
      ComputeMaxTokens(transcript),
    );
    const parsed = ParsePolishedText(content);
    if (parsed) {
      return { polishedText: parsed, polished: true };
    }
    logger.warn("[Dictation] Unparseable polish response");
    return { polishedText: transcript, polished: false };
  } catch (error) {
    logger.warn(
      `[Dictation] Polish failed: ${(error as Error).message}`,
    );
    return { polishedText: transcript, polished: false };
  }
}

/**
 * STT + LLM polish for audio that is kept by the caller (voice comments):
 * never deletes the audio file and never proposes actions. The raw
 * transcript is returned alongside the polished text so callers can
 * distinguish polish fallbacks.
 */
export async function DictationTranscribeAndPolish(
  audioFilePath: string,
  audioMimeType: string,
  language: string | null,
): Promise<{
  rawTranscript: string;
  polishedText: string;
  polished: boolean;
  sttMs: number;
  polishMs: number;
  audioDurationMs: number | null;
  threads: number;
}> {
  const transcription = await DictationTranscribeAudio(
    audioFilePath,
    audioMimeType,
    language,
  );
  const polishStart = Date.now();
  const { polishedText, polished } = await DictationPolishTranscript(
    transcription.text,
    language,
  );
  return {
    rawTranscript: transcription.text,
    polishedText,
    polished,
    sttMs: transcription.sttMs,
    polishMs: Date.now() - polishStart,
    audioDurationMs: transcription.audioDurationMs,
    threads: transcription.threads,
  };
}

// ── LLM API call with retry ───────────────────────────────────────────────────

async function callLLMWithRetry(
  systemPrompt: string,
  prompt: string,
  maxTokens: number,
  maxRetries = 3,
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.post(
        config.LLM_API_URL,
        {
          model: config.LLM_MODEL,
          temperature: 0.3,
          max_tokens: maxTokens,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.LLM_API_KEY}`,
          },
          timeout: 60000,
        },
      );
      return response.data?.choices?.[0]?.message?.content || "";
    } catch (error) {
      lastError = error as Error;
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status && status < 500 && status !== 429) {
        throw error;
      }
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn(
          `[Dictation] LLM API attempt ${attempt + 1} failed (status=${status}), retrying in ${delay}ms: ${lastError.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError || new Error("LLM API call failed after retries");
}
