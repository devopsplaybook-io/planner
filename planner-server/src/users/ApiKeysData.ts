import { ApiKey } from "../model/ApiKey";
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

export async function ApiKeysDataGetByKey(
  key: string,
): Promise<ApiKey | null> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_BY_KEY[DbUtilsGetType()],
    [key],
  );
  if (rows.length === 0) {
    return null;
  }
  return ApiKey.fromJson(rows[0]);
}

export async function ApiKeysDataAdd(apiKey: ApiKey): Promise<void> {
  // Delete any existing key for this user first (1 per user)
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_BY_USER_ID[DbUtilsGetType()], [
    apiKey.userId,
  ]);
  await DbUtilsExecSQL(SQL_QUERIES.INSERT[DbUtilsGetType()], [
    apiKey.id,
    apiKey.userId,
    apiKey.key,
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

const SQL_QUERIES = {
  GET_BY_USER_ID: {
    postgres: 'SELECT * FROM api_keys WHERE "userId" = $1',
    sqlite: "SELECT * FROM api_keys WHERE userId = ?",
  },
  GET_BY_KEY: {
    postgres: 'SELECT * FROM api_keys WHERE "key" = $1',
    sqlite: "SELECT * FROM api_keys WHERE key = ?",
  },
  INSERT: {
    postgres:
      'INSERT INTO api_keys ("id", "userId", "key", "dateCreated") VALUES ($1, $2, $3, $4)',
    sqlite:
      "INSERT INTO api_keys (id, userId, key, dateCreated) VALUES (?, ?, ?, ?)",
  },
  DELETE_BY_USER_ID: {
    postgres: 'DELETE FROM api_keys WHERE "userId" = $1',
    sqlite: "DELETE FROM api_keys WHERE userId = ?",
  },
};
