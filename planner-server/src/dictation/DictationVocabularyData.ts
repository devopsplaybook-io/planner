import { v4 as uuidv4 } from "uuid";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsTransaction,
} from "../utils/DbUtils";

/** Maximum stored length of a vocabulary term. */
export const VOCABULARY_TERM_MAX_LENGTH = 100;

export interface DictationVocabularyEntry {
  id: string;
  term: string;
  projectId: string | null;
  dateCreated: string;
}

/**
 * Normalizes a user-supplied vocabulary term: NFKC, trimmed, inner
 * whitespace collapsed and bounded. `term` keeps the display casing;
 * `normalizedTerm` is additionally lower-cased so uniqueness is
 * case-insensitive on both database engines. Returns null for an empty or
 * unsupported term. Never log the returned values.
 */
export function NormalizeVocabularyTerm(
  raw: unknown,
): { term: string; normalizedTerm: string } | null {
  if (typeof raw !== "string") {
    return null;
  }
  const term = raw
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VOCABULARY_TERM_MAX_LENGTH);
  if (!term) {
    return null;
  }
  return { term, normalizedTerm: term.toLowerCase() };
}

function mapRow(row: Record<string, unknown>): DictationVocabularyEntry {
  return {
    id: String(row.id),
    term: String(row.term),
    projectId: (row.projectId as string) ?? null,
    dateCreated: String(row.dateCreated),
  };
}

/** All terms of a user (both scopes), bounded by the stored vocabulary cap. */
export async function DictationVocabularyListForUser(
  userId: string,
): Promise<DictationVocabularyEntry[]> {
  const rows = await DbUtilsQuerySQL(
    `SELECT id, term, projectId, dateCreated FROM dictation_vocabulary
     WHERE userId = ?
     ORDER BY projectId IS NULL ASC, sortOrder ASC, dateCreated ASC`,
    [userId],
  );
  return rows.map(mapRow);
}

export async function DictationVocabularyCountForUser(
  userId: string,
): Promise<number> {
  const rows = await DbUtilsQuerySQL(
    "SELECT COUNT(*) AS count FROM dictation_vocabulary WHERE userId = ?",
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Number of terms in one scope (personal when projectId is null). */
export async function DictationVocabularyCountForScope(
  userId: string,
  projectId: string | null,
): Promise<number> {
  const rows = await DbUtilsQuerySQL(
    projectId
      ? "SELECT COUNT(*) AS count FROM dictation_vocabulary WHERE userId = ? AND projectId = ?"
      : "SELECT COUNT(*) AS count FROM dictation_vocabulary WHERE userId = ? AND projectId IS NULL",
    projectId ? [userId, projectId] : [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Adds one term to a scope. Throws a unique-violation error when the scope
 * already contains the term (case-insensitive); the route maps it to 409.
 */
export async function DictationVocabularyAdd(
  userId: string,
  projectId: string | null,
  term: string,
): Promise<DictationVocabularyEntry> {
  const normalized = NormalizeVocabularyTerm(term);
  if (!normalized) {
    throw new Error("Invalid vocabulary term");
  }
  const nextRows = await DbUtilsQuerySQL(
    projectId
      ? "SELECT COALESCE(MAX(sortOrder), -1) + 1 AS next FROM dictation_vocabulary WHERE userId = ? AND projectId = ?"
      : "SELECT COALESCE(MAX(sortOrder), -1) + 1 AS next FROM dictation_vocabulary WHERE userId = ? AND projectId IS NULL",
    projectId ? [userId, projectId] : [userId],
  );
  const sortOrder = Number(nextRows[0]?.next ?? 0);
  const entry: DictationVocabularyEntry = {
    id: uuidv4(),
    term: normalized.term,
    projectId,
    dateCreated: new Date().toISOString(),
  };
  await DbUtilsExecSQL(
    `INSERT INTO dictation_vocabulary (id, userId, projectId, term, normalizedTerm, sortOrder, dateCreated)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      userId,
      projectId,
      normalized.term,
      normalized.normalizedTerm,
      sortOrder,
      entry.dateCreated,
    ],
  );
  return entry;
}

/** Deletes one term owned by the user. Returns the number of deleted rows. */
export async function DictationVocabularyDelete(
  userId: string,
  id: string,
): Promise<number> {
  return DbUtilsExecSQL(
    "DELETE FROM dictation_vocabulary WHERE id = ? AND userId = ?",
    [id, userId],
  );
}

/**
 * Replaces a whole scope with the given terms (plain-text import). Trims,
 * dedupes case-insensitively and drops invalid entries; ordering follows the
 * input. One transaction: a failure leaves the previous scope untouched.
 */
export async function DictationVocabularyReplaceScope(
  userId: string,
  projectId: string | null,
  terms: unknown[],
): Promise<DictationVocabularyEntry[]> {
  const seen = new Set<string>();
  const entries: { term: string; normalizedTerm: string }[] = [];
  for (const raw of terms) {
    const normalized = NormalizeVocabularyTerm(raw);
    if (!normalized || seen.has(normalized.normalizedTerm)) {
      continue;
    }
    seen.add(normalized.normalizedTerm);
    entries.push(normalized);
  }
  await DbUtilsTransaction(async () => {
    await DbUtilsExecSQL(
      projectId
        ? "DELETE FROM dictation_vocabulary WHERE userId = ? AND projectId = ?"
        : "DELETE FROM dictation_vocabulary WHERE userId = ? AND projectId IS NULL",
      projectId ? [userId, projectId] : [userId],
    );
    for (const [index, normalized] of entries.entries()) {
      await DbUtilsExecSQL(
        `INSERT INTO dictation_vocabulary (id, userId, projectId, term, normalizedTerm, sortOrder, dateCreated)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          userId,
          projectId,
          normalized.term,
          normalized.normalizedTerm,
          index,
          new Date().toISOString(),
        ],
      );
    }
  });
  const rows = await DbUtilsQuerySQL(
    projectId
      ? `SELECT id, term, projectId, dateCreated FROM dictation_vocabulary
         WHERE userId = ? AND projectId = ? ORDER BY sortOrder ASC, dateCreated ASC`
      : `SELECT id, term, projectId, dateCreated FROM dictation_vocabulary
         WHERE userId = ? AND projectId IS NULL ORDER BY sortOrder ASC, dateCreated ASC`,
    projectId ? [userId, projectId] : [userId],
  );
  return rows.map(mapRow);
}

/**
 * Terms used to bias the STT engine: the project scope first, then the
 * personal scope, deduped case-insensitively and capped to `maxTerms`.
 * Never persisted or logged.
 */
export async function DictationVocabularyResolveForPrompt(
  userId: string,
  projectId: string | null,
  maxTerms: number,
): Promise<string[]> {
  const cap = Math.max(0, Math.floor(maxTerms));
  if (cap === 0) {
    return [];
  }
  const terms: string[] = [];
  const seen = new Set<string>();
  const append = (rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const term = String(row.term ?? "").trim();
      const normalized = term.toLowerCase();
      if (!term || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      terms.push(term);
      if (terms.length >= cap) {
        return;
      }
    }
  };
  if (projectId) {
    const projectRows = await DbUtilsQuerySQL(
      `SELECT term FROM dictation_vocabulary
       WHERE userId = ? AND projectId = ?
       ORDER BY sortOrder ASC, dateCreated ASC LIMIT ?`,
      [userId, projectId, cap],
    );
    append(projectRows);
  }
  if (terms.length < cap) {
    const userRows = await DbUtilsQuerySQL(
      `SELECT term FROM dictation_vocabulary
       WHERE userId = ? AND projectId IS NULL
       ORDER BY sortOrder ASC, dateCreated ASC LIMIT ?`,
      [userId, cap],
    );
    append(userRows);
  }
  return terms;
}
