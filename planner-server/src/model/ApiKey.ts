import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export class ApiKey {
  public static fromJson(json: Record<string, unknown>): ApiKey {
    if (!json) {
      return null;
    }
    const apiKey = new ApiKey();
    if (json.id) {
      apiKey.id = json.id as string;
    }
    apiKey.userId = json.userId as string;
    apiKey.key = (json.key as string) || "";
    apiKey.keyHash = (json.keyHash as string) || null;
    apiKey.keyPrefix = (json.keyPrefix as string) || null;
    apiKey.expiresAt = (json.expiresAt as string) || null;
    apiKey.dateCreated = json.dateCreated as string;
    return apiKey;
  }

  public static generateKey(): string {
    return "pk_" + crypto.randomBytes(24).toString("hex");
  }

  public id: string;
  public userId: string;
  /** Full key, only populated in memory at creation time — never stored. */
  public key: string;
  /** SHA-256 of the key: what is actually stored and looked up on auth. */
  public keyHash: string;
  /** First characters of the key, kept for display/masking. */
  public keyPrefix: string;
  /** Optional ISO 8601 expiry timestamp; expired keys are rejected. */
  public expiresAt: string;
  public dateCreated: string;

  constructor() {
    this.id = uuidv4();
    this.key = ApiKey.generateKey();
    this.keyHash = hashApiKey(this.key);
    this.keyPrefix = this.key.substring(0, 8);
    this.dateCreated = new Date().toISOString();
  }

  public toJson(): Record<string, unknown> {
    return {
      id: this.id,
      userId: this.userId,
      key: this.key,
      keyHash: this.keyHash,
      keyPrefix: this.keyPrefix,
      expiresAt: this.expiresAt,
      dateCreated: this.dateCreated,
    };
  }

  public toTransportJson(): Record<string, unknown> {
    return {
      id: this.id,
      userId: this.userId,
      key: this.keyPrefix ? `${this.keyPrefix}...` : "",
      keyPrefix: this.keyPrefix,
      expiresAt: this.expiresAt,
      dateCreated: this.dateCreated,
    };
  }
}
