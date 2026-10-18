import {
  buildGetSettingsQuery,
  buildInsertSettingsQuery,
  buildUpdateSettingsQuery,
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

describe("buildUpdateSettingsQuery", () => {
  it("should build a sqlite update with ? placeholders", () => {
    expect(buildUpdateSettingsQuery("sqlite").sql).toBe(
      "UPDATE settings SET content = ? WHERE category = ?",
    );
  });

  it("should quote identifiers for postgres", () => {
    expect(buildUpdateSettingsQuery("postgres").sql).toBe(
      'UPDATE settings SET "content" = ? WHERE "category" = ?',
    );
  });
});

describe("buildInsertSettingsQuery", () => {
  it("should build a sqlite insert with ? placeholders", () => {
    expect(buildInsertSettingsQuery("sqlite").sql).toBe(
      "INSERT INTO settings (category, content) VALUES (?, ?)",
    );
  });

  it("should quote identifiers for postgres", () => {
    expect(buildInsertSettingsQuery("postgres").sql).toBe(
      'INSERT INTO settings ("category", "content") VALUES (?, ?)',
    );
  });
});
