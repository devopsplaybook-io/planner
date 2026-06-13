import { Config } from "./Config";

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
      expect(config.LLM_API_KEY).toBe("");
      expect(config.LLM_API_URL).toBe(
        "https://api.deepseek.com/chat/completions",
      );
      expect(config.LLM_MODEL).toBe("deepseek-chat");
      expect(config.LLM_RECOMMENDATION_ENABLED).toBe(false);
      expect(config.LLM_RECOMMENDATION_SCHEDULE_CRON).toBe("0 0 * * *");
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
});
