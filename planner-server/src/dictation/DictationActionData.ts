import { v4 as uuidv4 } from "uuid";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "../utils/DbUtils";

export type DictationAppliedActionStatus = "applied" | "failed";

/**
 * One row of an applied/attempted action batch. `beforeJson` holds the undo
 * snapshot and is never exposed by an API view.
 */
export interface DictationAppliedActionRecord {
  id: string;
  jobId: string;
  userId: string;
  requestId: string;
  actionIndex: number;
  type: string;
  status: DictationAppliedActionStatus;
  targetId: string | null;
  targetType: string | null;
  error: string | null;
  beforeJson: string | null;
  undoneAt: string | null;
  dateCreated: string;
}

export interface DictationAppliedActionInput {
  jobId: string;
  userId: string;
  requestId: string;
  actionIndex: number;
  type: string;
  status: DictationAppliedActionStatus;
  targetId?: string | null;
  targetType?: string | null;
  error?: string | null;
  beforeJson?: string | null;
}

const SELECT_COLUMNS = `"id", "jobId", "userId", "requestId", "actionIndex",
  "type", "status", "targetId", "targetType", "error", "beforeJson",
  "undoneAt", "dateCreated"`;

function mapRow(row: Record<string, unknown>): DictationAppliedActionRecord {
  return {
    id: String(row.id),
    jobId: String(row.jobId),
    userId: String(row.userId),
    requestId: String(row.requestId),
    actionIndex: Number(row.actionIndex),
    type: String(row.type),
    status: String(row.status) as DictationAppliedActionStatus,
    targetId: (row.targetId as string) ?? null,
    targetType: (row.targetType as string) ?? null,
    error: (row.error as string) ?? null,
    beforeJson: (row.beforeJson as string) ?? null,
    undoneAt: (row.undoneAt as string) ?? null,
    dateCreated: String(row.dateCreated),
  };
}

export async function DictationActionDataInsert(
  input: DictationAppliedActionInput,
): Promise<DictationAppliedActionRecord> {
  const record: DictationAppliedActionRecord = {
    id: uuidv4(),
    jobId: input.jobId,
    userId: input.userId,
    requestId: input.requestId,
    actionIndex: input.actionIndex,
    type: input.type,
    status: input.status,
    targetId: input.targetId ?? null,
    targetType: input.targetType ?? null,
    error: input.error ?? null,
    beforeJson: input.beforeJson ?? null,
    undoneAt: null,
    dateCreated: new Date().toISOString(),
  };
  await DbUtilsExecSQL(
    `INSERT INTO dictation_job_actions
      ("id", "jobId", "userId", "requestId", "actionIndex", "type", "status",
       "targetId", "targetType", "error", "beforeJson", "undoneAt", "dateCreated")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.jobId,
      record.userId,
      record.requestId,
      record.actionIndex,
      record.type,
      record.status,
      record.targetId,
      record.targetType,
      record.error,
      record.beforeJson,
      record.undoneAt,
      record.dateCreated,
    ],
  );
  return record;
}

export async function DictationActionDataListByRequest(
  jobId: string,
  requestId: string,
): Promise<DictationAppliedActionRecord[]> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_job_actions
     WHERE "jobId" = ? AND "requestId" = ?
     ORDER BY "actionIndex" ASC`,
    [jobId, requestId],
  );
  return rows.map(mapRow);
}

export async function DictationActionDataListForJob(
  jobId: string,
): Promise<DictationAppliedActionRecord[]> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_job_actions
     WHERE "jobId" = ?
     ORDER BY "dateCreated" ASC, "actionIndex" ASC`,
    [jobId],
  );
  return rows.map(mapRow);
}

export async function DictationActionDataMarkUndone(
  id: string,
  undoneAt: string,
): Promise<void> {
  await DbUtilsExecSQL(
    'UPDATE dictation_job_actions SET "undoneAt" = ? WHERE "id" = ?',
    [undoneAt, id],
  );
}
