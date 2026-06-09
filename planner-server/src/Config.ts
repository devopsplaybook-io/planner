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
    this.JWT_VALIDITY_DURATION = 86400; // 24 hours
  }

  public async reload(): Promise<void> {
    const config = await fs.readJson(this.CONFIG_FILE);

    this.APPLICATION_TITLE = config.APPLICATION_TITLE || "Planner";
    this.API_PORT = config.API_PORT || 8080;
    this.CORS_POLICY_ORIGIN = config.CORS_POLICY_ORIGIN || "";
    this.JWT_KEY = config.JWT_KEY || "dev";
    this.DATABASE_TYPE = config.DATABASE_TYPE || "sqlite";
    this.JWT_VALIDITY_DURATION = config.JWT_VALIDITY_DURATION || 86400;

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
  }
}
