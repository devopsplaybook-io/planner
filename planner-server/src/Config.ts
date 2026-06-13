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
  }

  public async reload(): Promise<void> {
    const config = await fs.readJson(this.CONFIG_FILE);

    this.APPLICATION_TITLE = config.APPLICATION_TITLE || "Planner";
    this.API_PORT = config.API_PORT || 8080;
    this.CORS_POLICY_ORIGIN = config.CORS_POLICY_ORIGIN || "";
    this.JWT_KEY = config.JWT_KEY || "dev";
    this.DATABASE_TYPE = config.DATABASE_TYPE || "sqlite";
    this.JWT_VALIDITY_DURATION = config.JWT_VALIDITY_DURATION || 86400;
    this.LLM_API_KEY = config.LLM_API_KEY || "";
    this.LLM_API_URL =
      config.LLM_API_URL || "https://api.deepseek.com/chat/completions";
    this.LLM_MODEL = config.LLM_MODEL || "deepseek-chat";
    this.LLM_RECOMMENDATION_ENABLED =
      config.LLM_RECOMMENDATION_ENABLED ?? false;
    this.LLM_RECOMMENDATION_SCHEDULE_CRON =
      config.LLM_RECOMMENDATION_SCHEDULE_CRON || "0 0 * * *";

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
  }
}
