import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import { Config, ParseLanguageList } from "./Config";

describe("Config", () => {
  describe("constructor defaults", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Clear relevant env vars to test defaults
      delete process.env.DATA_DIR;
      delete process.env.TMP_DIR;
      delete process.env.DEV_MODE;
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it("should set default values", () => {
      const config = new Config();
      expect(config.DATA_DIR).toBe("/data");
      expect(config.TMP_DIR).toBe("/tmp");
      expect(config.DEV_MODE).toBe(false);
      expect(config.APPLICATION_TITLE).toBe("Planner");
      expect(config.API_PORT).toBe(8080);
      expect(config.CORS_POLICY_ORIGIN).toBe("");
      expect(config.JWT_KEY).toBe("");
      expect(config.DATABASE_TYPE).toBe("sqlite");
      expect(config.JWT_VALIDITY_DURATION).toBe(2592000);
      expect(config.ATTACHMENT_MAX_SIZE).toBe(10);
      expect(config.LLM_API_KEY).toBe("");
      expect(config.LLM_API_URL).toBe(
        "https://api.deepseek.com/chat/completions",
      );
      expect(config.LLM_MODEL).toBe("deepseek-chat");
      expect(config.LLM_RECOMMENDATION_ENABLED).toBe(false);
      expect(config.LLM_RECOMMENDATION_SCHEDULE_CRON).toBe("0 0 * * *");
      expect(config.RATE_LIMIT_LLM_IMPROVE_MAX).toBe(30);
      expect(config.RATE_LIMIT_LLM_REGENERATE_MAX).toBe(5);
      expect(config.DICTATION_ENABLED).toBe(false);
      expect(config.STT_MODE).toBe("external");
      expect(config.STT_API_URL).toBe("");
      expect(config.STT_API_KEY).toBe("");
      expect(config.STT_MODEL).toBe("whisper-large-v3-turbo");
      expect(config.STT_EMBEDDED_MODEL).toBe("ggml-base");
      expect(config.STT_EMBEDDED_BIN_PATH).toBe("");
      expect(config.STT_EMBEDDED_THREADS).toBe(0);
      expect(config.STT_EMBEDDED_TRIM_SILENCE).toBe(true);
      expect(config.DICTATION_LANGUAGE).toBe("auto");
      expect(config.DICTATION_LANGUAGES).toEqual([
        "en",
        "fr",
        "de",
        "es",
        "it",
        "pt",
        "nl",
      ]);
      expect(config.DICTATION_ESTIMATED_RTF).toBe(0);
      expect(config.DICTATION_MAX_DURATION_SECONDS).toBe(120);
      expect(config.DICTATION_MAX_UPLOAD_MB).toBe(10);
      expect(config.RATE_LIMIT_DICTATION_MAX).toBe(30);
      expect(config.DICTATION_HOTWORDS_MAX).toBe(50);
      expect(config.DICTATION_VOCABULARY_MAX).toBe(200);
      expect(config.DICTATION_CONFIDENCE_THRESHOLD).toBe(0.6);
    });

    it("should respect environment variables in constructor", () => {
      process.env.DATA_DIR = "/custom/data";
      process.env.TMP_DIR = "/custom/tmp";
      process.env.DEV_MODE = "true";

      const config = new Config();
      expect(config.DATA_DIR).toBe("/custom/data");
      expect(config.TMP_DIR).toBe("/custom/tmp");
      expect(config.DEV_MODE).toBe(true);
    });
  });

  describe("reload", () => {
    let dir: string;
    const originalEnv = process.env;
    const originalConfigFile = process.env.CONFIG_FILE;

    beforeEach(async () => {
      process.env = { ...originalEnv };
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "planner-config-"));
      process.env.CONFIG_FILE = path.join(dir, "config.json");
    });

    afterEach(async () => {
      process.env = originalEnv;
      if (originalConfigFile === undefined) {
        delete process.env.CONFIG_FILE;
      } else {
        process.env.CONFIG_FILE = originalConfigFile;
      }
      await fs.remove(dir);
    });

    async function writeConfig(content: Record<string, unknown>) {
      await fs.writeJson(process.env.CONFIG_FILE, content);
      const config = new Config();
      await config.reload();
      return config;
    }

    it("should refuse to start without a JWT_KEY outside DEV_MODE", async () => {
      delete process.env.DEV_MODE;
      await fs.writeJson(process.env.CONFIG_FILE, { API_PORT: 8080 });
      const config = new Config();
      await expect(config.reload()).rejects.toThrow(/JWT_KEY/);
    });

    it("should refuse the placeholder JWT_KEY 'dev' outside DEV_MODE", async () => {
      delete process.env.DEV_MODE;
      await fs.writeJson(process.env.CONFIG_FILE, { JWT_KEY: "dev" });
      const config = new Config();
      await expect(config.reload()).rejects.toThrow(/JWT_KEY/);
    });

    it("should refuse a whitespace-only JWT_KEY outside DEV_MODE", async () => {
      delete process.env.DEV_MODE;
      await fs.writeJson(process.env.CONFIG_FILE, { JWT_KEY: "   " });
      const config = new Config();
      await expect(config.reload()).rejects.toThrow(/JWT_KEY/);
    });

    it("should accept a real JWT_KEY outside DEV_MODE", async () => {
      delete process.env.DEV_MODE;
      const config = await writeConfig({ JWT_KEY: "a-strong-secret" });
      expect(config.JWT_KEY).toBe("a-strong-secret");
    });

    it("should generate a usable JWT_KEY in DEV_MODE when none is configured", async () => {
      process.env.DEV_MODE = "true";
      const config = new Config();
      await fs.writeJson(process.env.CONFIG_FILE, {});
      await expect(config.reload()).resolves.toBeUndefined();
      expect(config.JWT_KEY).not.toBe("");
      expect(config.JWT_KEY).not.toBe("dev");
      expect(config.JWT_KEY.length).toBeGreaterThanOrEqual(64);
    });

    it("should keep the generated DEV_MODE key stable across reloads", async () => {
      process.env.DEV_MODE = "true";
      const config = await writeConfig({});
      const generated = config.JWT_KEY;
      await config.reload();
      expect(config.JWT_KEY).toBe(generated);

      const other = new Config();
      await other.reload();
      expect(other.JWT_KEY).toBe(generated);
    });

    it("should keep an explicit JWT_KEY in DEV_MODE", async () => {
      process.env.DEV_MODE = "true";
      const config = await writeConfig({ JWT_KEY: "my-dev-key" });
      expect(config.JWT_KEY).toBe("my-dev-key");
    });

    it("should read the rate limits and attachment size from the config file", async () => {
      process.env.DEV_MODE = "true";
      const config = await writeConfig({
        JWT_KEY: "k",
        RATE_LIMIT_LLM_IMPROVE_MAX: 7,
        RATE_LIMIT_LLM_REGENERATE_MAX: 2,
        ATTACHMENT_MAX_SIZE: 25,
        DICTATION_ENABLED: true,
        STT_MODE: "embedded",
        STT_API_URL: "https://stt.local",
        STT_API_KEY: "stt-secret",
        STT_MODEL: "whisper-small",
        STT_EMBEDDED_MODEL: "ggml-small",
        STT_EMBEDDED_BIN_PATH: "/opt/whisper/whisper-cli",
        STT_EMBEDDED_THREADS: 2,
        STT_EMBEDDED_TRIM_SILENCE: false,
        DICTATION_LANGUAGE: "fr",
        DICTATION_LANGUAGES: ["fr", "en"],
        DICTATION_ESTIMATED_RTF: 0.4,
        DICTATION_MAX_DURATION_SECONDS: 60,
        DICTATION_MAX_UPLOAD_MB: 5,
        RATE_LIMIT_DICTATION_MAX: 12,
        DICTATION_HOTWORDS_MAX: 20,
        DICTATION_VOCABULARY_MAX: 100,
        DICTATION_CONFIDENCE_THRESHOLD: 0.75,
      });
      expect(config.RATE_LIMIT_LLM_IMPROVE_MAX).toBe(7);
      expect(config.RATE_LIMIT_LLM_REGENERATE_MAX).toBe(2);
      expect(config.ATTACHMENT_MAX_SIZE).toBe(25);
      expect(config.DICTATION_ENABLED).toBe(true);
      expect(config.STT_MODE).toBe("embedded");
      expect(config.STT_API_URL).toBe("https://stt.local");
      expect(config.STT_API_KEY).toBe("stt-secret");
      expect(config.STT_MODEL).toBe("whisper-small");
      expect(config.STT_EMBEDDED_MODEL).toBe("ggml-small");
      expect(config.STT_EMBEDDED_BIN_PATH).toBe("/opt/whisper/whisper-cli");
      expect(config.STT_EMBEDDED_THREADS).toBe(2);
      expect(config.STT_EMBEDDED_TRIM_SILENCE).toBe(false);
      expect(config.DICTATION_LANGUAGE).toBe("fr");
      expect(config.DICTATION_LANGUAGES).toEqual(["fr", "en"]);
      expect(config.DICTATION_ESTIMATED_RTF).toBe(0.4);
      expect(config.DICTATION_MAX_DURATION_SECONDS).toBe(60);
      expect(config.DICTATION_MAX_UPLOAD_MB).toBe(5);
      expect(config.RATE_LIMIT_DICTATION_MAX).toBe(12);
      expect(config.DICTATION_HOTWORDS_MAX).toBe(20);
      expect(config.DICTATION_VOCABULARY_MAX).toBe(100);
      expect(config.DICTATION_CONFIDENCE_THRESHOLD).toBe(0.75);
    });

    it("should let env variables override the rate limits", async () => {
      process.env.DEV_MODE = "true";
      process.env.RATE_LIMIT_LLM_IMPROVE_MAX = "11";
      process.env.RATE_LIMIT_LLM_REGENERATE_MAX = "3";
      process.env.DICTATION_ENABLED = "true";
      process.env.STT_MODE = "embedded";
      process.env.STT_API_URL = "https://stt-env.local";
      process.env.STT_API_KEY = "stt-env-secret";
      process.env.STT_MODEL = "whisper-env";
      process.env.STT_EMBEDDED_MODEL = "ggml-tiny-env";
      process.env.STT_EMBEDDED_BIN_PATH = "/usr/local/bin/whisper-cli-env";
      process.env.STT_EMBEDDED_THREADS = "3";
      process.env.STT_EMBEDDED_TRIM_SILENCE = "false";
      process.env.DICTATION_LANGUAGE = "de";
      process.env.DICTATION_LANGUAGES = "de, en ,fr";
      process.env.DICTATION_ESTIMATED_RTF = "0.6";
      process.env.DICTATION_MAX_DURATION_SECONDS = "90";
      process.env.DICTATION_MAX_UPLOAD_MB = "7";
      process.env.RATE_LIMIT_DICTATION_MAX = "21";
      process.env.DICTATION_HOTWORDS_MAX = "12";
      process.env.DICTATION_VOCABULARY_MAX = "80";
      process.env.DICTATION_CONFIDENCE_THRESHOLD = "0.8";
      const config = await writeConfig({
        JWT_KEY: "k",
        RATE_LIMIT_LLM_IMPROVE_MAX: 7,
        RATE_LIMIT_LLM_REGENERATE_MAX: 2,
        RATE_LIMIT_DICTATION_MAX: 12,
      });
      expect(config.RATE_LIMIT_LLM_IMPROVE_MAX).toBe(11);
      expect(config.RATE_LIMIT_LLM_REGENERATE_MAX).toBe(3);
      expect(config.DICTATION_ENABLED).toBe(true);
      expect(config.STT_MODE).toBe("embedded");
      expect(config.STT_API_URL).toBe("https://stt-env.local");
      expect(config.STT_API_KEY).toBe("stt-env-secret");
      expect(config.STT_MODEL).toBe("whisper-env");
      expect(config.STT_EMBEDDED_MODEL).toBe("ggml-tiny-env");
      expect(config.STT_EMBEDDED_BIN_PATH).toBe("/usr/local/bin/whisper-cli-env");
      expect(config.STT_EMBEDDED_THREADS).toBe(3);
      expect(config.STT_EMBEDDED_TRIM_SILENCE).toBe(false);
      expect(config.DICTATION_LANGUAGE).toBe("de");
      expect(config.DICTATION_LANGUAGES).toEqual(["de", "en", "fr"]);
      expect(config.DICTATION_ESTIMATED_RTF).toBe(0.6);
      expect(config.DICTATION_MAX_DURATION_SECONDS).toBe(90);
      expect(config.DICTATION_MAX_UPLOAD_MB).toBe(7);
      expect(config.RATE_LIMIT_DICTATION_MAX).toBe(21);
      expect(config.DICTATION_HOTWORDS_MAX).toBe(12);
      expect(config.DICTATION_VOCABULARY_MAX).toBe(80);
      expect(config.DICTATION_CONFIDENCE_THRESHOLD).toBe(0.8);
    });

    it("should clamp the dictation tuning values", async () => {
      process.env.DEV_MODE = "true";
      const low = await writeConfig({
        JWT_KEY: "k",
        DICTATION_HOTWORDS_MAX: 0,
        DICTATION_VOCABULARY_MAX: -5,
        DICTATION_CONFIDENCE_THRESHOLD: 2,
      });
      expect(low.DICTATION_HOTWORDS_MAX).toBe(1);
      expect(low.DICTATION_VOCABULARY_MAX).toBe(1);
      expect(low.DICTATION_CONFIDENCE_THRESHOLD).toBe(0.95);

      const high = await writeConfig({
        JWT_KEY: "k",
        DICTATION_HOTWORDS_MAX: 5000,
        DICTATION_VOCABULARY_MAX: 5000,
        DICTATION_CONFIDENCE_THRESHOLD: 0,
      });
      expect(high.DICTATION_HOTWORDS_MAX).toBe(200);
      expect(high.DICTATION_VOCABULARY_MAX).toBe(1000);
      expect(high.DICTATION_CONFIDENCE_THRESHOLD).toBe(0.05);
    });

    it("should default CORS to no origin (same-origin only)", async () => {
      process.env.DEV_MODE = "true";
      const config = await writeConfig({ JWT_KEY: "k" });
      expect(config.CORS_POLICY_ORIGIN).toBe("");
    });

    it("should prefer a JWT_KEY from the environment over the file", async () => {
      process.env.DEV_MODE = "true";
      process.env.JWT_KEY = "env-secret";
      const config = await writeConfig({ JWT_KEY: "file-secret" });
      expect(config.JWT_KEY).toBe("env-secret");
    });
  });

  describe("IsDictationSttConfigured", () => {    it("should require the url, key and model in external mode", () => {
      const config = new Config();
      config.STT_MODE = "external";
      config.STT_API_URL = "";
      config.STT_API_KEY = "";
      config.STT_MODEL = "";

      expect(config.IsDictationSttConfigured()).toBe(false);

      config.STT_API_URL = "https://stt.test";
      expect(config.IsDictationSttConfigured()).toBe(false);
      config.STT_API_KEY = "stt-key";
      expect(config.IsDictationSttConfigured()).toBe(false);
      config.STT_MODEL = "whisper-test";
      expect(config.IsDictationSttConfigured()).toBe(true);
    });

    it("should require the embedded model in embedded mode", () => {
      const config = new Config();
      config.STT_MODE = "embedded";
      config.STT_EMBEDDED_MODEL = "";

      expect(config.IsDictationSttConfigured()).toBe(false);

      config.STT_EMBEDDED_MODEL = "ggml-base";
      expect(config.IsDictationSttConfigured()).toBe(true);
    });

    it("should be configured in external mode once the url and key are set (default model)", () => {
      const config = new Config();
      config.STT_API_URL = "https://stt.test";
      config.STT_API_KEY = "stt-key";
      expect(config.IsDictationSttConfigured()).toBe(true);
    });
  });

  describe("ParseLanguageList", () => {
    const fallback = ["en", "fr"];

    it("should normalize, deduplicate and drop invalid entries", () => {
      expect(
        ParseLanguageList([" FR ", "en", "", "auto", "not a code", "fr"], fallback),
      ).toEqual(["fr", "en"]);
      expect(ParseLanguageList("de, ES ,de", fallback)).toEqual(["de", "es"]);
    });

    it("should accept regional language codes", () => {
      expect(ParseLanguageList("pt-BR,zh-Hans", fallback)).toEqual([
        "pt-br",
        "zh-hans",
      ]);
    });

    it("should fall back to the default list when nothing valid remains", () => {
      expect(ParseLanguageList([], fallback)).toEqual(fallback);
      expect(ParseLanguageList("auto", fallback)).toEqual(fallback);
      expect(ParseLanguageList(undefined, fallback)).toEqual(fallback);
      expect(ParseLanguageList(42, fallback)).toEqual(fallback);
    });
  });
});
