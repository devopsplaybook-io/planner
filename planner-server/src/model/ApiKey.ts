import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";

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
    apiKey.key = json.key as string;
    apiKey.dateCreated = json.dateCreated as string;
    return apiKey;
  }

  public static generateKey(): string {
    return "pk_" + crypto.randomBytes(24).toString("hex");
  }

  public id: string;
  public userId: string;
  public key: string;
  public dateCreated: string;

  constructor() {
    this.id = uuidv4();
    this.key = ApiKey.generateKey();
    this.dateCreated = new Date().toISOString();
  }

  public toJson(): Record<string, unknown> {
    return {
      id: this.id,
      userId: this.userId,
      key: this.key,
      dateCreated: this.dateCreated,
    };
  }

  public toTransportJson(): Record<string, unknown> {
    // Mask the key for display: show first 6 and last 4 chars
    const masked =
      this.key.substring(0, 6) + "..." + this.key.substring(this.key.length - 4);
    return {
      id: this.id,
      userId: this.userId,
      key: masked,
      dateCreated: this.dateCreated,
    };
  }
}
