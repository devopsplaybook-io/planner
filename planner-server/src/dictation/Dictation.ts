import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs-extra";
import { Config } from "../Config";
import {
  ACTIONS_SYSTEM_PROMPT,
  BuildActionsPrompt,
  BuildPolishPrompt,
  DictationActionProposal,
  ParseActionProposals,
  ParsePolishedText,
  POLISH_SYSTEM_PROMPT,
} from "./DictationLlm";
import { SttWhisperCppTranscribe } from "./SttWhisperCpp";

const logger = console;

let config: Config;

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

export interface DictationJobView {
  jobId: string;
  status: DictationStatus;
  stage: DictationStage | null;
  result: DictationResult | null;
  error: string | null;
}

export async function DictationInit(configIn: Config): Promise<void> {
  config = configIn;
  startSweepTimer();
  if (configIn.DICTATION_ENABLED && configIn.STT_MODE === "embedded" && configIn.STT_EMBEDDED_MODEL) {
    logger.info(
      `[Dictation] Enabled (embedded STT model: ${configIn.STT_EMBEDDED_MODEL}, language: ${configIn.DICTATION_LANGUAGE})`,
    );
  } else if (configIn.DICTATION_ENABLED && configIn.STT_API_URL && configIn.STT_API_KEY) {
    logger.info(
      `[Dictation] Enabled (STT model: ${configIn.STT_MODEL}, language: ${configIn.DICTATION_LANGUAGE})`,
    );
  } else {
    logger.info("[Dictation] Feature disabled (not enabled or STT not configured)");
  }
}

// ── Job store (in-memory, TTL, single-flight per user) ────────────────────────

const DICTATION_JOB_TTL_MS = 60 * 60 * 1000;

interface DictationJob extends DictationJobView {
  userId: string;
  expiresAt: number;
}

const jobs = new Map<string, DictationJob>();
const inFlightJobIds = new Map<string, string>(); // userId -> jobId

/**
 * Starts a background dictation job for the uploaded audio file. The caller
 * must have checked DictationGetInFlightJobId first (single-flight per user).
 * The audio file is deleted by the pipeline right after transcription.
 */
export function DictationStartJob(
  userId: string,
  audioFilePath: string,
  audioMimeType: string,
  language: string | null,
): string {
  const jobId = uuidv4();
  const now = Date.now();
  const job: DictationJob = {
    jobId,
    userId,
    status: "processing",
    stage: "transcribing",
    result: null,
    error: null,
    expiresAt: now + DICTATION_JOB_TTL_MS,
  };
  jobs.set(jobId, job);
  inFlightJobIds.set(userId, jobId);
  runJob(job, audioFilePath, audioMimeType, language)
    .catch((error) => {
      logger.error(
        `[Dictation] Unexpected failure in job ${jobId}: ${error.message}`,
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
export function DictationGetInFlightJobId(userId: string): string | null {
  const jobId = inFlightJobIds.get(userId);
  if (!jobId) {
    return null;
  }
  const job = jobs.get(jobId);
  if (!job || job.expiresAt < Date.now()) {
    inFlightJobIds.delete(userId);
    return null;
  }
  return jobId;
}

/**
 * Returns the view of a job when it exists, belongs to the user and has not
 * expired; null otherwise.
 */
export function DictationGetJob(
  userId: string,
  jobId: string,
): DictationJobView | null {
  const job = jobs.get(jobId);
  if (!job || job.userId !== userId || job.expiresAt < Date.now()) {
    return null;
  }
  return {
    jobId: job.jobId,
    status: job.status,
    stage: job.stage,
    result: job.result,
    error: job.error,
  };
}

/**
 * Removes expired jobs from the in-memory store. Returns the number of jobs
 * removed. Exported for tests and called by the periodic sweep timer.
 */
export function DictationSweepExpiredJobs(): number {
  const now = Date.now();
  let removed = 0;
  for (const [jobId, job] of jobs) {
    if (job.expiresAt < now) {
      jobs.delete(jobId);
      removed++;
    }
  }
  return removed;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function startSweepTimer(): void {
  if (sweepTimer) {
    return;
  }
  sweepTimer = setInterval(() => {
    try {
      DictationSweepExpiredJobs();
    } catch {
      // Never let the sweep break the process
    }
  }, DICTATION_JOB_TTL_MS);
  sweepTimer.unref?.();
}

// ── Background pipeline ───────────────────────────────────────────────────────

async function runJob(
  job: DictationJob,
  audioFilePath: string,
  audioMimeType: string,
  language: string | null,
): Promise<void> {
  try {
    // Stage A: transcription
    job.stage = "transcribing";
    let transcript: string;
    try {
      transcript = await transcribeAudio(audioFilePath, audioMimeType, language);
    } finally {
      // No audio retention: delete the temp file right after the STT call,
      // success or failure
      await deleteAudioFile(audioFilePath);
    }

    // Stage B: LLM polish (falls back to the raw transcript on failure)
    job.stage = "polishing";
    let polishedText = transcript;
    let polished = false;
    if (config.LLM_API_KEY) {
      try {
        const content = await callLLMWithRetry(
          POLISH_SYSTEM_PROMPT,
          BuildPolishPrompt(transcript, language),
        );
        const parsed = ParsePolishedText(content);
        if (parsed) {
          polishedText = parsed;
          polished = true;
        } else {
          logger.warn(`[Dictation] Unparseable polish response for job ${job.jobId}`);
        }
      } catch (error) {
        logger.warn(
          `[Dictation] Polish failed for job ${job.jobId}: ${error.message}`,
        );
      }
    }

    // Stage C: LLM action proposals (skipped on failure)
    job.stage = "actions";
    let actions: DictationActionProposal[] = [];
    let actionsAvailable = false;
    if (config.LLM_API_KEY) {
      try {
        const content = await callLLMWithRetry(
          ACTIONS_SYSTEM_PROMPT,
          BuildActionsPrompt(polishedText, language),
        );
        const parsed = ParseActionProposals(content);
        if (parsed) {
          actions = parsed;
          actionsAvailable = true;
        } else {
          logger.warn(`[Dictation] Unparseable actions response for job ${job.jobId}`);
        }
      } catch (error) {
        logger.warn(
          `[Dictation] Actions failed for job ${job.jobId}: ${error.message}`,
        );
      }
    }

    job.result = {
      rawTranscript: transcript,
      polishedText,
      polished,
      actions,
      actionsAvailable,
    };
    job.status = "done";
    job.stage = null;
    logger.info(`[Dictation] Job ${job.jobId} done`);
  } catch (error) {
    logger.error(`[Dictation] Job ${job.jobId} failed: ${error.message}`);
    job.status = "error";
    job.stage = null;
    job.error = "Dictation failed, please try again";
    // Safety net for failures before the STT call (idempotent)
    await deleteAudioFile(audioFilePath);
  }
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

async function transcribeAudio(
  audioFilePath: string,
  audioMimeType: string,
  language: string | null,
): Promise<string> {
  if (config.STT_MODE === "embedded") {
    return SttWhisperCppTranscribe(config, audioFilePath, audioMimeType, language);
  }
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
  return text.trim();
}

// ── LLM API call with retry ───────────────────────────────────────────────────

async function callLLMWithRetry(
  systemPrompt: string,
  prompt: string,
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
          max_tokens: 1000,
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
