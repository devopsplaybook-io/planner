import * as fs from "fs-extra";
import * as path from "path";

export class Config {
  public CONFIG_FILE: string;
  public DATA_DIR: string;
  public TMP_DIR: string;
  public DEV_MODE: boolean;

  public APPLICATION_TITLE: string;
  public API_PORT: number;
  public CORS_POLICY_ORIGIN: string;
  public JWT_KEY: string;
  public DATABASE_TYPE: string;
  public JWT_VALIDITY_DURATION: number;
  public ATTACHMENT_MAX_SIZE: number;

  // LLM Recommendation
  public LLM_API_KEY: string;
  public LLM_API_URL: string;
  public LLM_MODEL: string;
  public LLM_RECOMMENDATION_ENABLED: boolean;
  public LLM_RECOMMENDATION_SCHEDULE_CRON: string;

  // Rate limits (per user, per hour) for the LLM-backed endpoints
  public RATE_LIMIT_LLM_IMPROVE_MAX: number;
  public RATE_LIMIT_LLM_REGENERATE_MAX: number;

  // Dictation (voice to text)
  public DICTATION_ENABLED: boolean;
  public STT_MODE: string;
  public STT_API_URL: string;
  public STT_API_KEY: string;
  public STT_MODEL: string;
  public STT_EMBEDDED_MODEL: string;
  public STT_EMBEDDED_BIN_PATH: string;
  public DICTATION_LANGUAGE: string;
  public DICTATION_MAX_DURATION_SECONDS: number;
  public DICTATION_MAX_UPLOAD_MB: number;
  public RATE_LIMIT_DICTATION_MAX: number;

  // Web Push Notifications
  public WEB_PUSH_ENABLED: boolean;
  public WEB_PUSH_SUBJECT: string;
  public WEB_PUSH_NOTIFY_HOUR: number;
  public WEB_PUSH_SCHEDULE_CRON: string;
  public WEB_PUSH_TIMEZONE: string;
  public WEB_PUSH_VAPID_PUBLIC_KEY: string;
  public WEB_PUSH_VAPID_PRIVATE_KEY: string;

  constructor() {
    this.DATA_DIR = process.env.DATA_DIR || "/data";
    this.TMP_DIR = process.env.TMP_DIR || "/tmp";
    this.DEV_MODE = process.env.DEV_MODE === "true";

    this.CONFIG_FILE =
      process.env.CONFIG_FILE || path.join(__dirname, "../config.json");

    this.APPLICATION_TITLE = "Planner";
    this.API_PORT = 8080;
    this.CORS_POLICY_ORIGIN = "";
    this.JWT_KEY = "";
    this.DATABASE_TYPE = "sqlite";
    this.JWT_VALIDITY_DURATION = 3600 * 24 * 30;
    this.ATTACHMENT_MAX_SIZE = 10;
    this.LLM_API_KEY = "";
    this.LLM_API_URL = "https://api.deepseek.com/chat/completions";
    this.LLM_MODEL = "deepseek-chat";
    this.LLM_RECOMMENDATION_ENABLED = false;
    this.LLM_RECOMMENDATION_SCHEDULE_CRON = "0 0 * * *"; // daily at midnight
    this.RATE_LIMIT_LLM_IMPROVE_MAX = 30;
    this.RATE_LIMIT_LLM_REGENERATE_MAX = 5;
    this.DICTATION_ENABLED = false;
    this.STT_MODE = "external";
    this.STT_API_URL = "";
    this.STT_API_KEY = "";
    this.STT_MODEL = "whisper-large-v3-turbo";
    this.STT_EMBEDDED_MODEL = "ggml-base";
    this.STT_EMBEDDED_BIN_PATH = "";
    this.DICTATION_LANGUAGE = "auto";
    this.DICTATION_MAX_DURATION_SECONDS = 120;
    this.DICTATION_MAX_UPLOAD_MB = 10;
    this.RATE_LIMIT_DICTATION_MAX = 30;
    this.WEB_PUSH_ENABLED = true;
    this.WEB_PUSH_SUBJECT = "mailto:admin@localhost";
    this.WEB_PUSH_NOTIFY_HOUR = 9; // send notifications from 9:00
    this.WEB_PUSH_SCHEDULE_CRON = "*/15 * * * *"; // check every 15 minutes
    this.WEB_PUSH_TIMEZONE = ""; // empty: use the server timezone
    this.WEB_PUSH_VAPID_PUBLIC_KEY = "";
    this.WEB_PUSH_VAPID_PRIVATE_KEY = "";
  }

  public async reload(): Promise<void> {
    const config = await fs.readJson(this.CONFIG_FILE);

    this.APPLICATION_TITLE = config.APPLICATION_TITLE || "Planner";
    this.API_PORT = config.API_PORT || 8080;
    this.CORS_POLICY_ORIGIN = config.CORS_POLICY_ORIGIN || "";
    this.JWT_KEY = config.JWT_KEY || "";
    this.DATABASE_TYPE = config.DATABASE_TYPE || "sqlite";
    this.JWT_VALIDITY_DURATION = config.JWT_VALIDITY_DURATION || 3600 * 24 * 30;
    this.ATTACHMENT_MAX_SIZE = config.ATTACHMENT_MAX_SIZE || 10;
    this.LLM_API_KEY = config.LLM_API_KEY || "";
    this.LLM_API_URL =
      config.LLM_API_URL || "https://api.deepseek.com/chat/completions";
    this.LLM_MODEL = config.LLM_MODEL || "deepseek-chat";
    this.LLM_RECOMMENDATION_ENABLED =
      config.LLM_RECOMMENDATION_ENABLED ?? false;
    this.LLM_RECOMMENDATION_SCHEDULE_CRON =
      config.LLM_RECOMMENDATION_SCHEDULE_CRON || "0 0 * * *";
    this.RATE_LIMIT_LLM_IMPROVE_MAX = config.RATE_LIMIT_LLM_IMPROVE_MAX || 30;
    this.RATE_LIMIT_LLM_REGENERATE_MAX =
      config.RATE_LIMIT_LLM_REGENERATE_MAX || 5;
    this.DICTATION_ENABLED = config.DICTATION_ENABLED ?? false;
    this.STT_MODE = config.STT_MODE || "external";
    this.STT_API_URL = config.STT_API_URL || "";
    this.STT_API_KEY = config.STT_API_KEY || "";
    this.STT_MODEL = config.STT_MODEL || "whisper-large-v3-turbo";
    this.STT_EMBEDDED_MODEL = config.STT_EMBEDDED_MODEL || "ggml-base";
    this.STT_EMBEDDED_BIN_PATH = config.STT_EMBEDDED_BIN_PATH || "";
    this.DICTATION_LANGUAGE = config.DICTATION_LANGUAGE || "auto";
    this.DICTATION_MAX_DURATION_SECONDS =
      config.DICTATION_MAX_DURATION_SECONDS || 120;
    this.DICTATION_MAX_UPLOAD_MB = config.DICTATION_MAX_UPLOAD_MB || 10;
    this.RATE_LIMIT_DICTATION_MAX = config.RATE_LIMIT_DICTATION_MAX || 30;
    this.WEB_PUSH_ENABLED = config.WEB_PUSH_ENABLED ?? true;
    this.WEB_PUSH_SUBJECT = config.WEB_PUSH_SUBJECT || "mailto:admin@localhost";
    this.WEB_PUSH_NOTIFY_HOUR = config.WEB_PUSH_NOTIFY_HOUR ?? 9;
    this.WEB_PUSH_SCHEDULE_CRON =
      config.WEB_PUSH_SCHEDULE_CRON || "*/15 * * * *";
    this.WEB_PUSH_TIMEZONE = config.WEB_PUSH_TIMEZONE || "";
    this.WEB_PUSH_VAPID_PUBLIC_KEY = config.WEB_PUSH_VAPID_PUBLIC_KEY || "";
    this.WEB_PUSH_VAPID_PRIVATE_KEY = config.WEB_PUSH_VAPID_PRIVATE_KEY || "";

    if (process.env.APPLICATION_TITLE) {
      this.APPLICATION_TITLE = process.env.APPLICATION_TITLE;
    }
    if (process.env.API_PORT) {
      this.API_PORT = parseInt(process.env.API_PORT);
    }
    if (process.env.CORS_POLICY_ORIGIN) {
      this.CORS_POLICY_ORIGIN = process.env.CORS_POLICY_ORIGIN;
    }
    if (process.env.JWT_KEY) {
      this.JWT_KEY = process.env.JWT_KEY;
    }
    if (process.env.JWT_VALIDITY_DURATION) {
      this.JWT_VALIDITY_DURATION =
        parseInt(process.env.JWT_VALIDITY_DURATION) || this.JWT_VALIDITY_DURATION;
    }
    if (process.env.ATTACHMENT_MAX_SIZE) {
      this.ATTACHMENT_MAX_SIZE =
        parseInt(process.env.ATTACHMENT_MAX_SIZE) || this.ATTACHMENT_MAX_SIZE;
    }
    if (process.env.DATABASE_TYPE) {
      this.DATABASE_TYPE = process.env.DATABASE_TYPE;
    }
    if (process.env.DATA_DIR) {
      this.DATA_DIR = process.env.DATA_DIR;
    }
    if (process.env.TMP_DIR) {
      this.TMP_DIR = process.env.TMP_DIR;
    }
    if (process.env.LLM_API_KEY) {
      this.LLM_API_KEY = process.env.LLM_API_KEY;
    }
    if (process.env.LLM_API_URL) {
      this.LLM_API_URL = process.env.LLM_API_URL;
    }
    if (process.env.LLM_MODEL) {
      this.LLM_MODEL = process.env.LLM_MODEL;
    }
    if (process.env.LLM_RECOMMENDATION_ENABLED) {
      this.LLM_RECOMMENDATION_ENABLED =
        process.env.LLM_RECOMMENDATION_ENABLED === "true";
    }
    if (process.env.LLM_RECOMMENDATION_SCHEDULE_CRON) {
      this.LLM_RECOMMENDATION_SCHEDULE_CRON =
        process.env.LLM_RECOMMENDATION_SCHEDULE_CRON;
    }
    if (process.env.RATE_LIMIT_LLM_IMPROVE_MAX) {
      this.RATE_LIMIT_LLM_IMPROVE_MAX =
        parseInt(process.env.RATE_LIMIT_LLM_IMPROVE_MAX) ||
        this.RATE_LIMIT_LLM_IMPROVE_MAX;
    }
    if (process.env.RATE_LIMIT_LLM_REGENERATE_MAX) {
      this.RATE_LIMIT_LLM_REGENERATE_MAX =
        parseInt(process.env.RATE_LIMIT_LLM_REGENERATE_MAX) ||
        this.RATE_LIMIT_LLM_REGENERATE_MAX;
    }
    if (process.env.DICTATION_ENABLED) {
      this.DICTATION_ENABLED = process.env.DICTATION_ENABLED === "true";
    }
    if (process.env.STT_MODE) {
      this.STT_MODE = process.env.STT_MODE;
    }
    if (process.env.STT_API_URL) {
      this.STT_API_URL = process.env.STT_API_URL;
    }
    if (process.env.STT_API_KEY) {
      this.STT_API_KEY = process.env.STT_API_KEY;
    }
    if (process.env.STT_MODEL) {
      this.STT_MODEL = process.env.STT_MODEL;
    }
    if (process.env.STT_EMBEDDED_MODEL) {
      this.STT_EMBEDDED_MODEL = process.env.STT_EMBEDDED_MODEL;
    }
    if (process.env.STT_EMBEDDED_BIN_PATH) {
      this.STT_EMBEDDED_BIN_PATH = process.env.STT_EMBEDDED_BIN_PATH;
    }
    if (process.env.DICTATION_LANGUAGE) {
      this.DICTATION_LANGUAGE = process.env.DICTATION_LANGUAGE;
    }
    if (process.env.DICTATION_MAX_DURATION_SECONDS) {
      this.DICTATION_MAX_DURATION_SECONDS =
        parseInt(process.env.DICTATION_MAX_DURATION_SECONDS) ||
        this.DICTATION_MAX_DURATION_SECONDS;
    }
    if (process.env.DICTATION_MAX_UPLOAD_MB) {
      this.DICTATION_MAX_UPLOAD_MB =
        parseInt(process.env.DICTATION_MAX_UPLOAD_MB) ||
        this.DICTATION_MAX_UPLOAD_MB;
    }
    if (process.env.RATE_LIMIT_DICTATION_MAX) {
      this.RATE_LIMIT_DICTATION_MAX =
        parseInt(process.env.RATE_LIMIT_DICTATION_MAX) ||
        this.RATE_LIMIT_DICTATION_MAX;
    }
    if (process.env.WEB_PUSH_ENABLED) {
      this.WEB_PUSH_ENABLED = process.env.WEB_PUSH_ENABLED === "true";
    }
    if (process.env.WEB_PUSH_SUBJECT) {
      this.WEB_PUSH_SUBJECT = process.env.WEB_PUSH_SUBJECT;
    }
    if (process.env.WEB_PUSH_NOTIFY_HOUR) {
      this.WEB_PUSH_NOTIFY_HOUR = parseInt(process.env.WEB_PUSH_NOTIFY_HOUR);
    }
    if (process.env.WEB_PUSH_SCHEDULE_CRON) {
      this.WEB_PUSH_SCHEDULE_CRON = process.env.WEB_PUSH_SCHEDULE_CRON;
    }
    if (process.env.WEB_PUSH_TIMEZONE) {
      this.WEB_PUSH_TIMEZONE = process.env.WEB_PUSH_TIMEZONE;
    }
    if (process.env.WEB_PUSH_VAPID_PUBLIC_KEY) {
      this.WEB_PUSH_VAPID_PUBLIC_KEY = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    }
    if (process.env.WEB_PUSH_VAPID_PRIVATE_KEY) {
      this.WEB_PUSH_VAPID_PRIVATE_KEY = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    }

    // Never run with a missing or publicly known JWT secret outside of
    // development: tokens signed with it can be forged by anyone.
    if (!this.DEV_MODE && (!this.JWT_KEY || this.JWT_KEY === "dev")) {
      throw new Error(
        "JWT_KEY must be set to a strong, private value (or start with DEV_MODE=true for local development)",
      );
    }
  }
}
