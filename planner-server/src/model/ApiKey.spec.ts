import { ApiKey, hashApiKey } from "./ApiKey";

describe("hashApiKey", () => {
  it("should be a deterministic SHA-256 hex digest", () => {
    const hash = hashApiKey("pk_example");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey("pk_example")).toBe(hash);
    expect(hashApiKey("pk_other")).not.toBe(hash);
  });
});

describe("ApiKey", () => {
  it("should generate keys with a recognizable prefix", () => {
    const apiKey = new ApiKey();
    expect(apiKey.key.startsWith("pk_")).toBe(true);
    expect(apiKey.keyHash).toBe(hashApiKey(apiKey.key));
    expect(apiKey.keyPrefix).toBe(apiKey.key.substring(0, 8));
  });

  it("should generate a fresh key for every instance", () => {
    expect(new ApiKey().key).not.toBe(new ApiKey().key);
  });

  it("should never expose the full key in the transport JSON", () => {
    const apiKey = new ApiKey();
    const transport = apiKey.toTransportJson() as Record<string, unknown>;
    expect(JSON.stringify(transport)).not.toContain(apiKey.key);
    expect(transport.key).toBe(`${apiKey.keyPrefix}...`);
    expect(transport.keyHash).toBeUndefined();
  });

  it("should parse a database row through fromJson", () => {
    const apiKey = ApiKey.fromJson({
      id: "key-1",
      userId: "user-1",
      key: "",
      keyHash: "abc123",
      keyPrefix: "pk_12345",
      expiresAt: "2030-01-01T00:00:00.000Z",
      dateCreated: "2026-01-01T00:00:00.000Z",
    });
    expect(apiKey.id).toBe("key-1");
    expect(apiKey.userId).toBe("user-1");
    expect(apiKey.keyHash).toBe("abc123");
    expect(apiKey.keyPrefix).toBe("pk_12345");
    expect(apiKey.expiresAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("should default optional fields to null in fromJson", () => {
    const apiKey = ApiKey.fromJson({
      id: "key-1",
      userId: "user-1",
      dateCreated: "2026-01-01T00:00:00.000Z",
    });
    expect(apiKey.key).toBe("");
    expect(apiKey.keyHash).toBeNull();
    expect(apiKey.keyPrefix).toBeNull();
    expect(apiKey.expiresAt).toBeNull();
  });
});
