import { SplitSqlStatements } from "./DbMigrations";

describe("SplitSqlStatements", () => {
  it("should keep a DO block with internal semicolons as one statement", () => {
    const statements = SplitSqlStatements(
      "DO $$\nBEGIN\n  IF true THEN\n    ALTER TABLE users ADD PRIMARY KEY (id);\n  END IF;\nEND\n$$;\nSELECT 1;",
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("ADD PRIMARY KEY (id);");
    expect(statements[1]).toBe("SELECT 1");
  });

  it("should keep semicolons inside single-quoted strings", () => {
    const statements = SplitSqlStatements(
      "INSERT INTO t (v) VALUES ('a;b'); INSERT INTO t (v) VALUES ('it''s; ok');",
    );
    expect(statements).toEqual([
      "INSERT INTO t (v) VALUES ('a;b')",
      "INSERT INTO t (v) VALUES ('it''s; ok')",
    ]);
  });

  it("should keep semicolons inside double-quoted identifiers", () => {
    const statements = SplitSqlStatements(
      'ALTER TABLE "we;ird" ADD COLUMN "a;b" TEXT;',
    );
    expect(statements).toEqual([
      'ALTER TABLE "we;ird" ADD COLUMN "a;b" TEXT',
    ]);
  });

  it("should ignore line comments and semicolons inside them", () => {
    const statements = SplitSqlStatements(
      "-- a comment; with a semicolon\nSELECT 1;\n-- trailing comment;\nSELECT 2 -- inline; comment\n;",
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("SELECT 1");
    expect(statements[1].replace(/\s+/g, " ").trim()).toBe("SELECT 2");
  });

  it("should split multiple statements and keep a trailing one without semicolon", () => {
    const statements = SplitSqlStatements(
      "CREATE TABLE a (id INTEGER);\n\nCREATE TABLE b (id INTEGER);\n\nSELECT 1",
    );
    expect(statements).toEqual([
      "CREATE TABLE a (id INTEGER)",
      "CREATE TABLE b (id INTEGER)",
      "SELECT 1",
    ]);
  });

  it("should handle named dollar-quoted bodies", () => {
    const statements = SplitSqlStatements(
      "DO $body$ BEGIN PERFORM 1; END $body$;\nSELECT 2;",
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("PERFORM 1;");
    expect(statements[1]).toBe("SELECT 2");
  });

  it("should return no statements for comment-only or empty input", () => {
    expect(SplitSqlStatements("")).toEqual([]);
    expect(SplitSqlStatements("-- only a comment;\n")).toEqual([]);
  });
});
