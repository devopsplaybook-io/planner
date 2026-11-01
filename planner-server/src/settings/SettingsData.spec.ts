import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Config } from "../Config";
import {
  DbUtilsClose,
  DbUtilsExecSQL,
  DbUtilsInit,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";
import { RunMigrations } from "../DbMigrations";
import {
  buildGetSettingsQuery,
  buildUpsertSettingsQuery,
  SettingsDataGet,
  SettingsDataSave,
} from "./SettingsData";

describe("buildGetSettingsQuery", () => {
  it("should build a sqlite query with bare identifiers", () => {
    expect(buildGetSettingsQuery("sqlite").sql).toBe(
      "SELECT content FROM settings WHERE category = ? LIMIT 1",
    );
  });

  it("should quote identifiers for postgres", () => {
    expect(buildGetSettingsQuery("postgres").sql).toBe(
      'SELECT "content" FROM settings WHERE "category" = ? LIMIT 1',
    );
  });
});

describe("buildUpsertSettingsQuery", () => {
  it("should build a sqlite upsert with ? placeholders", () => {
    expect(buildUpsertSettingsQuery("sqlite").sql).toBe(
      "INSERT INTO settings (category, content) VALUES (?, ?) " +
        "ON CONFLICT (category) DO UPDATE SET content = excluded.content",
    );
  });

  it("should quote identifiers for postgres", () => {
    expect(buildUpsertSettingsQuery("postgres").sql).toBe(
      'INSERT INTO settings ("category", "content") VALUES (?, ?) ' +
        'ON CONFLICT ("category") DO UPDATE SET "content" = excluded."content"',
    );
  });
});

describe("SettingsData (integration)", () => {
  const dir = path.join(os.tmpdir(), `planner-settings-${Date.now()}`);

  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should return null for a category without content", async () => {
    expect(await SettingsDataGet("missing")).toBeNull();
  });

  it("should keep one row per category with the latest content", async () => {
    await SettingsDataSave("cleanup", '{"first":true}');
    await SettingsDataSave("cleanup", '{"second":true}');

    expect(await SettingsDataGet("cleanup")).toBe('{"second":true}');
    const rows = await DbUtilsQuerySQL(
      "SELECT category FROM settings WHERE category = 'cleanup'",
    );
    expect(rows).toHaveLength(1);
  });

  it("should reject a duplicate raw insert", async () => {
    await SettingsDataSave("duplicate", '{"a":1}');

    await expect(
      DbUtilsExecSQL("INSERT INTO settings (category, content) VALUES (?, ?)", [
        "duplicate",
        '{"b":2}',
      ]),
    ).rejects.toThrow();

    expect(await SettingsDataGet("duplicate")).toBe('{"a":1}');
  });
});
