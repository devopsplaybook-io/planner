import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  convertToPostgresPlaceholders,
  DbUtilsClose,
  DbUtilsGetType,
  DbUtilsInit,
  DbUtilsInitGetDatabase,
  DbUtilsIsUniqueViolation,
} from "../utils/DbUtils";
import { Config } from "../Config";

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

/**
 * The runtime user (UID 1000 in the container) must own the data volume: a
 * volume left behind by an image that ran as root stays readable and, without
 * these checks, would make every write fail with SQLITE_READONLY while the
 * server reported itself healthy.
 */
describe("DbUtilsInit (data directory access)", () => {
  const createdDirs: string[] = [];
  // Root ignores file permissions, so the read-only cases cannot be simulated
  const isRoot =
    typeof process.getuid === "function" && process.getuid() === 0;

  async function createDataDir(prefix: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `planner-${prefix}-`));
    createdDirs.push(dir);
    return dir;
  }

  async function createDatabaseFile(dir: string): Promise<string> {
    const file = path.join(dir, "database.db");
    const Database = (await import("better-sqlite3")).default;
    const database = new Database(file);
    database.pragma("journal_mode = WAL");
    database.exec("CREATE TABLE t (a INTEGER)");
    database.close();
    return file;
  }

  function configFor(dir: string): Config {
    const config = new Config();
    config.DATA_DIR = dir;
    return config;
  }

  afterEach(async () => {
    await DbUtilsClose();
    for (const dir of createdDirs.splice(0)) {
      await fs.chmod(dir, 0o755);
      await fs.remove(dir);
    }
  });

  it("should initialize the database on a writable data directory", async () => {
    const dir = await createDataDir("writable");
    await DbUtilsInit(configFor(dir));
    expect(await fs.pathExists(path.join(dir, "database.db"))).toBe(true);
  });

  it("should keep the database content when the writability probe runs", async () => {
    const dir = await createDataDir("probe");
    const file = await createDatabaseFile(dir);
    const Database = (await import("better-sqlite3")).default;
    const database = new Database(file);
    database.pragma("user_version = 3");
    database.exec("INSERT INTO t (a) VALUES (42)");
    database.close();

    await DbUtilsInit(configFor(dir));

    expect(
      DbUtilsInitGetDatabase().pragma("user_version", { simple: true }),
    ).toBe(3);
    expect(
      DbUtilsInitGetDatabase().prepare("SELECT a FROM t").all(),
    ).toEqual([{ a: 42 }]);
  });

  it("should fail with the ownership remediation when the database file is read-only", async () => {
    if (isRoot) {
      return;
    }
    const dir = await createDataDir("readonly-db");
    const file = await createDatabaseFile(dir);
    // The database survived a container that ran as root: the directory is
    // still writable, the file and its WAL are not
    await fs.chmod(file, 0o444);

    const error = await DbUtilsInit(configFor(dir)).catch(
      (initError: Error) => initError,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("not usable by this process");
    expect((error as Error).message).toContain(
      "attempt to write a readonly database",
    );
    expect((error as Error).message).toContain("chown -R");
    expect((error as Error).message).toContain(dir);
  });

  it("should fail with the ownership remediation when the data directory is read-only", async () => {
    if (isRoot) {
      return;
    }
    const dir = await createDataDir("readonly-dir");
    await fs.chmod(dir, 0o555);

    await expect(DbUtilsInit(configFor(dir))).rejects.toThrow(
      /not usable by this process/,
    );
  });

  it("should fail with the ownership remediation when the data directory does not exist", async () => {
    const dir = path.join(await createDataDir("missing"), "sub", "data");

    const error = await DbUtilsInit(configFor(dir)).catch(
      (initError: Error) => initError,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("mkdir -p");
    expect((error as Error).message).toContain(dir);
  });
});
