import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Config } from "../Config";
import {
  DbUtilsClose,
  DbUtilsInit,
  DbUtilsInitGetDatabase,
  DbUtilsIsUniqueViolation,
} from "../utils/DbUtils";
import {
  DictationVocabularyAdd,
  DictationVocabularyCountForScope,
  DictationVocabularyCountForUser,
  DictationVocabularyDelete,
  DictationVocabularyListForUser,
  DictationVocabularyReplaceScope,
  DictationVocabularyResolveForPrompt,
  NormalizeVocabularyTerm,
  VOCABULARY_TERM_MAX_LENGTH,
} from "./DictationVocabularyData";

describe("NormalizeVocabularyTerm", () => {
  it("should trim, collapse whitespace and keep the display casing", () => {
    expect(NormalizeVocabularyTerm("  Kubernetes   Cluster ")).toEqual({
      term: "Kubernetes Cluster",
      normalizedTerm: "kubernetes cluster",
    });
  });

  it("should normalize unicode and strip control characters", () => {
    expect(NormalizeVocabularyTerm("Ｃａｆé\u0000\tBar")).toEqual({
      term: "Café Bar",
      normalizedTerm: "café bar",
    });
  });

  it("should bound the stored length", () => {
    const normalized = NormalizeVocabularyTerm("x".repeat(300));
    expect(normalized?.term).toHaveLength(VOCABULARY_TERM_MAX_LENGTH);
  });

  it("should reject empty and non-string values", () => {
    expect(NormalizeVocabularyTerm("   ")).toBeNull();
    expect(NormalizeVocabularyTerm("")).toBeNull();
    expect(NormalizeVocabularyTerm(42)).toBeNull();
    expect(NormalizeVocabularyTerm(null)).toBeNull();
  });
});

describe("DictationVocabularyData (sqlite)", () => {
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dictation-vocab-"));
    const config = new Config();
    config.DATABASE_TYPE = "sqlite";
    config.DATA_DIR = dataDir;
    await DbUtilsInit(config);
    const db = DbUtilsInitGetDatabase();
    db.exec(`
      CREATE TABLE users (id VARCHAR(50) PRIMARY KEY);
      CREATE TABLE projects (id VARCHAR(50) PRIMARY KEY);
      CREATE TABLE dictation_jobs (id VARCHAR(50) PRIMARY KEY);
    `);
    db.exec(
      await fs.readFile(
        path.join(__dirname, "..", "..", "sql", "sqlite", "init-0027.sql"),
        "utf-8",
      ),
    );
  });

  beforeEach(() => {
    const db = DbUtilsInitGetDatabase();
    db.exec("DELETE FROM dictation_vocabulary; DELETE FROM users; DELETE FROM projects;");
    db.exec(
      "INSERT INTO users (id) VALUES ('user-1'), ('user-2'); INSERT INTO projects (id) VALUES ('proj-1');",
    );
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dataDir);
  });

  it("should add, list and count terms of both scopes", async () => {
    const personal = await DictationVocabularyAdd("user-1", null, "Planner");
    await DictationVocabularyAdd("user-1", "proj-1", "ArgoCD");
    await DictationVocabularyAdd("user-2", null, "Other");

    const terms = await DictationVocabularyListForUser("user-1");
    expect(terms.map((term) => term.term)).toEqual(["ArgoCD", "Planner"]);
    expect(terms[0]).toMatchObject({ projectId: "proj-1" });
    expect(terms[1]).toMatchObject({ id: personal.id, projectId: null });

    expect(await DictationVocabularyCountForUser("user-1")).toBe(2);
    expect(await DictationVocabularyCountForScope("user-1", null)).toBe(1);
    expect(await DictationVocabularyCountForScope("user-1", "proj-1")).toBe(1);
  });

  it("should reject a duplicate term in the same scope only", async () => {
    await DictationVocabularyAdd("user-1", null, "Planner");
    let duplicate: unknown = null;
    try {
      await DictationVocabularyAdd("user-1", null, "PLANNER");
    } catch (error) {
      duplicate = error;
    }
    expect(DbUtilsIsUniqueViolation(duplicate)).toBe(true);

    // The same term in another scope is allowed
    await expect(
      DictationVocabularyAdd("user-1", "proj-1", "Planner"),
    ).resolves.toMatchObject({ term: "Planner", projectId: "proj-1" });
  });

  it("should only delete terms of the requesting user", async () => {
    const term = await DictationVocabularyAdd("user-1", null, "Planner");
    expect(await DictationVocabularyDelete("user-2", term.id)).toBe(0);
    expect(await DictationVocabularyListForUser("user-1")).toHaveLength(1);
    expect(await DictationVocabularyDelete("user-1", term.id)).toBe(1);
    expect(await DictationVocabularyListForUser("user-1")).toHaveLength(0);
  });

  it("should replace a scope with deduped terms in input order", async () => {
    await DictationVocabularyAdd("user-1", null, "Old");
    await DictationVocabularyAdd("user-1", "proj-1", "Untouched");

    const saved = await DictationVocabularyReplaceScope("user-1", null, [
      " Planner ",
      "planner",
      "",
      42,
      "Kubernetes",
      "Argo CD",
    ]);
    expect(saved.map((term) => term.term)).toEqual([
      "Planner",
      "Kubernetes",
      "Argo CD",
    ]);
    expect(saved.every((term) => term.projectId === null)).toBe(true);
    // The other scope is preserved
    expect(await DictationVocabularyListForUser("user-1")).toHaveLength(4);
  });

  it("should resolve project terms first, then personal terms, capped", async () => {
    await DictationVocabularyAdd("user-1", null, "Planner");
    await DictationVocabularyAdd("user-1", null, "Kubernetes");
    await DictationVocabularyAdd("user-1", "proj-1", "ArgoCD");
    await DictationVocabularyAdd("user-1", "proj-1", "planner");

    expect(
      await DictationVocabularyResolveForPrompt("user-1", "proj-1", 10),
    ).toEqual(["ArgoCD", "planner", "Kubernetes"]);
    expect(await DictationVocabularyResolveForPrompt("user-1", null, 10)).toEqual(
      ["Planner", "Kubernetes"],
    );
    expect(
      await DictationVocabularyResolveForPrompt("user-1", "proj-1", 1),
    ).toEqual(["ArgoCD"]);
    expect(
      await DictationVocabularyResolveForPrompt("user-1", "proj-1", 0),
    ).toEqual([]);
  });

  it("should never resolve vocabulary of another user", async () => {
    await DictationVocabularyAdd("user-1", "proj-1", "ArgoCD");
    expect(
      await DictationVocabularyResolveForPrompt("user-2", "proj-1", 10),
    ).toEqual([]);
  });
});
