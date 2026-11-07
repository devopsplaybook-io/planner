import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";
import { DictationActionProposal } from "./DictationLlm";

export type DictationJobSource = "dictation" | "voice_comment";
export type DictationJobStatus = "processing" | "done" | "error";

export interface DictationJobRecord {
  id: string;
  userId: string;
  source: DictationJobSource;
  taskId: string | null;
  attachmentId: string | null;
  commentId: string | null;
  status: DictationJobStatus;
  stage: string | null;
  language: string | null;
  engine: string;
  model: string | null;
  rawTranscript: string | null;
  polishedText: string | null;
  polished: boolean;
  actions: DictationActionProposal[];
  actionsAvailable: boolean;
  error: string | null;
  audioDurationMs: number | null;
  queueMs: number | null;
  sttMs: number | null;
  polishMs: number | null;
  actionsMs: number | null;
  totalMs: number | null;
  revision: number;
  expiresAt: string;
  dateCreated: string;
  dateUpdated: string;
}

export interface DictationJobCreateInput {
  id: string;
  userId: string;
  source: DictationJobSource;
  taskId?: string | null;
  attachmentId?: string | null;
  commentId?: string | null;
  status: DictationJobStatus;
  stage?: string | null;
  language?: string | null;
  engine: string;
  model?: string | null;
  expiresAt: string;
}

export interface DictationJobUpdatePatch {
  status?: DictationJobStatus;
  stage?: string | null;
  language?: string | null;
  model?: string | null;
  rawTranscript?: string | null;
  polishedText?: string | null;
  polished?: boolean;
  actions?: DictationActionProposal[];
  actionsAvailable?: boolean;
  error?: string | null;
  audioDurationMs?: number | null;
  queueMs?: number | null;
  sttMs?: number | null;
  polishMs?: number | null;
  actionsMs?: number | null;
  totalMs?: number | null;
  commentId?: string | null;
}

const SELECT_COLUMNS = `id, userId, source, taskId, attachmentId, commentId,
  status, stage, language, engine, model, rawTranscript, polishedText, polished,
  actions, actionsAvailable, error, audioDurationMs, queueMs, sttMs, polishMs,
  actionsMs, totalMs, revision, expiresAt, dateCreated, dateUpdated`;

// Physical column names (identical on both engines apart from quoting)
const UPDATE_COLUMN_ORDER: (keyof DictationJobUpdatePatch)[] = [
  "status",
  "stage",
  "language",
  "model",
  "rawTranscript",
  "polishedText",
  "polished",
  "actions",
  "actionsAvailable",
  "error",
  "audioDurationMs",
  "queueMs",
  "sttMs",
  "polishMs",
  "actionsMs",
  "totalMs",
  "commentId",
];

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function parseActions(value: unknown): DictationActionProposal[] {
  if (typeof value !== "string" || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapRow(row: Record<string, unknown>): DictationJobRecord {
  return {
    id: String(row.id),
    userId: String(row.userId),
    source: String(row.source) as DictationJobSource,
    taskId: (row.taskId as string) ?? null,
    attachmentId: (row.attachmentId as string) ?? null,
    commentId: (row.commentId as string) ?? null,
    status: String(row.status) as DictationJobStatus,
    stage: (row.stage as string) ?? null,
    language: (row.language as string) ?? null,
    engine: String(row.engine),
    model: (row.model as string) ?? null,
    rawTranscript: (row.rawTranscript as string) ?? null,
    polishedText: (row.polishedText as string) ?? null,
    polished: toBoolean(row.polished),
    actions: parseActions(row.actions),
    actionsAvailable: toBoolean(row.actionsAvailable),
    error: (row.error as string) ?? null,
    audioDurationMs: toNumberOrNull(row.audioDurationMs),
    queueMs: toNumberOrNull(row.queueMs),
    sttMs: toNumberOrNull(row.sttMs),
    polishMs: toNumberOrNull(row.polishMs),
    actionsMs: toNumberOrNull(row.actionsMs),
    totalMs: toNumberOrNull(row.totalMs),
    revision: Number(row.revision ?? 0),
    expiresAt: String(row.expiresAt),
    dateCreated: String(row.dateCreated),
    dateUpdated: String(row.dateUpdated),
  };
}

function booleanForStorage(value: boolean): boolean | number {
  return DbUtilsGetType() === "postgres" ? value : value ? 1 : 0;
}

export async function DictationDataCreate(
  input: DictationJobCreateInput,
): Promise<void> {
  const now = new Date().toISOString();
  await DbUtilsExecSQL(
    `INSERT INTO dictation_jobs (id, userId, source, taskId, attachmentId, commentId,
      status, stage, language, engine, model, revision, expiresAt, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      input.id,
      input.userId,
      input.source,
      input.taskId ?? null,
      input.attachmentId ?? null,
      input.commentId ?? null,
      input.status,
      input.stage ?? null,
      input.language ?? null,
      input.engine,
      input.model ?? null,
      input.expiresAt,
      now,
      now,
    ],
  );
}

export async function DictationDataGet(
  jobId: string,
): Promise<DictationJobRecord | null> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs WHERE id = ?`,
    [jobId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function DictationDataGetForUser(
  userId: string,
  jobId: string,
): Promise<DictationJobRecord | null> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs WHERE id = ? AND userId = ?`,
    [jobId, userId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/**
 * Updates a job and bumps its revision (which drives the long-poll channel).
 * Only the provided fields are written.
 */
export async function DictationDataUpdate(
  jobId: string,
  patch: DictationJobUpdatePatch,
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const field of UPDATE_COLUMN_ORDER) {
    const value = patch[field];
    if (value === undefined) {
      continue;
    }
    assignments.push(`"${field}" = ?`);
    if (typeof value === "boolean") {
      params.push(booleanForStorage(value));
    } else if (field === "actions") {
      params.push(JSON.stringify(value ?? []));
    } else {
      params.push(value);
    }
  }
  if (assignments.length === 0) {
    return;
  }
  params.push(new Date().toISOString(), jobId);
  await DbUtilsExecSQL(
    `UPDATE dictation_jobs SET ${assignments.join(", ")}, revision = revision + 1, dateUpdated = ? WHERE id = ?`,
    params,
  );
}

export async function DictationDataGetInFlightForUser(
  userId: string,
  source: DictationJobSource = "dictation",
): Promise<DictationJobRecord | null> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE userId = ? AND source = ? AND status = 'processing'
     ORDER BY dateCreated DESC LIMIT 1`,
    [userId, source],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function DictationDataListRecent(
  userId: string,
  source?: DictationJobSource,
  limit = 20,
): Promise<DictationJobRecord[]> {
  const bounded = Math.max(1, Math.min(50, Math.floor(limit) || 20));
  const now = new Date().toISOString();
  const params: unknown[] = [userId, now];
  let sourceClause = "";
  if (source) {
    sourceClause = "AND source = ?";
    params.push(source);
  }
  params.push(bounded);
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE userId = ? AND expiresAt >= ? ${sourceClause}
     ORDER BY dateCreated DESC LIMIT ?`,
    params,
  );
  return rows.map(mapRow);
}

export async function DictationDataGetLatestByAttachment(
  attachmentId: string,
): Promise<DictationJobRecord | null> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE attachmentId = ? ORDER BY dateCreated DESC LIMIT 1`,
    [attachmentId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function DictationDataDeleteExpired(
  now: string = new Date().toISOString(),
): Promise<number> {
  return DbUtilsExecSQL("DELETE FROM dictation_jobs WHERE expiresAt < ?", [now]);
}

/**
 * Resolves jobs interrupted before their STT stage: the audio is gone, so
 * they become errors that the user can see (and re-record from).
 */
export async function DictationDataMarkInterruptedBeforeStt(
  message: string,
  now: string = new Date().toISOString(),
): Promise<number> {
  return DbUtilsExecSQL(
    `UPDATE dictation_jobs
     SET status = 'error', stage = NULL, error = ?,
         revision = revision + 1, dateUpdated = ?
     WHERE status = 'processing' AND rawTranscript IS NULL`,
    [message, now],
  );
}

/**
 * Jobs interrupted after STT can resume polish/actions from the persisted
 * raw transcript (the audio is gone).
 */
export async function DictationDataListResumable(): Promise<
  DictationJobRecord[]
> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE status = 'processing' AND rawTranscript IS NOT NULL
     ORDER BY dateCreated ASC`,
  );
  return rows.map(mapRow);
}
