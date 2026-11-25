import {
  LoginCodeApproveInput,
  LoginCodeAttemptInput,
  LoginCodeCancelInput,
  LoginCodeCleanupInput,
  LoginCodeConsumeInput,
  LoginCodeCreateInput,
  LoginCodeCreateResult,
  LoginCodeMarkInput,
  LoginCodeRecord,
  LoginCodesStore,
  LoginCodeRotateInput,
} from "@devopsplaybook.io/common-utils/users/login-codes";
import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsIsUniqueViolation,
  DbUtilsQuerySQL,
  DbUtilsTransaction,
} from "../utils/DbUtils";

/**
 * Table holding the cross-device login-code requests (migration init-0030).
 * Plan has no `ConfigBase` and its own `DbUtils`, so the library's reference
 * common-utils store is reimplemented over `src/utils/DbUtils.ts` with the
 * same SQLite-first SQL.
 */
export const LOGIN_CODES_TABLE = "users_login_codes";

/**
 * Advisory transaction lock used on PostgreSQL to serialize the conditional
 * insert that enforces the global pending cap. Planner has no
 * `DbUtilsWithLock`; the advisory lock gives the same guarantee without new
 * infrastructure (SQLite already serializes on its single connection).
 */
export const LOGIN_CODES_CREATE_LOCK_KEY = "planner:login_codes:create";

/** A definitive "table does not exist" error, cached by the probe. */
function isMissingTableError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown } | null;
  if (err?.code === "42P01") {
    return true;
  }
  const message = typeof err?.message === "string" ? err.message : "";
  return (
    /no such table/i.test(message) ||
    /relation "[^"]*" does not exist/i.test(message) ||
    /undefined table/i.test(message)
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(row: any): LoginCodeRecord {
  return {
    id: String(row.id),
    requestTokenHash: String(row.requestTokenHash),
    codeHash: String(row.codeHash),
    previousCodeHash:
      row.previousCodeHash === undefined || row.previousCodeHash === null
        ? null
        : String(row.previousCodeHash),
    codeExpiresAt: String(row.codeExpiresAt),
    previousCodeExpiresAt:
      row.previousCodeExpiresAt === undefined ||
      row.previousCodeExpiresAt === null
        ? null
        : String(row.previousCodeExpiresAt),
    status: row.status,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    expiresAt: String(row.expiresAt),
    approvedAt:
      row.approvedAt === undefined || row.approvedAt === null
        ? null
        : String(row.approvedAt),
    approvedByUserId:
      row.approvedByUserId === undefined || row.approvedByUserId === null
        ? null
        : String(row.approvedByUserId),
    consumedAt:
      row.consumedAt === undefined || row.consumedAt === null
        ? null
        : String(row.consumedAt),
    attempts: Number(row.attempts ?? 0),
    requestUserAgent:
      row.requestUserAgent === undefined || row.requestUserAgent === null
        ? null
        : String(row.requestUserAgent),
  };
}

// SQL written SQLite-first with quoted identifiers (valid for both backends);
// DbUtils converts `?` placeholders to `$N` for PostgreSQL.
const SQL = {
  SELECT_BY_REQUEST_TOKEN_HASH: `SELECT * FROM "${LOGIN_CODES_TABLE}" WHERE "requestTokenHash" = ? LIMIT 1`,
  SELECT_BY_CODE_HASH: `SELECT * FROM "${LOGIN_CODES_TABLE}" WHERE "codeHash" = ? OR "previousCodeHash" = ? ORDER BY CASE WHEN "codeHash" = ? THEN 0 ELSE 1 END LIMIT 1`,
  INSERT_IF_BELOW_PENDING_CAP:
    `INSERT INTO "${LOGIN_CODES_TABLE}" ("id", "requestTokenHash", "codeHash", "codeExpiresAt", "status", "createdAt", "updatedAt", "expiresAt", "attempts", "requestUserAgent") ` +
    `SELECT ?, ?, ?, ?, 'pending', ?, ?, ?, 0, ? ` +
    `WHERE (SELECT COUNT(*) FROM "${LOGIN_CODES_TABLE}" WHERE "status" = 'pending') < ?`,
  ROTATE:
    `UPDATE "${LOGIN_CODES_TABLE}" SET "previousCodeHash" = "codeHash", "previousCodeExpiresAt" = ?, "codeHash" = ?, "codeExpiresAt" = ?, "updatedAt" = ? ` +
    `WHERE "id" = ? AND "status" = 'pending' AND "codeHash" = ?`,
  APPROVE:
    `UPDATE "${LOGIN_CODES_TABLE}" SET "status" = 'approved', "approvedAt" = ?, "approvedByUserId" = ?, "updatedAt" = ? ` +
    `WHERE "id" = ? AND "status" = 'pending' AND ("codeHash" = ? OR ("previousCodeHash" = ? AND "previousCodeExpiresAt" > ?))`,
  CONSUME:
    `UPDATE "${LOGIN_CODES_TABLE}" SET "status" = 'consumed', "consumedAt" = ?, "updatedAt" = ? ` +
    `WHERE "requestTokenHash" = ? AND "status" = 'approved'`,
  CANCEL:
    `UPDATE "${LOGIN_CODES_TABLE}" SET "status" = 'cancelled', "updatedAt" = ? ` +
    `WHERE "requestTokenHash" = ? AND "status" = 'pending'`,
  MARK_EXPIRED:
    `UPDATE "${LOGIN_CODES_TABLE}" SET "status" = 'expired', "updatedAt" = ? ` +
    `WHERE "id" = ? AND "status" IN ('pending', 'approved')`,
  MARK_FAILED:
    `UPDATE "${LOGIN_CODES_TABLE}" SET "status" = 'failed', "updatedAt" = ? ` +
    `WHERE "id" = ? AND "status" IN ('pending', 'approved')`,
  RECORD_ATTEMPT:
    `UPDATE "${LOGIN_CODES_TABLE}" SET "attempts" = "attempts" + 1, "updatedAt" = ? ` +
    `WHERE "id" = ? AND "status" = 'pending' AND "attempts" < ?`,
  CLEANUP:
    `DELETE FROM "${LOGIN_CODES_TABLE}" WHERE "id" IN (` +
    `SELECT "id" FROM "${LOGIN_CODES_TABLE}" WHERE "createdAt" < ? ORDER BY "createdAt" ASC LIMIT ?)`,
};

/** A {@link LoginCodesStore} over Planner's database layer. */
export function LoginCodesDataCreateStore(): LoginCodesStore {
  // Per-instance probe cache: only a definitive missing-table result is cached.
  let missingTable = false;

  async function exec(sql: string, params: unknown[]): Promise<number> {
    return DbUtilsExecSQL(sql, params);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function query(sql: string, params: unknown[]): Promise<any[]> {
    return DbUtilsQuerySQL(sql, params);
  }

  return {
    async available(): Promise<boolean> {
      if (missingTable) {
        return false;
      }
      try {
        await query(`SELECT "id" FROM "${LOGIN_CODES_TABLE}" LIMIT 1`, []);
        return true;
      } catch (error) {
        if (isMissingTableError(error)) {
          missingTable = true;
          return false;
        }
        throw error;
      }
    },

    async create(input: LoginCodeCreateInput): Promise<LoginCodeCreateResult> {
      try {
        return await DbUtilsTransaction(async (): Promise<LoginCodeCreateResult> => {
          if (DbUtilsGetType() === "postgres") {
            // Serialize the count-then-insert pair across replicas.
            await query("SELECT pg_advisory_xact_lock(hashtext(?))", [
              LOGIN_CODES_CREATE_LOCK_KEY,
            ]);
          }
          const changes = await exec(SQL.INSERT_IF_BELOW_PENDING_CAP, [
            input.id,
            input.requestTokenHash,
            input.codeHash,
            input.codeExpiresAt,
            input.createdAt,
            input.updatedAt,
            input.expiresAt,
            input.requestUserAgent,
            input.maxPending,
          ]);
          if (Number(changes) === 0) {
            return { ok: false, reason: "pending_cap" };
          }
          return { ok: true };
        });
      } catch (error) {
        if (DbUtilsIsUniqueViolation(error)) {
          return { ok: false, reason: "conflict" };
        }
        throw error;
      }
    },

    async getByRequestTokenHash(
      requestTokenHash: string,
    ): Promise<LoginCodeRecord | null> {
      const rows = await query(SQL.SELECT_BY_REQUEST_TOKEN_HASH, [
        requestTokenHash,
      ]);
      return rows.length > 0 ? fromRaw(rows[0]) : null;
    },

    async getByCodeHash(codeHash: string): Promise<LoginCodeRecord | null> {
      const rows = await query(SQL.SELECT_BY_CODE_HASH, [
        codeHash,
        codeHash,
        codeHash,
      ]);
      return rows.length > 0 ? fromRaw(rows[0]) : null;
    },

    async rotate(input: LoginCodeRotateInput): Promise<boolean> {
      const changes = await exec(SQL.ROTATE, [
        input.previousCodeExpiresAt,
        input.newCodeHash,
        input.codeExpiresAt,
        input.updatedAt,
        input.id,
        input.expectedCodeHash,
      ]);
      return changes > 0;
    },

    async approve(input: LoginCodeApproveInput): Promise<boolean> {
      const changes = await exec(SQL.APPROVE, [
        input.approvedAt,
        input.approvedByUserId,
        input.now,
        input.id,
        input.submittedCodeHash,
        input.submittedCodeHash,
        input.now,
      ]);
      return changes > 0;
    },

    async consume(
      input: LoginCodeConsumeInput,
    ): Promise<LoginCodeRecord | null> {
      const changes = await exec(SQL.CONSUME, [
        input.consumedAt,
        input.updatedAt,
        input.requestTokenHash,
      ]);
      if (changes === 0) {
        return null;
      }
      const rows = await query(SQL.SELECT_BY_REQUEST_TOKEN_HASH, [
        input.requestTokenHash,
      ]);
      return rows.length > 0 ? fromRaw(rows[0]) : null;
    },

    async cancel(input: LoginCodeCancelInput): Promise<boolean> {
      const changes = await exec(SQL.CANCEL, [
        input.updatedAt,
        input.requestTokenHash,
      ]);
      return changes > 0;
    },

    async markExpired(input: LoginCodeMarkInput): Promise<boolean> {
      const changes = await exec(SQL.MARK_EXPIRED, [
        input.updatedAt,
        input.id,
      ]);
      return changes > 0;
    },

    async markFailed(input: LoginCodeMarkInput): Promise<boolean> {
      const changes = await exec(SQL.MARK_FAILED, [input.updatedAt, input.id]);
      return changes > 0;
    },

    async recordAttempt(input: LoginCodeAttemptInput): Promise<boolean> {
      const changes = await exec(SQL.RECORD_ATTEMPT, [
        input.updatedAt,
        input.id,
        input.maxAttempts,
      ]);
      return changes > 0;
    },

    async cleanup(input: LoginCodeCleanupInput): Promise<number> {
      return exec(SQL.CLEANUP, [input.olderThan, input.limit]);
    },
  };
}
