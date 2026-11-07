import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";
import { DictationActionProposal } from "./DictationLlm";
import {
  DictationChunk,
  DictationJobKind,
  DictationJobSource,
  DictationSegment,
  ParseChunkPlan,
  ParseDictationSegments,
  ParseTranscriptSegments,
  TimestampedTranscriptSegment,
} from "./DictationTypes";

export type { DictationJobKind, DictationJobSource };

export type DictationJobStatus = "processing" | "done" | "error";

export interface DictationJobRecord {
  id: string;
  userId: string;
  source: DictationJobSource;
  jobKind: DictationJobKind;
  clientId: string | null;
  taskId: string | null;
  attachmentId: string | null;
  commentId: string | null;
  /** Default project for meeting action items (null = user default) */
  projectId: string | null;
  status: DictationJobStatus;
  stage: string | null;
  language: string | null;
  targetLanguage: string | null;
  engine: string;
  model: string | null;
  rawTranscript: string | null;
  polishedText: string | null;
  polished: boolean;
  segments: DictationSegment[] | null;
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
  archivedAt: string | null;
  transcriptSegments: TimestampedTranscriptSegment[] | null;
  summary: string | null;
  decisions: string[];
  chunkPlan: DictationChunk[] | null;
  segmentsDone: number;
  segmentsTotal: number;
  audioPath: string | null;
  audioRetained: boolean;
  audioDeletedAt: string | null;
  convertedAt: string | null;
  convertedType: string | null;
  convertedTargetId: string | null;
  dateCreated: string;
  dateUpdated: string;
}

export interface DictationJobCreateInput {
  id: string;
  userId: string;
  source: DictationJobSource;
  jobKind?: DictationJobKind;
  clientId?: string | null;
  taskId?: string | null;
  attachmentId?: string | null;
  commentId?: string | null;
  projectId?: string | null;
  status: DictationJobStatus;
  stage?: string | null;
  language?: string | null;
  targetLanguage?: string | null;
  engine: string;
  model?: string | null;
  expiresAt: string;
  segmentsDone?: number;
  segmentsTotal?: number;
  chunkPlan?: DictationChunk[] | null;
  audioPath?: string | null;
  audioRetained?: boolean;
}

export interface DictationJobUpdatePatch {
  status?: DictationJobStatus;
  stage?: string | null;
  language?: string | null;
  targetLanguage?: string | null;
  model?: string | null;
  rawTranscript?: string | null;
  polishedText?: string | null;
  polished?: boolean;
  segments?: DictationSegment[] | null;
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
  transcriptSegments?: TimestampedTranscriptSegment[] | null;
  summary?: string | null;
  decisions?: string[];
  chunkPlan?: DictationChunk[] | null;
  segmentsDone?: number;
  segmentsTotal?: number;
}

/**
 * Physical column names (identical on both engines apart from quoting).
 * `decisions` is exposed under its natural name but stored as `decisionsJson`.
 */
const UPDATE_COLUMNS: [keyof DictationJobUpdatePatch, string][] = [
  ["status", "status"],
  ["stage", "stage"],
  ["language", "language"],
  ["targetLanguage", "targetLanguage"],
  ["model", "model"],
  ["rawTranscript", "rawTranscript"],
  ["polishedText", "polishedText"],
  ["polished", "polished"],
  ["segments", "segments"],
  ["actions", "actions"],
  ["actionsAvailable", "actionsAvailable"],
  ["error", "error"],
  ["audioDurationMs", "audioDurationMs"],
  ["queueMs", "queueMs"],
  ["sttMs", "sttMs"],
  ["polishMs", "polishMs"],
  ["actionsMs", "actionsMs"],
  ["totalMs", "totalMs"],
  ["commentId", "commentId"],
  ["transcriptSegments", "transcriptSegments"],
  ["summary", "summary"],
  ["decisions", "decisionsJson"],
  ["chunkPlan", "chunkPlan"],
  ["segmentsDone", "segmentsDone"],
  ["segmentsTotal", "segmentsTotal"],
];

const JSON_FIELDS = new Set<keyof DictationJobUpdatePatch>([
  "actions",
  "segments",
  "transcriptSegments",
  "decisions",
  "chunkPlan",
]);

const SELECT_COLUMNS = `"id", "userId", "source", "jobKind", "clientId", "taskId",
  "attachmentId", "commentId", "projectId", "status", "stage", "language", "targetLanguage",
  "engine", "model", "rawTranscript", "polishedText", "polished", "segments",
  "actions", "actionsAvailable", "error", "audioDurationMs", "queueMs", "sttMs",
  "polishMs", "actionsMs", "totalMs", "revision", "expiresAt", "archivedAt",
  "transcriptSegments", "summary", "decisionsJson", "chunkPlan", "segmentsDone",
  "segmentsTotal", "audioPath", "audioRetained", "audioDeletedAt",
  "convertedAt", "convertedType", "convertedTargetId", "dateCreated",
  "dateUpdated"`;

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

function parseSegments(value: unknown): DictationSegment[] | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  try {
    return ParseDictationSegments(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseTranscript(
  value: unknown,
): TimestampedTranscriptSegment[] | null {
  if (!value) {
    return null;
  }
  return ParseTranscriptSegments(value);
}

function parseChunkPlan(value: unknown): DictationChunk[] | null {
  if (!value) {
    return null;
  }
  return ParseChunkPlan(value);
}

function parseDecisions(value: unknown): string[] {
  if (typeof value !== "string" || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && !!entry)
      .slice(0, 200);
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
    jobKind: (String(row.jobKind || "short") as DictationJobKind) || "short",
    clientId: (row.clientId as string) ?? null,
    taskId: (row.taskId as string) ?? null,
    attachmentId: (row.attachmentId as string) ?? null,
    commentId: (row.commentId as string) ?? null,
    projectId: (row.projectId as string) ?? null,
    status: String(row.status) as DictationJobStatus,
    stage: (row.stage as string) ?? null,
    language: (row.language as string) ?? null,
    targetLanguage: (row.targetLanguage as string) ?? null,
    engine: String(row.engine),
    model: (row.model as string) ?? null,
    rawTranscript: (row.rawTranscript as string) ?? null,
    polishedText: (row.polishedText as string) ?? null,
    polished: toBoolean(row.polished),
    segments: parseSegments(row.segments),
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
    archivedAt: (row.archivedAt as string) ?? null,
    transcriptSegments: parseTranscript(row.transcriptSegments),
    summary: (row.summary as string) ?? null,
    decisions: parseDecisions(row.decisionsJson),
    chunkPlan: parseChunkPlan(row.chunkPlan),
    segmentsDone: Number(row.segmentsDone ?? 0),
    segmentsTotal: Number(row.segmentsTotal ?? 0),
    audioPath: (row.audioPath as string) ?? null,
    audioRetained: toBoolean(row.audioRetained),
    audioDeletedAt: (row.audioDeletedAt as string) ?? null,
    convertedAt: (row.convertedAt as string) ?? null,
    convertedType: (row.convertedType as string) ?? null,
    convertedTargetId: (row.convertedTargetId as string) ?? null,
    dateCreated: String(row.dateCreated),
    dateUpdated: String(row.dateUpdated),
  };
}

function booleanForStorage(value: boolean): boolean | number {
  return DbUtilsGetType() === "postgres" ? value : value ? 1 : 0;
}

function serializeField(
  field: keyof DictationJobUpdatePatch,
  value: unknown,
): unknown {
  if (typeof value === "boolean") {
    return booleanForStorage(value);
  }
  if (JSON_FIELDS.has(field)) {
    return value === null || value === undefined ? null : JSON.stringify(value);
  }
  return value;
}

export async function DictationDataCreate(
  input: DictationJobCreateInput,
): Promise<void> {
  const now = new Date().toISOString();
  await DbUtilsExecSQL(
    `INSERT INTO dictation_jobs ("id", "userId", "source", "jobKind", "clientId",
      "taskId", "attachmentId", "commentId", "projectId", "status", "stage", "language",
      "targetLanguage", "engine", "model", "revision", "expiresAt",
      "segmentsDone", "segmentsTotal", "chunkPlan", "audioPath", "audioRetained",
      "dateCreated", "dateUpdated")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.userId,
      input.source,
      input.jobKind ?? "short",
      input.clientId ?? null,
      input.taskId ?? null,
      input.attachmentId ?? null,
      input.commentId ?? null,
      input.projectId ?? null,
      input.status,
      input.stage ?? null,
      input.language ?? null,
      input.targetLanguage ?? null,
      input.engine,
      input.model ?? null,
      input.expiresAt,
      input.segmentsDone ?? 0,
      input.segmentsTotal ?? 0,
      input.chunkPlan ? JSON.stringify(input.chunkPlan) : null,
      input.audioPath ?? null,
      booleanForStorage(input.audioRetained ?? false),
      now,
      now,
    ],
  );
}

export async function DictationDataGet(
  jobId: string,
): Promise<DictationJobRecord | null> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs WHERE "id" = ?`,
    [jobId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function DictationDataGetForUser(
  userId: string,
  jobId: string,
): Promise<DictationJobRecord | null> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs WHERE "id" = ? AND "userId" = ?`,
    [jobId, userId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/** Idempotent upload lookup: a client may retry with the same clientId. */
export async function DictationDataGetByClientId(
  userId: string,
  clientId: string,
): Promise<DictationJobRecord | null> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE "userId" = ? AND "clientId" = ? LIMIT 1`,
    [userId, clientId],
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
  for (const [field, column] of UPDATE_COLUMNS) {
    const value = patch[field];
    if (value === undefined) {
      continue;
    }
    assignments.push(`"${column}" = ?`);
    params.push(serializeField(field, value));
  }
  if (assignments.length === 0) {
    return;
  }
  params.push(new Date().toISOString(), jobId);
  await DbUtilsExecSQL(
    `UPDATE dictation_jobs SET ${assignments.join(", ")}, "revision" = "revision" + 1, "dateUpdated" = ? WHERE "id" = ?`,
    params,
  );
}

export async function DictationDataGetInFlightForUser(
  userId: string,
  source: DictationJobSource | DictationJobSource[] = "dictation",
  jobKind?: DictationJobKind,
): Promise<DictationJobRecord | null> {
  const sources = Array.isArray(source) ? source : [source];
  const params: unknown[] = [userId, ...sources];
  let sql = `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE "userId" = ? AND "status" = 'processing'
       AND "source" IN (${sources.map(() => "?").join(", ")})`;
  if (jobKind) {
    sql += ` AND "jobKind" = ?`;
    params.push(jobKind);
  }
  sql += ` ORDER BY "dateCreated" DESC LIMIT 1`;
  const rows = await DbUtilsQuerySQL(sql, params);
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
    sourceClause = `AND "source" = ?`;
    params.push(source);
  }
  params.push(bounded);
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE "userId" = ? AND "expiresAt" >= ? AND "jobKind" <> 'meeting' ${sourceClause}
     ORDER BY "dateCreated" DESC LIMIT ?`,
    params,
  );
  return rows.map(mapRow);
}

export interface DictationInboxQuery {
  limit?: number;
  offset?: number;
  status?: DictationJobStatus;
  source?: DictationJobSource;
  includeArchived?: boolean;
}

export interface DictationInboxPage {
  jobs: DictationJobRecord[];
  total: number;
}

/**
 * Paginated inbox listing. Voice comments stay attached to their task and are
 * excluded unless explicitly requested; archived jobs are hidden by default.
 */
export async function DictationDataListInbox(
  userId: string,
  query: DictationInboxQuery = {},
): Promise<DictationInboxPage> {
  const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 20) || 20));
  const offset = Math.max(0, Math.floor(query.offset ?? 0) || 0);
  const clauses = [`"userId" = ?`];
  const params: unknown[] = [userId];
  if (query.source) {
    clauses.push(`"source" = ?`);
    params.push(query.source);
  } else {
    clauses.push(`"source" <> 'voice_comment'`);
  }
  if (query.status) {
    clauses.push(`"status" = ?`);
    params.push(query.status);
  }
  if (!query.includeArchived) {
    clauses.push(`"archivedAt" IS NULL`);
  }
  const where = clauses.join(" AND ");
  const countRows = await DbUtilsQuerySQL(
    `SELECT COUNT(*) AS "count" FROM dictation_jobs WHERE ${where}`,
    params,
  );
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs WHERE ${where}
     ORDER BY "dateCreated" DESC, "id" DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return {
    jobs: rows.map(mapRow),
    total: Number(countRows[0]?.count ?? 0),
  };
}

/**
 * Inbox badge counts since the last time the user looked: newly settled jobs
 * (done/error) and jobs still processing. Voice comments are excluded.
 */
export async function DictationDataCountUnreadSince(
  userId: string,
  sinceIso: string,
): Promise<{ unread: number; processing: number }> {
  const rows = await DbUtilsQuerySQL(
    `SELECT
       SUM(CASE WHEN "status" IN ('done', 'error') AND "dateUpdated" > ? THEN 1 ELSE 0 END) AS "unread",
       SUM(CASE WHEN "status" = 'processing' THEN 1 ELSE 0 END) AS "processing"
     FROM dictation_jobs
     WHERE "userId" = ? AND "source" <> 'voice_comment' AND "archivedAt" IS NULL`,
    [sinceIso, userId],
  );
  return {
    unread: Number(rows[0]?.unread ?? 0),
    processing: Number(rows[0]?.processing ?? 0),
  };
}

export async function DictationDataSetArchived(
  jobId: string,
  userId: string,
  archivedAt: string | null,
): Promise<number> {
  return DbUtilsExecSQL(
    `UPDATE dictation_jobs SET "archivedAt" = ?, "revision" = "revision" + 1,
       "dateUpdated" = ? WHERE "id" = ? AND "userId" = ?`,
    [archivedAt, new Date().toISOString(), jobId, userId],
  );
}

/** Deletes a job of the user; `dictation_job_actions` cascades. */
export async function DictationDataDelete(
  jobId: string,
  userId: string,
): Promise<number> {
  return DbUtilsExecSQL(
    `DELETE FROM dictation_jobs WHERE "id" = ? AND "userId" = ?`,
    [jobId, userId],
  );
}

export async function DictationDataMarkConverted(
  jobId: string,
  convertedType: string,
  convertedTargetId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await DbUtilsExecSQL(
    `UPDATE dictation_jobs SET "convertedAt" = ?, "convertedType" = ?,
       "convertedTargetId" = ?, "revision" = "revision" + 1, "dateUpdated" = ?
     WHERE "id" = ?`,
    [now, convertedType, convertedTargetId, now, jobId],
  );
}

/** Appends transcribed chunks and advances the visible progress. */
export async function DictationDataUpdateProgress(
  jobId: string,
  progress: {
    segmentsDone: number;
    transcriptSegments: TimestampedTranscriptSegment[];
    segmentsTotal?: number;
    stage?: string | null;
  },
): Promise<void> {
  const assignments = [`"segmentsDone" = ?`, `"transcriptSegments" = ?`];
  const params: unknown[] = [
    Math.max(0, Math.floor(progress.segmentsDone) || 0),
    JSON.stringify(progress.transcriptSegments),
  ];
  if (progress.segmentsTotal !== undefined) {
    assignments.push(`"segmentsTotal" = ?`);
    params.push(Math.max(0, Math.floor(progress.segmentsTotal) || 0));
  }
  if (progress.stage !== undefined) {
    assignments.push(`"stage" = ?`);
    params.push(progress.stage);
  }
  params.push(new Date().toISOString(), jobId);
  await DbUtilsExecSQL(
    `UPDATE dictation_jobs SET ${assignments.join(", ")},
       "revision" = "revision" + 1, "dateUpdated" = ? WHERE "id" = ?`,
    params,
  );
}

export async function DictationDataSetSummaryResult(
  jobId: string,
  result: {
    summary: string;
    decisions: string[];
    actions: DictationActionProposal[];
  },
): Promise<void> {
  await DbUtilsExecSQL(
    `UPDATE dictation_jobs SET "summary" = ?, "decisionsJson" = ?,
       "actions" = ?, "actionsAvailable" = ?, "revision" = "revision" + 1,
       "dateUpdated" = ? WHERE "id" = ?`,
    [
      result.summary,
      JSON.stringify(result.decisions),
      JSON.stringify(result.actions),
      booleanForStorage(result.actions.length > 0),
      new Date().toISOString(),
      jobId,
    ],
  );
}

/** Records the retention state of a job's durable audio file. */
export async function DictationDataSetAudioState(
  jobId: string,
  state: {
    audioPath?: string | null;
    audioRetained?: boolean;
    audioDeletedAt?: string | null;
  },
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];
  if (state.audioPath !== undefined) {
    assignments.push(`"audioPath" = ?`);
    params.push(state.audioPath);
  }
  if (state.audioRetained !== undefined) {
    assignments.push(`"audioRetained" = ?`);
    params.push(booleanForStorage(state.audioRetained));
  }
  if (state.audioDeletedAt !== undefined) {
    assignments.push(`"audioDeletedAt" = ?`);
    params.push(state.audioDeletedAt);
  }
  if (assignments.length === 0) {
    return;
  }
  params.push(jobId);
  await DbUtilsExecSQL(
    `UPDATE dictation_jobs SET ${assignments.join(", ")} WHERE "id" = ?`,
    params,
  );
}

/**
 * Jobs whose audio file still exists on disk (kept recordings). Sweep uses
 * this to enforce the per-user age/size caps.
 */
export async function DictationDataListKeptAudio(
  userId?: string,
): Promise<DictationJobRecord[]> {
  const params: unknown[] = [];
  let userClause = "";
  if (userId) {
    userClause = `AND "userId" = ?`;
    params.push(userId);
  }
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE "audioPath" IS NOT NULL ${userClause}
     ORDER BY "dateCreated" ASC`,
    params,
  );
  return rows.map(mapRow);
}

/** Every referenced audio path, for orphan file cleanup. */
export async function DictationDataListAudioPaths(): Promise<string[]> {
  const rows = await DbUtilsQuerySQL(
    `SELECT "audioPath" FROM dictation_jobs WHERE "audioPath" IS NOT NULL`,
  );
  return rows.map((row) => String(row.audioPath));
}

export async function DictationDataGetLatestByAttachment(
  attachmentId: string,
): Promise<DictationJobRecord | null> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE "attachmentId" = ? ORDER BY "dateCreated" DESC LIMIT 1`,
    [attachmentId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function DictationDataDeleteExpired(
  now: string = new Date().toISOString(),
): Promise<number> {
  return DbUtilsExecSQL(`DELETE FROM dictation_jobs WHERE "expiresAt" < ?`, [
    now,
  ]);
}

/**
 * Resolves short jobs interrupted before their STT stage: the live temp audio
 * is gone, so they become errors the user can see (and re-record from).
 * Meeting jobs keep durable audio and are resumed instead.
 */
export async function DictationDataMarkInterruptedBeforeStt(
  message: string,
  now: string = new Date().toISOString(),
): Promise<number> {
  return DbUtilsExecSQL(
    `UPDATE dictation_jobs
     SET "status" = 'error', "stage" = NULL, "error" = ?,
         "revision" = "revision" + 1, "dateUpdated" = ?
     WHERE "status" = 'processing' AND "jobKind" = 'short'
       AND "rawTranscript" IS NULL`,
    [message, now],
  );
}

/**
 * Short jobs interrupted after STT can resume polish/actions from the
 * persisted raw transcript (the audio is gone).
 */
export async function DictationDataListResumable(): Promise<
  DictationJobRecord[]
> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE "status" = 'processing' AND "jobKind" = 'short'
       AND "rawTranscript" IS NOT NULL
     ORDER BY "dateCreated" ASC`,
  );
  return rows.map(mapRow);
}

/** Meeting jobs still processing are resumed from their persisted progress. */
export async function DictationDataListResumableMeeting(): Promise<
  DictationJobRecord[]
> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE "status" = 'processing' AND "jobKind" = 'meeting'
     ORDER BY "dateCreated" ASC`,
  );
  return rows.map(mapRow);
}

/** The oldest processing meeting job, used by the single meeting worker. */
export async function DictationDataGetProcessingMeeting(): Promise<DictationJobRecord | null> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_jobs
     WHERE "status" = 'processing' AND "jobKind" = 'meeting'
     ORDER BY "dateCreated" ASC LIMIT 1`,
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}