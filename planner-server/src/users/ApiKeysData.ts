import { ApiKey, hashApiKey } from "../model/ApiKey";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
} from "../utils/DbUtils";

export async function ApiKeysDataGetByUserId(
  userId: string,
): Promise<ApiKey | null> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_BY_USER_ID[DbUtilsGetType()],
    [userId],
  );
  if (rows.length === 0) {
    return null;
  }
  return ApiKey.fromJson(rows[0]);
}

/**
 * Resolves a presented key by its SHA-256 hash. Plaintext keys are never
 * stored; expired keys are rejected.
 */
export async function ApiKeysDataGetByKey(
  key: string,
): Promise<ApiKey | null> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_BY_KEY_HASH[DbUtilsGetType()],
    [hashApiKey(key)],
  );
  if (rows.length === 0) {
    return null;
  }
  const apiKey = ApiKey.fromJson(rows[0]);
  if (apiKey.expiresAt && apiKey.expiresAt < new Date().toISOString()) {
    return null;
  }
  return apiKey;
}

export async function ApiKeysDataAdd(apiKey: ApiKey): Promise<void> {
  // Delete any existing key for this user first (1 per user)
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_BY_USER_ID[DbUtilsGetType()], [
    apiKey.userId,
  ]);
  await DbUtilsExecSQL(SQL_QUERIES.INSERT[DbUtilsGetType()], [
    apiKey.id,
    apiKey.userId,
    apiKey.keyHash,
    apiKey.keyPrefix,
    apiKey.expiresAt || null,
    apiKey.dateCreated,
  ]);
}

export async function ApiKeysDataDeleteByUserId(
  userId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_BY_USER_ID[DbUtilsGetType()], [
    userId,
  ]);
}

/** All API keys with their metadata (never key material). */
export async function ApiKeysDataList(): Promise<ApiKey[]> {
  const rows = await DbUtilsQuerySQL(SQL_QUERIES.LIST[DbUtilsGetType()], []);
  return rows.map((row) => ApiKey.fromJson(row));
}

/**
 * One-time upgrade of rows created before keys were hashed: hash the stored
 * plaintext key and clear it. Presented keys keep working (lookup is by
 * hash). Idempotent: rows already hashed are skipped.
 */
export async function ApiKeysDataBackfillHashes(): Promise<void> {
  const rows = await DbUtilsQuerySQL(SQL_QUERIES.LIST[DbUtilsGetType()], []);
  for (const row of rows) {
    if (!row.keyHash && row.key) {
      await DbUtilsExecSQL(SQL_QUERIES.BACKFILL_HASH[DbUtilsGetType()], [
        hashApiKey(row.key),
        row.key.substring(0, 8),
        row.id,
      ]);
    }
  }
}

const SQL_QUERIES = {
  GET_BY_USER_ID: {
    postgres: 'SELECT * FROM api_keys WHERE "userId" = $1',
    sqlite: "SELECT * FROM api_keys WHERE userId = ?",
  },
  GET_BY_KEY_HASH: {
    postgres: 'SELECT * FROM api_keys WHERE "keyHash" = $1',
    sqlite: "SELECT * FROM api_keys WHERE keyHash = ?",
  },
  LIST: {
    postgres: "SELECT * FROM api_keys",
    sqlite: "SELECT * FROM api_keys",
  },
  INSERT: {
    postgres:
      'INSERT INTO api_keys ("id", "userId", "key", "keyHash", "keyPrefix", "expiresAt", "dateCreated") VALUES ($1, $2, \'\', $3, $4, $5, $6)',
    sqlite:
      "INSERT INTO api_keys (id, userId, key, keyHash, keyPrefix, expiresAt, dateCreated) VALUES (?, ?, '', ?, ?, ?, ?)",
  },
  BACKFILL_HASH: {
    postgres:
      'UPDATE api_keys SET "keyHash" = $1, "keyPrefix" = $2, "key" = \'\' WHERE "id" = $3',
    sqlite:
      "UPDATE api_keys SET keyHash = ?, keyPrefix = ?, key = '' WHERE id = ?",
  },
  DELETE_BY_USER_ID: {
    postgres: 'DELETE FROM api_keys WHERE "userId" = $1',
    sqlite: "DELETE FROM api_keys WHERE userId = ?",
  },
};
