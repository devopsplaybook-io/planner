import {
  convertToPostgresPlaceholders,
  DbUtilsGetType,
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
});
