import { v4 as uuidv4 } from "uuid";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";
import { NormalizedPhrase } from "./DictationPhrases";

export interface DictationPhraseRecord {
  id: string;
  userId: string;
  phrase: string;
  normalizedPhrase: string;
  projectId: string | null;
  templateId: string | null;
  labels: string[];
  dateCreated: string;
}

const SELECT_COLUMNS = `"id", "userId", "phrase", "normalizedPhrase",
  "projectId", "templateId", "labels", "dateCreated"`;

function parseLabels(value: unknown): string[] {
  if (typeof value !== "string" || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function mapRow(row: Record<string, unknown>): DictationPhraseRecord {
  return {
    id: String(row.id),
    userId: String(row.userId),
    phrase: String(row.phrase),
    normalizedPhrase: String(row.normalizedPhrase),
    projectId: (row.projectId as string) ?? null,
    templateId: (row.templateId as string) ?? null,
    labels: parseLabels(row.labels),
    dateCreated: String(row.dateCreated),
  };
}

export async function DictationPhrasesListForUser(
  userId: string,
): Promise<DictationPhraseRecord[]> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_phrases
     WHERE "userId" = ?
     ORDER BY "dateCreated" ASC`,
    [userId],
  );
  return rows.map(mapRow);
}

export async function DictationPhrasesCountForUser(
  userId: string,
): Promise<number> {
  const rows = await DbUtilsQuerySQL(
    'SELECT COUNT(*) AS count FROM dictation_phrases WHERE "userId" = ?',
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function getOwned(
  userId: string,
  id: string,
): Promise<DictationPhraseRecord | null> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${SELECT_COLUMNS} FROM dictation_phrases
     WHERE "id" = ? AND "userId" = ?`,
    [id, userId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function DictationPhrasesAdd(
  userId: string,
  normalized: NormalizedPhrase,
  projectId: string | null,
  templateId: string | null,
  labels: string[],
): Promise<DictationPhraseRecord> {
  const record: DictationPhraseRecord = {
    id: uuidv4(),
    userId,
    phrase: normalized.phrase,
    normalizedPhrase: normalized.normalizedPhrase,
    projectId,
    templateId,
    labels,
    dateCreated: new Date().toISOString(),
  };
  await DbUtilsExecSQL(
    `INSERT INTO dictation_phrases
      ("id", "userId", "phrase", "normalizedPhrase", "projectId", "templateId",
       "labels", "dateCreated")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.userId,
      record.phrase,
      record.normalizedPhrase,
      record.projectId,
      record.templateId,
      JSON.stringify(record.labels),
      record.dateCreated,
    ],
  );
  return record;
}

export async function DictationPhrasesUpdate(
  userId: string,
  id: string,
  normalized: NormalizedPhrase,
  projectId: string | null,
  templateId: string | null,
  labels: string[],
): Promise<DictationPhraseRecord | null> {
  const changes = await DbUtilsExecSQL(
    `UPDATE dictation_phrases
     SET "phrase" = ?, "normalizedPhrase" = ?, "projectId" = ?,
         "templateId" = ?, "labels" = ?
     WHERE "id" = ? AND "userId" = ?`,
    [
      normalized.phrase,
      normalized.normalizedPhrase,
      projectId,
      templateId,
      JSON.stringify(labels),
      id,
      userId,
    ],
  );
  if (changes === 0) {
    return null;
  }
  return getOwned(userId, id);
}

export async function DictationPhrasesDelete(
  userId: string,
  id: string,
): Promise<number> {
  return DbUtilsExecSQL(
    'DELETE FROM dictation_phrases WHERE "id" = ? AND "userId" = ?',
    [id, userId],
  );
}
