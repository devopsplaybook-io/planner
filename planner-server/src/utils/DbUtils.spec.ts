import {
  convertToPostgresPlaceholders,
  DbUtilsGetType,
  DbUtilsIsUniqueViolation,
} from "../utils/DbUtils";

describe("DbUtils", () => {
  describe("convertToPostgresPlaceholders", () => {
    it("should convert a single ? to $1", () => {
      expect(
        convertToPostgresPlaceholders("SELECT * FROM t WHERE id = ?"),
      ).toBe("SELECT * FROM t WHERE id = $1");
    });

    it("should convert multiple ? to sequential $1, $2, ...", () => {
      expect(
        convertToPostgresPlaceholders(
          "INSERT INTO t (a, b, c) VALUES (?, ?, ?)",
        ),
      ).toBe("INSERT INTO t (a, b, c) VALUES ($1, $2, $3)");
    });

    it("should leave SQL with no placeholders unchanged", () => {
      const sql = "SELECT * FROM t";
      expect(convertToPostgresPlaceholders(sql)).toBe(sql);
    });

    it("should handle a query with 5 placeholders", () => {
      const result = convertToPostgresPlaceholders("VALUES (?, ?, ?, ?, ?)");
      expect(result).toBe("VALUES ($1, $2, $3, $4, $5)");
    });
  });

  describe("DbUtilsGetType", () => {
    it("should default to 'sqlite'", () => {
      expect(DbUtilsGetType()).toBe("sqlite");
    });
  });

  describe("DbUtilsIsUniqueViolation", () => {
    it("should detect PostgreSQL unique violations", () => {
      expect(DbUtilsIsUniqueViolation({ code: "23505" })).toBe(true);
    });

    it("should detect SQLite unique constraint errors", () => {
      expect(
        DbUtilsIsUniqueViolation({ code: "SQLITE_CONSTRAINT_UNIQUE" }),
      ).toBe(true);
      expect(
        DbUtilsIsUniqueViolation({
          code: "SQLITE_CONSTRAINT",
          message: "UNIQUE constraint failed: users.name",
        }),
      ).toBe(true);
    });

    it("should ignore unrelated errors", () => {
      expect(DbUtilsIsUniqueViolation({ code: "SQLITE_BUSY" })).toBe(false);
      expect(DbUtilsIsUniqueViolation(new Error("boom"))).toBe(false);
      expect(DbUtilsIsUniqueViolation(null)).toBe(false);
      expect(DbUtilsIsUniqueViolation(undefined)).toBe(false);
      expect(DbUtilsIsUniqueViolation({})).toBe(false);
      expect(DbUtilsIsUniqueViolation("23505")).toBe(false);
    });
  });
});
