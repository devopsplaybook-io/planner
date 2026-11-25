import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { registerLoginCodesStoreConformance } from "@devopsplaybook.io/common-utils/users/login-codes/testing";
import { Config } from "../Config";
import { DbUtilsClose, DbUtilsExecSQL, DbUtilsInit } from "../utils/DbUtils";
import { RunMigrations } from "../DbMigrations";
import {
  LOGIN_CODES_TABLE,
  LoginCodesDataCreateStore,
} from "./LoginCodesData";

/**
 * Integration tests of the login-code store against a real temporary SQLite
 * database. The library conformance suite pins the security-critical
 * invariants (single use, one-approval-wins, atomic caps, rotation CAS,
 * cleanup bounds); the extra cases cover the Planner-specific wiring.
 */

const dir = path.join(os.tmpdir(), `planner-login-codes-${Date.now()}`);
const BASE_MS = 1700000000000;

function iso(offsetMs: number): string {
  return new Date(BASE_MS + offsetMs).toISOString();
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function createRow(
  overrides: Partial<{
    id: string;
    requestTokenHash: string;
    codeHash: string;
    createdAt: string;
    maxPending: number;
  }> = {},
) {
  const id = overrides.id ?? nextId("req");
  const store = LoginCodesDataCreateStore();
  const result = await store.create({
    id,
    requestTokenHash: overrides.requestTokenHash ?? `token-${id}`,
    codeHash: overrides.codeHash ?? `code-${id}`,
    codeExpiresAt: iso(30000),
    createdAt: overrides.createdAt ?? iso(0),
    updatedAt: iso(0),
    expiresAt: iso(300000),
    requestUserAgent: "spec-agent",
    maxPending: overrides.maxPending ?? 100,
  });
  return { id, result };
}

describe("LoginCodesData (SQLite integration)", () => {
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

  beforeEach(async () => {
    await DbUtilsExecSQL(`DELETE FROM "${LOGIN_CODES_TABLE}"`);
  });

  registerLoginCodesStoreConformance(
    { describe, it },
    { createStore: () => LoginCodesDataCreateStore() },
  );

  it("should report the store available once the migration ran", async () => {
    const store = LoginCodesDataCreateStore();
    expect(await store.available()).toBe(true);
  });

  it("should reject a rotation whose expected code hash is stale", async () => {
    const { id } = await createRow({ codeHash: "code-current" });
    const store = LoginCodesDataCreateStore();

    const stale = await store.rotate({
      id,
      expectedCodeHash: "code-not-current",
      newCodeHash: "code-next",
      codeExpiresAt: iso(60000),
      previousCodeExpiresAt: iso(90000),
      updatedAt: iso(30000),
    });
    expect(stale).toBe(false);

    const ok = await store.rotate({
      id,
      expectedCodeHash: "code-current",
      newCodeHash: "code-next",
      codeExpiresAt: iso(60000),
      previousCodeExpiresAt: iso(90000),
      updatedAt: iso(30000),
    });
    expect(ok).toBe(true);
  });

  it("should approve the previous code only inside its grace window", async () => {
    const { id, result } = await createRow({ codeHash: "code-old" });
    expect(result.ok).toBe(true);
    const store = LoginCodesDataCreateStore();
    await store.rotate({
      id,
      expectedCodeHash: "code-old",
      newCodeHash: "code-new",
      codeExpiresAt: iso(60000),
      previousCodeExpiresAt: iso(50000),
      updatedAt: iso(10000),
    });

    const inGrace = await store.approve({
      id,
      submittedCodeHash: "code-old",
      now: iso(40000),
      approvedByUserId: "user-1",
      approvedAt: iso(40000),
    });
    expect(inGrace).toBe(true);
  });

  it("should reject the previous code after its grace window", async () => {
    const { id } = await createRow({ codeHash: "code-old" });
    const store = LoginCodesDataCreateStore();
    await store.rotate({
      id,
      expectedCodeHash: "code-old",
      newCodeHash: "code-new",
      codeExpiresAt: iso(60000),
      previousCodeExpiresAt: iso(50000),
      updatedAt: iso(10000),
    });

    const afterGrace = await store.approve({
      id,
      submittedCodeHash: "code-old",
      now: iso(60000),
      approvedByUserId: "user-1",
      approvedAt: iso(60000),
    });
    expect(afterGrace).toBe(false);
  });

  it("should delete only rows older than the cutoff and honour the limit", async () => {
    for (let i = 0; i < 3; i += 1) {
      await createRow({ createdAt: iso(0) });
    }
    await createRow({ createdAt: iso(10000) });
    const store = LoginCodesDataCreateStore();

    const first = await store.cleanup({ olderThan: iso(5000), limit: 2 });
    expect(first).toBe(2);

    const second = await store.cleanup({ olderThan: iso(5000), limit: 10 });
    expect(second).toBe(1);

    const remaining = await store.cleanup({ olderThan: iso(5000), limit: 10 });
    expect(remaining).toBe(0);
  });
});

describe("LoginCodesData availability without the migration", () => {
  it("should report the store unavailable when the table is missing", async () => {
    const emptyDir = path.join(os.tmpdir(), `planner-login-codes-empty-${Date.now()}`);
    await fs.remove(emptyDir);
    await fs.ensureDir(emptyDir);
    const config = new Config();
    config.DATA_DIR = emptyDir;
    await DbUtilsInit(config);
    try {
      const store = LoginCodesDataCreateStore();
      expect(await store.available()).toBe(false);
      // The definitive miss is cached per store instance.
      expect(await store.available()).toBe(false);
    } finally {
      await DbUtilsClose();
      await fs.remove(emptyDir);
    }
  });
});
