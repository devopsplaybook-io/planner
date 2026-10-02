import { ApiKey, hashApiKey } from "../model/ApiKey";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "../utils/DbUtils";
import {
  ApiKeysDataAdd,
  ApiKeysDataBackfillHashes,
  ApiKeysDataDeleteByUserId,
  ApiKeysDataGetByKey,
  ApiKeysDataGetByUserId,
  ApiKeysDataList,
} from "./ApiKeysData";

jest.mock("../utils/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(async () => []),
  DbUtilsExecSQL: jest.fn(async () => 1),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

const mockQuery = DbUtilsQuerySQL as jest.Mock;
const mockExec = DbUtilsExecSQL as jest.Mock;

describe("ApiKeysDataGetByKey", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockExec.mockReset();
  });

  it("should look the key up by its SHA-256 hash, never by plaintext", async () => {
    const presented = "pk_presentedkey";
    mockQuery.mockResolvedValueOnce([
      {
        id: "key-1",
        userId: "user-1",
        keyHash: hashApiKey(presented),
        keyPrefix: "pk_prese",
        expiresAt: null,
        dateCreated: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const found = await ApiKeysDataGetByKey(presented);

    expect(found).not.toBeNull();
    expect(found.userId).toBe("user-1");
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([hashApiKey(presented)]);
    expect(params).not.toContain(presented);
  });

  it("should return null for an unknown key", async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await ApiKeysDataGetByKey("pk_unknown")).toBeNull();
  });

  it("should reject an expired key", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "key-1",
        userId: "user-1",
        keyHash: hashApiKey("pk_expired"),
        keyPrefix: "pk_expir",
        expiresAt: "2020-01-01T00:00:00.000Z",
        dateCreated: "2020-01-01T00:00:00.000Z",
      },
    ]);
    expect(await ApiKeysDataGetByKey("pk_expired")).toBeNull();
  });

  it("should accept a key with a future expiry", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "key-1",
        userId: "user-1",
        keyHash: hashApiKey("pk_valid"),
        keyPrefix: "pk_valid",
        expiresAt: "2999-01-01T00:00:00.000Z",
        dateCreated: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const found = await ApiKeysDataGetByKey("pk_valid");
    expect(found).not.toBeNull();
    expect(found.expiresAt).toBe("2999-01-01T00:00:00.000Z");
  });
});

describe("ApiKeysDataAdd", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockExec.mockReset();
  });

  it("should delete the previous key and store only the hash", async () => {
    const apiKey = new ApiKey();
    apiKey.userId = "user-1";

    await ApiKeysDataAdd(apiKey);

    // One DELETE (1 key per user) + one INSERT
    expect(mockExec).toHaveBeenCalledTimes(2);
    const [deleteSql, deleteParams] = mockExec.mock.calls[0];
    expect(deleteSql).toContain("DELETE FROM api_keys");
    expect(deleteParams).toEqual(["user-1"]);

    const [insertSql, insertParams] = mockExec.mock.calls[1];
    expect(insertSql).toContain("INSERT INTO api_keys");
    // The key column is written as an empty string; the hash is stored
    expect(insertParams).toContain(apiKey.keyHash);
    expect(insertParams).toContain(apiKey.keyPrefix);
    expect(insertParams).not.toContain(apiKey.key);
    expect(insertSql).toContain("''");
  });

  it("should store a null expiry when none is set", async () => {
    const apiKey = new ApiKey();
    apiKey.userId = "user-1";
    await ApiKeysDataAdd(apiKey);
    const [, insertParams] = mockExec.mock.calls[1];
    expect(insertParams).toContain(null);
  });
});

describe("ApiKeysDataList / DeleteByUserId", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockExec.mockReset();
  });

  it("should list every key row without key material columns being leaked by the model", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "key-1",
        userId: "user-1",
        keyHash: "hash-1",
        keyPrefix: "pk_aaaaa",
        expiresAt: null,
        dateCreated: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const keys = await ApiKeysDataList();
    expect(keys).toHaveLength(1);
    expect(keys[0].keyPrefix).toBe("pk_aaaaa");
  });

  it("should delete by user id", async () => {
    await ApiKeysDataDeleteByUserId("user-1");
    expect(mockExec).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExec.mock.calls[0];
    expect(sql).toContain("DELETE FROM api_keys");
    expect(params).toEqual(["user-1"]);
  });

  it("should get by user id", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "key-1",
        userId: "user-1",
        keyHash: "hash-1",
        keyPrefix: "pk_aaaaa",
        expiresAt: null,
        dateCreated: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const key = await ApiKeysDataGetByUserId("user-1");
    expect(key).not.toBeNull();
    expect(key.userId).toBe("user-1");
  });
});

describe("ApiKeysDataBackfillHashes", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockExec.mockReset();
  });

  it("should hash legacy plaintext rows and clear the plaintext", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "legacy-1",
        userId: "user-1",
        key: "pk_legacyplaintext",
        keyHash: null,
        keyPrefix: null,
        expiresAt: null,
        dateCreated: "2026-01-01T00:00:00.000Z",
      },
    ]);

    await ApiKeysDataBackfillHashes();

    expect(mockExec).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExec.mock.calls[0];
    expect(sql).toContain("UPDATE api_keys");
    expect(params).toEqual([
      hashApiKey("pk_legacyplaintext"),
      "pk_legac",
      "legacy-1",
    ]);
  });

  it("should skip rows that already have a hash (idempotent)", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "hashed-1",
        userId: "user-1",
        key: "",
        keyHash: "already-hashed",
        keyPrefix: "pk_abcde",
        expiresAt: null,
        dateCreated: "2026-01-01T00:00:00.000Z",
      },
    ]);

    await ApiKeysDataBackfillHashes();

    expect(mockExec).not.toHaveBeenCalled();
  });

  it("should skip rows without any key material", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "empty-1",
        userId: "user-1",
        key: "",
        keyHash: null,
        keyPrefix: null,
        expiresAt: null,
        dateCreated: "2026-01-01T00:00:00.000Z",
      },
    ]);

    await ApiKeysDataBackfillHashes();

    expect(mockExec).not.toHaveBeenCalled();
  });
});
