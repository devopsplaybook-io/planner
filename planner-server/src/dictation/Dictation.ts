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
  ComputeActionMaxTokens,
  ComputeMaxTokens,
  DictationActionProposal,
  MAX_ACTIONS,
  ParseActionProposals,
  ParsePolishedText,
  POLISH_SYSTEM_PROMPT,
} from "./DictationLlm";
import {
  SttNoSpeechError,
  SttPriority,
  SttWhisperCppCleanStalePartFiles,
  SttWhisperCppGetStatus,
  SttWhisperCppGetThreads,
  SttWhisperCppPrepareModel,
  SttWhisperCppTranscribe,
} from "./SttWhisperCpp";
import {
  DictationJobKind,
  DictationJobRecord,
  DictationJobSource,
  DictationDataCreate,
  DictationDataDeleteExpired,
  DictationDataGet,
  DictationDataGetForUser,
  DictationDataGetInFlightForUser,
  DictationDataListKeptAudio,
  DictationDataListRecent,
  DictationDataListResumable,
  DictationDataMarkInterruptedBeforeStt,
  DictationDataSetAudioState,
  DictationDataUpdate,
} from "./DictationData";
import {
  DictationTelemetryRecordActionProposed,
  DictationTelemetryRecordError,
  DictationTelemetryRecordJob,
  DictationTelemetryRecordNoSpeech,
  DictationTelemetryRecordNotification,
  DictationTelemetryRecordQueue,
  DictationTelemetryRecordStage,
  DictationTelemetryStartSpan,
} from "./DictationTelemetry";
import {
  DICTATION_INTERACTIVE_SOURCES,
  DictationSegment,
  TimestampedTranscriptSegment,
} from "./DictationTypes";
import { NotificationsDictationReady } from "../notifications/Notifications";
import {
  DictationPhraseRecord,
  DictationPhrasesListForUser,
} from "./DictationPhrasesData";
import { MatchCommandPhrase } from "./DictationPhrases";
import { BuildActionsReference } from "./DictationResolution";

const logger = console;

let config: Config;

const VOICE_COMMENT_TTL_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const WAIT_DEFAULT_TIMEOUT_MS = 25 * 1000;
const WAIT_RECHECK_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_SPEECH_ERROR = "No speech detected, please try again.";
const GENERIC_ERROR = "Dictation failed, please try again";
const INTERRUPTED_ERROR = "Interrupted, please record again.";

/**
 * Job lifetime by origin: voice comments stay with their task for an hour,
 * meeting imports follow DICTATION_MEETING_TTL_DAYS and short inbox jobs
 * follow DICTATION_INBOX_TTL_HOURS.
 */
export function DictationJobTtlMs(
  source: DictationJobSource,
  jobKind: DictationJobKind,
): number {
  if (source === "voice_comment") {
    return VOICE_COMMENT_TTL_MS;
  }
  if (jobKind === "meeting") {
    return (config?.DICTATION_MEETING_TTL_DAYS ?? 7) * DAY_MS;
  }
  return (config?.DICTATION_INBOX_TTL_HOURS ?? 168) * 60 * 60 * 1000;
}

// ── Public Interface ──────────────────────────────────────────────────────────

export type DictationStage =
  | "queued"
  | "chunking"
  | "transcribing"
  | "polishing"
  | "actions"
  | "summarizing";
export type DictationStatus = "processing" | "done" | "error";

export interface DictationResult {
  rawTranscript: string;
  polishedText: string;
  polished: boolean;
  actions: DictationActionProposal[];
  actionsAvailable: boolean;
  /** Per-segment confidence (embedded engine only; null otherwise) */
  segments: DictationSegment[] | null;
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
  jobKind: DictationJobKind;
  status: DictationStatus;
  stage: DictationStage | null;
  engine: string;
  language: string | null;
  /** Optional "speak X, write Y" target (null = keep the original language) */
  targetLanguage: string | null;
  revision: number;
  result: DictationResult | null;
  availability: DictationAvailability;
  timings: DictationTimings;
  engineState: "idle" | "downloading" | "ready" | "error";
  error: string | null;
  /** Long-form only: bounded timestamped transcript */
  transcriptSegments: TimestampedTranscriptSegment[] | null;
  summary: string | null;
  decisions: string[];
  segmentsDone: number;
  segmentsTotal: number;
  archivedAt: string | null;
  audioRetained: boolean;
  convertedAt: string | null;
  convertedType: string | null;
  convertedTargetId: string | null;
  dateCreated: string;
  dateUpdated: string;
}

export interface DictationAudioResult {
  text: string;
  audioDurationMs: number | null;
  threads: number;
  sttMs: number;
  segments: DictationSegment[] | null;
}

export interface DictationStartJobOptions {
  /** Composed vocabulary prompt (never persisted or logged) */
  prompt?: string | null;
  /** Number of terms in the prompt, exported as an aggregate counter only */
  hotwordsCount?: number;
  targetLanguage?: string | null;
  /** Client-generated idempotency key (offline queue / share target) */
  clientId?: string | null;
  jobKind?: DictationJobKind;
  /** Queue lane override; short recordings always default to interactive. */
  priority?: SttPriority;
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
        segments: record.segments,
      }
    : null;
  let engineState: DictationJobView["engineState"] = "ready";
  if (record.engine === "embedded" && config) {
    engineState = SttWhisperCppGetStatus(config, record.model ?? undefined).state;
  }
  return {
    jobId: record.id,
    source: record.source,
    jobKind: record.jobKind,
    status: record.status,
    stage: record.stage as DictationStage | null,
    engine: record.engine,
    language: record.language,
    targetLanguage: record.targetLanguage,
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
    transcriptSegments: record.transcriptSegments,
    summary: record.summary,
    decisions: record.decisions,
    segmentsDone: record.segmentsDone,
    segmentsTotal: record.segmentsTotal,
    archivedAt: record.archivedAt,
    audioRetained: record.audioRetained,
    convertedAt: record.convertedAt,
    convertedType: record.convertedType,
    convertedTargetId: record.convertedTargetId,
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
  source: DictationJobSource = "dictation",
  options: DictationStartJobOptions = {},
): Promise<string> {
  const jobId = uuidv4();
  const startedAt = Date.now();
  const jobKind = options.jobKind ?? "short";
  await DictationDataCreate({
    id: jobId,
    userId,
    source,
    jobKind,
    clientId: options.clientId ?? null,
    status: "processing",
    stage: "transcribing",
    language,
    targetLanguage: options.targetLanguage ?? null,
    engine: currentEngine(),
    model: currentModel(),
    expiresAt: new Date(
      startedAt + DictationJobTtlMs(source, jobKind),
    ).toISOString(),
  });
  inFlightJobIds.set(userId, jobId);
  void runDictationJob(
    jobId,
    userId,
    audioFilePath,
    audioMimeType,
    language,
    startedAt,
    source,
    options,
  )
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
  // Short jobs recover like dialog jobs after a restart; quick captures and
  // inline recordings are the same interactive lane.
  const record = await DictationDataGetInFlightForUser(
    userId,
    DICTATION_INTERACTIVE_SOURCES,
    "short",
  );
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
  if (!DICTATION_INTERACTIVE_SOURCES.includes(record.source)) {
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
      record.userId,
      record.rawTranscript,
      record.language,
      record.targetLanguage,
      createdAt,
      root,
      record.source,
      undefined,
      record.jobKind,
    );
  } catch (error) {
    root.fail(error);
    await failJob(jobId, error, createdAt, record.source);
  } finally {
    root.end();
  }
}

/**
 * Removes expired jobs (after removing their kept audio) and enforces the
 * per-user audio retention caps. Returns the number of jobs removed. Exported
 * for tests and called by the periodic sweep timer.
 */
export async function DictationSweepExpiredJobs(
  now: number = Date.now(),
): Promise<number> {
  await DictationCleanupAudioRetention(now);
  return DictationDataDeleteExpired(new Date(now).toISOString());
}

/**
 * Deletes kept audio that outlived its job or the retention window, then the
 * oldest recordings of each user while their total exceeds the cap. Only
 * file paths and sizes are involved: never audio content.
 */
async function DictationCleanupAudioRetention(now: number): Promise<void> {
  if (!config) {
    return;
  }
  const maxBytes =
    Math.max(0, config.DICTATION_AUDIO_KEEP_MAX_MB) * 1024 * 1024;
  const maxAgeMs =
    Math.max(1, config.DICTATION_AUDIO_RETENTION_DAYS) * DAY_MS;
  const records = await DictationDataListKeptAudio();
  const perUser = new Map<
    string,
    { id: string; audioPath: string; size: number }[]
  >();
  for (const record of records) {
    const audioPath = record.audioPath;
    if (!audioPath) {
      continue;
    }
    let size: number;
    try {
      size = (await fs.stat(audioPath)).size;
    } catch {
      // The file is already gone; forget the reference
      await DictationDataSetAudioState(record.id, {
        audioPath: null,
        audioDeletedAt: new Date(now).toISOString(),
      });
      continue;
    }
    const expired =
      Date.parse(record.expiresAt) < now ||
      now - Date.parse(record.dateCreated) > maxAgeMs;
    if (expired) {
      await removeKeptAudio(record.id, audioPath, now);
      continue;
    }
    const list = perUser.get(record.userId) ?? [];
    list.push({ id: record.id, audioPath, size });
    perUser.set(record.userId, list);
  }
  // Entries arrive oldest first (ListKeptAudio order): drop the oldest files
  // until the user's total fits the cap.
  for (const entries of perUser.values()) {
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries) {
      if (total <= maxBytes) {
        break;
      }
      await removeKeptAudio(entry.id, entry.audioPath, now);
      total -= entry.size;
    }
  }
}

async function removeKeptAudio(
  jobId: string,
  audioPath: string,
  now: number,
): Promise<void> {
  try {
    await fs.remove(audioPath);
  } catch {
    // Best effort: the reference is cleared either way
  }
  await DictationDataSetAudioState(jobId, {
    audioPath: null,
    audioDeletedAt: new Date(now).toISOString(),
  });
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
    // Long-form jobs keep durable audio: they resume from their persisted
    // progress instead of failing. Chunk work files belong to dead processes.
    await fs.remove(path.join(config.DATA_DIR, "dictation-work")).catch(
      () => undefined,
    );
    try {
      const { DictationLongformStartupRecovery } = await import(
        "./DictationLongform"
      );
      await DictationLongformStartupRecovery();
    } catch (error) {
      logger.error(
        `[Dictation] Long-form startup recovery failed: ${(error as Error).message}`,
      );
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
  userId: string,
  audioFilePath: string,
  audioMimeType: string,
  language: string | null,
  startedAt: number,
  source: DictationJobSource,
  options: DictationStartJobOptions = {},
): Promise<void> {
  const root = DictationTelemetryStartSpan("dictation.job", undefined, {
    "dictation.job_id": jobId,
    "dictation.source": source,
  });
  root.setAttribute("stt.hotwords.count", options.hotwordsCount ?? 0);
  try {
    const queueMs = Math.max(0, Date.now() - startedAt);
    const queueSpan = DictationTelemetryStartSpan("dictation.queue");
    queueSpan.setAttribute("dictation.queue_ms", queueMs);
    queueSpan.end();
    DictationTelemetryRecordQueue(queueMs, source);

    const sttStart = Date.now();
    let transcription: DictationAudioResult;
    try {
      transcription = await DictationTranscribeAudio(
        audioFilePath,
        audioMimeType,
        language,
        { prompt: options.prompt, priority: options.priority },
      );
    } finally {
      // No audio retention: delete the temp file right after the STT call,
      // success or failure
      await deleteAudioFile(audioFilePath);
    }
    DictationTelemetryRecordStage("stt", Date.now() - sttStart, source);
    annotateConfidence(root, transcription.segments);

    await DictationDataUpdate(jobId, {
      rawTranscript: transcription.text,
      segments: transcription.segments,
      audioDurationMs: transcription.audioDurationMs,
      sttMs: transcription.sttMs,
      queueMs,
      stage: "polishing",
    });
    DictationNotifyJobChange(jobId);

    await runPostTranscription(
      jobId,
      userId,
      transcription.text,
      language,
      options.targetLanguage ?? null,
      startedAt,
      root,
      source,
      transcription,
      options.jobKind ?? "short",
    );
  } catch (error) {
    root.fail(error);
    await failJob(jobId, error, startedAt, source);
  } finally {
    await deleteAudioFile(audioFilePath);
    root.end();
  }
}

/**
 * Adds aggregate confidence counters to the job span: only counts are
 * exported, never segment text (privacy requirement).
 */
function annotateConfidence(
  root: ReturnType<typeof DictationTelemetryStartSpan>,
  segments: DictationSegment[] | null,
): void {
  const list = segments || [];
  root.setAttribute("stt.segments.count", list.length);
  const threshold = config?.DICTATION_CONFIDENCE_THRESHOLD ?? 0.6;
  const low = list.filter(
    (segment) =>
      segment.confidence !== null && segment.confidence < threshold,
  ).length;
  root.setAttribute("stt.low_confidence.count", low);
}

/**
 * Turns a matched custom phrase into its deterministic proposal: a template
 * instantiation, or a task in the phrase project with the phrase labels.
 */
function BuildPhraseAction(
  phrase: DictationPhraseRecord,
  remainder: string,
): DictationActionProposal {
  const text = remainder.trim();
  if (phrase.templateId) {
    return {
      type: "instantiate_template",
      template: phrase.templateId,
      ...(text ? { title: text.slice(0, 200) } : {}),
    };
  }
  const firstLine = text.split(/\r?\n/)[0].trim();
  return {
    type: "create_task",
    title: (firstLine || phrase.phrase).slice(0, 200),
    description: text.slice(0, 5000),
    ...(phrase.projectId ? { project: phrase.projectId } : {}),
    ...(phrase.labels.length > 0 ? { labels: phrase.labels } : {}),
  };
}

async function runPostTranscription(
  jobId: string,
  userId: string,
  rawTranscript: string,
  language: string | null,
  targetLanguage: string | null,
  startedAt: number,
  root: ReturnType<typeof DictationTelemetryStartSpan>,
  source: DictationJobSource,
  transcription?: DictationAudioResult,
  jobKind: DictationJobKind = "short",
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
    targetLanguage,
  );
  const polishMs = Date.now() - polishStart;
  DictationTelemetryRecordStage("polish", polishMs, source);
  await DictationDataUpdate(jobId, {
    polishedText,
    polished,
    polishMs,
    stage: "actions",
  });
  DictationNotifyJobChange(jobId);

  // Stage C: deterministic custom phrase first, then LLM proposals on the
  // remaining text. A phrase match always yields its action, even without an
  // LLM key; the LLM is skipped when the remainder is empty.
  let actions: DictationActionProposal[] = [];
  let actionsAvailable = false;
  let actionsMs = 0;
  let promptText = polishedText;
  let phraseMatched = false;
  try {
    const phrases = await DictationPhrasesListForUser(userId);
    const match = MatchCommandPhrase(polishedText, phrases);
    if (match) {
      actions.push(BuildPhraseAction(match.phrase, match.remainder));
      actionsAvailable = true;
      phraseMatched = true;
      promptText = match.remainder;
    }
  } catch (error) {
    // Phrase matching is best-effort: fall back to the full transcript
    logger.warn(
      `[Dictation] Phrase lookup failed for job ${jobId}: ${(error as Error).message}`,
    );
  }

  const shouldCallLlm =
    !!config.LLM_API_KEY && (!phraseMatched || promptText.trim().length > 0);
  if (shouldCallLlm) {
    const actionsStart = Date.now();
    const actionsSpan = DictationTelemetryStartSpan("dictation.actions");
    try {
      const reference = await BuildActionsReference(userId);
      const content = await callLLMWithRetry(
        ACTIONS_SYSTEM_PROMPT,
        BuildActionsPrompt(promptText, language, new Date(), reference),
        ComputeActionMaxTokens(promptText),
      );
      const parsed = ParseActionProposals(content);
      if (parsed) {
        actions.push(...parsed);
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
    DictationTelemetryRecordStage("actions", actionsMs, source);
  }
  actions = actions.slice(0, MAX_ACTIONS);
  for (const action of actions) {
    DictationTelemetryRecordActionProposed(action.type);
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
  DictationTelemetryRecordJob(source, "done", totalMs);
  root.setAttribute("dictation.status", "done");
  await DictationNotifyReady(jobId, userId, jobKind);
  logger.info(`[Dictation] Job ${jobId} done`);
}

/**
 * Best-effort "dictation ready" push. Never throws: a push failure must not
 * fail the job, and only ids/kinds reach telemetry.
 */
export async function DictationNotifyReady(
  jobId: string,
  userId: string,
  jobKind: DictationJobKind,
): Promise<void> {
  try {
    const sent = await NotificationsDictationReady(userId, { id: jobId, jobKind });
    DictationTelemetryRecordNotification(sent ? "sent" : "skipped", jobKind);
  } catch {
    DictationTelemetryRecordNotification("error", jobKind);
  }
}

async function failJob(
  jobId: string,
  error: unknown,
  startedAt: number,
  source: DictationJobSource,
): Promise<void> {
  const noSpeech = error instanceof SttNoSpeechError;
  const message = noSpeech ? NO_SPEECH_ERROR : GENERIC_ERROR;
  logger.error(`[Dictation] Job ${jobId} failed: ${(error as Error).message}`);
  DictationTelemetryRecordError(source, "stt_or_pipeline");
  if (noSpeech) {
    DictationTelemetryRecordNoSpeech(source);
  }
  await DictationDataUpdate(jobId, {
    status: "error",
    stage: null,
    error: message,
    totalMs: Date.now() - startedAt,
  });
  DictationNotifyJobChange(jobId);
  DictationTelemetryRecordJob(source, "error", Date.now() - startedAt);
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
  options: { prompt?: string | null; priority?: SttPriority } = {},
): Promise<DictationAudioResult> {
  if (config.STT_MODE === "embedded") {
    return SttWhisperCppTranscribe(
      config,
      audioFilePath,
      audioMimeType,
      language,
      {
        prompt: options.prompt ?? null,
        priority: options.priority === "batch" ? "batch" : "interactive",
      },
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
    const postTranscription = async (withPrompt: boolean) => {
      const form = new FormData();
      form.append("model", config.STT_MODEL);
      form.append(
        "file",
        new Blob([audioBuffer], { type: audioMimeType }),
        "audio",
      );
      if (language) {
        form.append("language", language);
      }
      if (withPrompt && options.prompt) {
        form.append("prompt", options.prompt);
      }
      return axios.post(url, form, {
        headers: {
          Authorization: `Bearer ${config.STT_API_KEY}`,
        },
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    };
    let response;
    try {
      response = await postTranscription(!!options.prompt);
    } catch (error) {
      // Vocabulary must never break a previously working endpoint: retry
      // once without the optional prompt when the field is rejected.
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (options.prompt && (status === 400 || status === 422)) {
        logger.warn(
          "[Dictation] STT endpoint rejected the vocabulary prompt, retrying without it",
        );
        response = await postTranscription(false);
      } else {
        throw error;
      }
    }
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
      // The OpenAI-compatible API returns text only: no confidence data
      segments: null,
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
  targetLanguage: string | null = null,
): Promise<{ polishedText: string; polished: boolean }> {
  if (!config.LLM_API_KEY) {
    return { polishedText: transcript, polished: false };
  }
  try {
    const content = await callLLMWithRetry(
      POLISH_SYSTEM_PROMPT,
      BuildPolishPrompt(transcript, language, targetLanguage),
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
  options: { prompt?: string | null } = {},
): Promise<{
  rawTranscript: string;
  polishedText: string;
  polished: boolean;
  sttMs: number;
  polishMs: number;
  audioDurationMs: number | null;
  threads: number;
  segments: DictationSegment[] | null;
}> {
  const transcription = await DictationTranscribeAudio(
    audioFilePath,
    audioMimeType,
    language,
    options,
  );
  const polishStart = Date.now();
  // Voice comments keep the spoken language: comments on existing content
  // are never translated.
  const { polishedText, polished } = await DictationPolishTranscript(
    transcription.text,
    language,
    null,
  );
  return {
    rawTranscript: transcription.text,
    polishedText,
    polished,
    sttMs: transcription.sttMs,
    polishMs: Date.now() - polishStart,
    audioDurationMs: transcription.audioDurationMs,
    threads: transcription.threads,
    segments: transcription.segments,
  };
}

// ── LLM API call with retry ───────────────────────────────────────────────────

/**
 * Runs one completion with the dictation retry policy. Exported for the
 * long-form summarizer, which shares the same endpoint and key.
 */
export async function DictationLlmComplete(
  systemPrompt: string,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  return callLLMWithRetry(systemPrompt, prompt, maxTokens);
}

/** Whether an LLM is configured (translation, polish, summaries, actions). */
export function DictationIsLlmConfigured(): boolean {
  return !!config?.LLM_API_KEY;
}

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
