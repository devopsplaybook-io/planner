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

  // LLM Recommendation
  public LLM_API_KEY: string;
  public LLM_API_URL: string;
  public LLM_MODEL: string;
  public LLM_RECOMMENDATION_ENABLED: boolean;
  public LLM_RECOMMENDATION_SCHEDULE_CRON: string;

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
    this.LLM_API_KEY = "";
    this.LLM_API_URL = "https://api.deepseek.com/chat/completions";
    this.LLM_MODEL = "deepseek-chat";
    this.LLM_RECOMMENDATION_ENABLED = false;
    this.LLM_RECOMMENDATION_SCHEDULE_CRON = "0 0 * * *"; // daily at midnight
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
    this.JWT_KEY = config.JWT_KEY || "dev";
    this.DATABASE_TYPE = config.DATABASE_TYPE || "sqlite";
    this.JWT_VALIDITY_DURATION = config.JWT_VALIDITY_DURATION || 3600 * 24 * 30;
    this.LLM_API_KEY = config.LLM_API_KEY || "";
    this.LLM_API_URL =
      config.LLM_API_URL || "https://api.deepseek.com/chat/completions";
    this.LLM_MODEL = config.LLM_MODEL || "deepseek-chat";
    this.LLM_RECOMMENDATION_ENABLED =
      config.LLM_RECOMMENDATION_ENABLED ?? false;
    this.LLM_RECOMMENDATION_SCHEDULE_CRON =
      config.LLM_RECOMMENDATION_SCHEDULE_CRON || "0 0 * * *";
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
  }
}
