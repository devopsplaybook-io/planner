import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";

/**
 * Development-only JWT signing key, generated on first use and kept for the
 * life of the process so tokens survive configuration reloads. DEV_MODE
 * still requires a usable key: signing with an empty secret makes every
 * login fail.
 */
let generatedDevJwtKey: string | null = null;

const LANGUAGE_CODE_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

/**
 * Normalizes a dictation language list: trims, lowercases, drops empty,
 * malformed and duplicate entries. Falls back to the default list when the
 * result is empty. Exported for tests.
 */
export function ParseLanguageList(
  value: unknown,
  fallback: string[],
): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const languages: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const code = entry.trim().toLowerCase();
    if (
      !code ||
      code === "auto" ||
      !LANGUAGE_CODE_PATTERN.test(code) ||
      languages.includes(code)
    ) {
      continue;
    }
    languages.push(code);
  }
  return languages.length > 0 ? languages : [...fallback];
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function getDevelopmentJwtKey(): string {
  if (!generatedDevJwtKey) {
    generatedDevJwtKey = crypto.randomBytes(48).toString("hex");
  }
  return generatedDevJwtKey;
}

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
  /** 0 = auto (size the whisper.cpp threads from the cgroup CPU allowance) */
  public STT_EMBEDDED_THREADS: number;
  public STT_EMBEDDED_TRIM_SILENCE: boolean;
  public DICTATION_LANGUAGE: string;
  public DICTATION_LANGUAGES: string[];
  /** Estimated real-time factor used by the web for its ETA (0 = automatic) */
  public DICTATION_ESTIMATED_RTF: number;
  public DICTATION_MAX_DURATION_SECONDS: number;
  public DICTATION_MAX_UPLOAD_MB: number;
  public RATE_LIMIT_DICTATION_MAX: number;
  /** Max vocabulary terms injected into the STT initial prompt */
  public DICTATION_HOTWORDS_MAX: number;
  /** Max vocabulary terms stored per user across scopes */
  public DICTATION_VOCABULARY_MAX: number;
  /** UI threshold under which a segment is highlighted as low confidence */
  public DICTATION_CONFIDENCE_THRESHOLD: number;
  /** Max stored custom command phrases per user */
  public DICTATION_PHRASES_MAX: number;
  /** Per-user hourly limit of read-only questions */
  public RATE_LIMIT_DICTATION_ASK_MAX: number;
  /** Hard timeout of the optional answer-phrasing LLM call */
  public DICTATION_ASK_TIMEOUT_MS: number;
  // Long-form / meeting imports and the voice inbox
  public DICTATION_IMPORT_ENABLED: boolean;
  public DICTATION_IMPORT_MAX_MB: number;
  public DICTATION_IMPORT_MAX_DURATION_SECONDS: number;
  /** Target length of one transcription chunk (silence-aware plan) */
  public DICTATION_IMPORT_SEGMENT_SECONDS: number;
  public DICTATION_INBOX_TTL_HOURS: number;
  public DICTATION_MEETING_TTL_DAYS: number;
  /** Cap of kept (not deleted after transcription) audio bytes per user */
  public DICTATION_AUDIO_KEEP_MAX_MB: number;
  public DICTATION_AUDIO_RETENTION_DAYS: number;
  /** Global kill switch for the "dictation ready" push notification */
  public DICTATION_NOTIFY_READY: boolean;
  /** Per-user hourly limit of long-form imports */
  public RATE_LIMIT_DICTATION_IMPORT_MAX: number;

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
    this.STT_EMBEDDED_THREADS = 0;
    this.STT_EMBEDDED_TRIM_SILENCE = true;
    this.DICTATION_LANGUAGE = "auto";
    this.DICTATION_LANGUAGES = ["en", "fr", "de", "es", "it", "pt", "nl"];
    this.DICTATION_ESTIMATED_RTF = 0;
    this.DICTATION_MAX_DURATION_SECONDS = 120;
    this.DICTATION_MAX_UPLOAD_MB = 10;
    this.RATE_LIMIT_DICTATION_MAX = 30;
    this.DICTATION_HOTWORDS_MAX = 50;
    this.DICTATION_VOCABULARY_MAX = 200;
    this.DICTATION_CONFIDENCE_THRESHOLD = 0.6;
    this.DICTATION_PHRASES_MAX = 50;
    this.RATE_LIMIT_DICTATION_ASK_MAX = 30;
    this.DICTATION_ASK_TIMEOUT_MS = 15000;
    this.DICTATION_IMPORT_ENABLED = true;
    this.DICTATION_IMPORT_MAX_MB = 200;
    this.DICTATION_IMPORT_MAX_DURATION_SECONDS = 7200;
    this.DICTATION_IMPORT_SEGMENT_SECONDS = 30;
    this.DICTATION_INBOX_TTL_HOURS = 168;
    this.DICTATION_MEETING_TTL_DAYS = 7;
    this.DICTATION_AUDIO_KEEP_MAX_MB = 500;
    this.DICTATION_AUDIO_RETENTION_DAYS = 30;
    this.DICTATION_NOTIFY_READY = true;
    this.RATE_LIMIT_DICTATION_IMPORT_MAX = 5;
    this.WEB_PUSH_ENABLED = true;
    this.WEB_PUSH_SUBJECT = "mailto:admin@localhost";
    this.WEB_PUSH_NOTIFY_HOUR = 9; // send notifications from 9:00
    this.WEB_PUSH_SCHEDULE_CRON = "*/15 * * * *"; // check every 15 minutes
    this.WEB_PUSH_TIMEZONE = ""; // empty: use the server timezone
    this.WEB_PUSH_VAPID_PUBLIC_KEY = "";
    this.WEB_PUSH_VAPID_PRIVATE_KEY = "";
  }

  /**
   * True when the configured STT engine can actually run: embedded mode
   * needs a model, external mode needs endpoint URL, key and model. Shared
   * by the dictation availability endpoint and the dictation job setup.
   */
  public IsDictationSttConfigured(): boolean {
    return this.STT_MODE === "embedded"
      ? !!this.STT_EMBEDDED_MODEL
      : !!this.STT_API_URL && !!this.STT_API_KEY && !!this.STT_MODEL;
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
    this.STT_EMBEDDED_THREADS =
      Number.isFinite(config.STT_EMBEDDED_THREADS) &&
      config.STT_EMBEDDED_THREADS > 0
        ? Math.floor(config.STT_EMBEDDED_THREADS)
        : 0;
    this.STT_EMBEDDED_TRIM_SILENCE = config.STT_EMBEDDED_TRIM_SILENCE ?? true;
    this.DICTATION_LANGUAGE = config.DICTATION_LANGUAGE || "auto";
    this.DICTATION_LANGUAGES = ParseLanguageList(
      config.DICTATION_LANGUAGES,
      ["en", "fr", "de", "es", "it", "pt", "nl"],
    );
    this.DICTATION_ESTIMATED_RTF =
      Number.isFinite(config.DICTATION_ESTIMATED_RTF) &&
      config.DICTATION_ESTIMATED_RTF > 0
        ? config.DICTATION_ESTIMATED_RTF
        : 0;
    this.DICTATION_MAX_DURATION_SECONDS =
      config.DICTATION_MAX_DURATION_SECONDS || 120;
    this.DICTATION_MAX_UPLOAD_MB = config.DICTATION_MAX_UPLOAD_MB || 10;
    this.RATE_LIMIT_DICTATION_MAX = config.RATE_LIMIT_DICTATION_MAX || 30;
    this.DICTATION_HOTWORDS_MAX = clampInteger(
      config.DICTATION_HOTWORDS_MAX,
      1,
      200,
      50,
    );
    this.DICTATION_VOCABULARY_MAX = clampInteger(
      config.DICTATION_VOCABULARY_MAX,
      1,
      1000,
      200,
    );
    this.DICTATION_CONFIDENCE_THRESHOLD = clampNumber(
      config.DICTATION_CONFIDENCE_THRESHOLD,
      0.05,
      0.95,
      0.6,
    );
    this.DICTATION_PHRASES_MAX = clampInteger(
      config.DICTATION_PHRASES_MAX,
      1,
      500,
      50,
    );
    this.RATE_LIMIT_DICTATION_ASK_MAX =
      config.RATE_LIMIT_DICTATION_ASK_MAX || 30;
    this.DICTATION_ASK_TIMEOUT_MS = clampInteger(
      config.DICTATION_ASK_TIMEOUT_MS,
      1000,
      60000,
      15000,
    );
    this.DICTATION_IMPORT_ENABLED = config.DICTATION_IMPORT_ENABLED ?? true;
    this.DICTATION_IMPORT_MAX_MB = clampInteger(
      config.DICTATION_IMPORT_MAX_MB,
      1,
      2048,
      200,
    );
    this.DICTATION_IMPORT_MAX_DURATION_SECONDS = clampInteger(
      config.DICTATION_IMPORT_MAX_DURATION_SECONDS,
      60,
      43200,
      7200,
    );
    this.DICTATION_IMPORT_SEGMENT_SECONDS = clampInteger(
      config.DICTATION_IMPORT_SEGMENT_SECONDS,
      10,
      120,
      30,
    );
    this.DICTATION_INBOX_TTL_HOURS = clampInteger(
      config.DICTATION_INBOX_TTL_HOURS,
      1,
      8760,
      168,
    );
    this.DICTATION_MEETING_TTL_DAYS = clampInteger(
      config.DICTATION_MEETING_TTL_DAYS,
      1,
      365,
      7,
    );
    this.DICTATION_AUDIO_KEEP_MAX_MB = clampInteger(
      config.DICTATION_AUDIO_KEEP_MAX_MB,
      0,
      102400,
      500,
    );
    this.DICTATION_AUDIO_RETENTION_DAYS = clampInteger(
      config.DICTATION_AUDIO_RETENTION_DAYS,
      1,
      3650,
      30,
    );
    this.DICTATION_NOTIFY_READY = config.DICTATION_NOTIFY_READY ?? true;
    this.RATE_LIMIT_DICTATION_IMPORT_MAX = clampInteger(
      config.RATE_LIMIT_DICTATION_IMPORT_MAX,
      1,
      1000,
      5,
    );
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
    if (process.env.STT_EMBEDDED_THREADS) {
      const threads = parseInt(process.env.STT_EMBEDDED_THREADS);
      if (Number.isFinite(threads) && threads > 0) {
        this.STT_EMBEDDED_THREADS = threads;
      }
    }
    if (process.env.STT_EMBEDDED_TRIM_SILENCE) {
      this.STT_EMBEDDED_TRIM_SILENCE =
        process.env.STT_EMBEDDED_TRIM_SILENCE === "true";
    }
    if (process.env.DICTATION_LANGUAGE) {
      this.DICTATION_LANGUAGE = process.env.DICTATION_LANGUAGE;
    }
    if (process.env.DICTATION_LANGUAGES) {
      this.DICTATION_LANGUAGES = ParseLanguageList(
        process.env.DICTATION_LANGUAGES,
        this.DICTATION_LANGUAGES,
      );
    }
    if (process.env.DICTATION_ESTIMATED_RTF) {
      const estimatedRtf = parseFloat(process.env.DICTATION_ESTIMATED_RTF);
      if (Number.isFinite(estimatedRtf) && estimatedRtf > 0) {
        this.DICTATION_ESTIMATED_RTF = estimatedRtf;
      }
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
    if (process.env.DICTATION_HOTWORDS_MAX) {
      this.DICTATION_HOTWORDS_MAX = clampInteger(
        process.env.DICTATION_HOTWORDS_MAX,
        1,
        200,
        this.DICTATION_HOTWORDS_MAX,
      );
    }
    if (process.env.DICTATION_VOCABULARY_MAX) {
      this.DICTATION_VOCABULARY_MAX = clampInteger(
        process.env.DICTATION_VOCABULARY_MAX,
        1,
        1000,
        this.DICTATION_VOCABULARY_MAX,
      );
    }
    if (process.env.DICTATION_CONFIDENCE_THRESHOLD) {
      this.DICTATION_CONFIDENCE_THRESHOLD = clampNumber(
        process.env.DICTATION_CONFIDENCE_THRESHOLD,
        0.05,
        0.95,
        this.DICTATION_CONFIDENCE_THRESHOLD,
      );
    }
    if (process.env.DICTATION_PHRASES_MAX) {
      this.DICTATION_PHRASES_MAX = clampInteger(
        process.env.DICTATION_PHRASES_MAX,
        1,
        500,
        this.DICTATION_PHRASES_MAX,
      );
    }
    if (process.env.RATE_LIMIT_DICTATION_ASK_MAX) {
      this.RATE_LIMIT_DICTATION_ASK_MAX =
        parseInt(process.env.RATE_LIMIT_DICTATION_ASK_MAX) ||
        this.RATE_LIMIT_DICTATION_ASK_MAX;
    }
    if (process.env.DICTATION_ASK_TIMEOUT_MS) {
      this.DICTATION_ASK_TIMEOUT_MS = clampInteger(
        process.env.DICTATION_ASK_TIMEOUT_MS,
        1000,
        60000,
        this.DICTATION_ASK_TIMEOUT_MS,
      );
    }
    if (process.env.DICTATION_IMPORT_ENABLED) {
      this.DICTATION_IMPORT_ENABLED =
        process.env.DICTATION_IMPORT_ENABLED === "true";
    }
    if (process.env.DICTATION_IMPORT_MAX_MB) {
      this.DICTATION_IMPORT_MAX_MB = clampInteger(
        process.env.DICTATION_IMPORT_MAX_MB,
        1,
        2048,
        this.DICTATION_IMPORT_MAX_MB,
      );
    }
    if (process.env.DICTATION_IMPORT_MAX_DURATION_SECONDS) {
      this.DICTATION_IMPORT_MAX_DURATION_SECONDS = clampInteger(
        process.env.DICTATION_IMPORT_MAX_DURATION_SECONDS,
        60,
        43200,
        this.DICTATION_IMPORT_MAX_DURATION_SECONDS,
      );
    }
    if (process.env.DICTATION_IMPORT_SEGMENT_SECONDS) {
      this.DICTATION_IMPORT_SEGMENT_SECONDS = clampInteger(
        process.env.DICTATION_IMPORT_SEGMENT_SECONDS,
        10,
        120,
        this.DICTATION_IMPORT_SEGMENT_SECONDS,
      );
    }
    if (process.env.DICTATION_INBOX_TTL_HOURS) {
      this.DICTATION_INBOX_TTL_HOURS = clampInteger(
        process.env.DICTATION_INBOX_TTL_HOURS,
        1,
        8760,
        this.DICTATION_INBOX_TTL_HOURS,
      );
    }
    if (process.env.DICTATION_MEETING_TTL_DAYS) {
      this.DICTATION_MEETING_TTL_DAYS = clampInteger(
        process.env.DICTATION_MEETING_TTL_DAYS,
        1,
        365,
        this.DICTATION_MEETING_TTL_DAYS,
      );
    }
    if (process.env.DICTATION_AUDIO_KEEP_MAX_MB) {
      this.DICTATION_AUDIO_KEEP_MAX_MB = clampInteger(
        process.env.DICTATION_AUDIO_KEEP_MAX_MB,
        0,
        102400,
        this.DICTATION_AUDIO_KEEP_MAX_MB,
      );
    }
    if (process.env.DICTATION_AUDIO_RETENTION_DAYS) {
      this.DICTATION_AUDIO_RETENTION_DAYS = clampInteger(
        process.env.DICTATION_AUDIO_RETENTION_DAYS,
        1,
        3650,
        this.DICTATION_AUDIO_RETENTION_DAYS,
      );
    }
    if (process.env.DICTATION_NOTIFY_READY) {
      this.DICTATION_NOTIFY_READY =
        process.env.DICTATION_NOTIFY_READY === "true";
    }
    if (process.env.RATE_LIMIT_DICTATION_IMPORT_MAX) {
      this.RATE_LIMIT_DICTATION_IMPORT_MAX = clampInteger(
        process.env.RATE_LIMIT_DICTATION_IMPORT_MAX,
        1,
        1000,
        this.RATE_LIMIT_DICTATION_IMPORT_MAX,
      );
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

    // Never sign tokens with an empty or publicly known JWT secret: such
    // tokens are invalid (empty) or forgeable by anyone ("dev"). Outside of
    // development the key is mandatory; DEV_MODE falls back to a generated
    // per-process key when none is configured.
    const configuredJwtKey = (this.JWT_KEY || "").trim();
    if (this.DEV_MODE) {
      if (!configuredJwtKey) {
        this.JWT_KEY = getDevelopmentJwtKey();
      }
    } else if (!configuredJwtKey || configuredJwtKey === "dev") {
      throw new Error(
        "JWT_KEY must be set to a strong, private value (or start with DEV_MODE=true for local development)",
      );
    }
  }
}
