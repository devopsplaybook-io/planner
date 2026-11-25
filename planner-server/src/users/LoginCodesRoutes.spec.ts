import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import Fastify, { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  LoginCodesEvent,
  LoginCodesRoutes,
  LoginCodesRoutesOptions,
  LoginCodesStore,
} from "@devopsplaybook.io/common-utils/users/login-codes";
import { Config } from "../Config";
import { DbUtilsClose, DbUtilsExecSQL, DbUtilsInit } from "../utils/DbUtils";
import { RunMigrations } from "../DbMigrations";
import { LoginCodesBuildRoutesOptions } from "./LoginCodes";
import {
  LOGIN_CODES_TABLE,
  LoginCodesDataCreateStore,
} from "./LoginCodesData";

/**
 * Protocol-level tests of the mounted login-code routes against the real
 * Planner store (temporary SQLite), the real `@fastify/rate-limit` wiring and
 * the real library routes. Only the auth/session callbacks are stubbed: their
 * Planner implementations are covered by LoginCodes.spec.ts and Auth.spec.ts.
 */

const dir = path.join(os.tmpdir(), `planner-login-code-routes-${Date.now()}`);
const PREFIX = "/api/users/login-codes";
const APPROVER_ID = "approver-1";
const APPROVER_NAME = "Approver";
const BASE_MS = 1700000000000;
const CHROME_MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let nowMs = BASE_MS;
let events: LoginCodesEvent[] = [];

function makeConfig(overrides: Partial<Config> = {}): Config {
  const config = new Config();
  config.JWT_KEY = "routes-test-key";
  return Object.assign(config, overrides);
}

async function buildApp(
  configOverrides: Partial<Config> = {},
  optionOverrides: Partial<LoginCodesRoutesOptions> = {},
  store: LoginCodesStore = LoginCodesDataCreateStore(),
): Promise<FastifyInstance> {
  const options: LoginCodesRoutesOptions = {
    ...LoginCodesBuildRoutesOptions(makeConfig(configOverrides), store),
    now: () => nowMs,
    getApprovingUser: async (req) => {
      const mode = req.headers["x-test-auth"];
      if (mode === "apikey") {
        return { id: APPROVER_ID, name: APPROVER_NAME, isApiToken: true };
      }
      if (mode === "jwt") {
        return { id: APPROVER_ID, name: APPROVER_NAME };
      }
      return null;
    },
    getUserById: async (id) =>
      id === APPROVER_ID ? { id, name: APPROVER_NAME } : null,
    issueSession: async (user) => ({
      token: `session-token-for-${user.id}`,
      user: { id: user.id, name: user.name, role: "user" },
    }),
    verifyPassword: async (_user, password) => password === "correct",
    onEvent: (event) => {
      events.push(event);
    },
    ...optionOverrides,
  };

  // Mirror production: @fastify/rate-limit is registered once at the host with
  // global:false so only routes opting in are limited.
  const app = Fastify();
  await app.register(rateLimit, { global: false, hook: "preHandler" });
  await app.register(
    async (instance) => {
      await LoginCodesRoutes(instance, options);
    },
    { prefix: PREFIX },
  );
  await app.ready();
  return app;
}

let app: FastifyInstance;

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
  nowMs = BASE_MS;
  events = [];
  await DbUtilsExecSQL(`DELETE FROM "${LOGIN_CODES_TABLE}"`);
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

function post(
  route: string,
  payload: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: "POST",
    url: `${PREFIX}${route}`,
    payload,
    headers,
  });
}

async function createCode(): Promise<{
  requestToken: string;
  code: string;
  codeExpiresAt: string;
  expiresAt: string;
}> {
  const response = await post("/", {}, { "user-agent": CHROME_MAC_UA });
  expect(response.statusCode).toBe(201);
  return response.json();
}

const JWT_AUTH = { "x-test-auth": "jwt" };
const API_KEY_AUTH = { "x-test-auth": "apikey" };

describe("capabilities", () => {
  it("should advertise the enabled feature and never be cached", async () => {
    const response = await app.inject({
      method: "GET",
      url: `${PREFIX}/capabilities`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(body).toMatchObject({
      enabled: true,
      available: true,
      codeLength: 8,
      rotationSeconds: 30,
      graceSeconds: 60,
      ttlSeconds: 300,
      pollIntervalMs: 2000,
      approveRequiresPassword: false,
    });
    expect(body.serverTime).toBe(new Date(BASE_MS).toISOString());
  });

  it("should report the feature unavailable when disabled", async () => {
    const disabled = await buildApp({ LOGIN_CODE_ENABLED: false });
    try {
      const response = await disabled.inject({
        method: "GET",
        url: `${PREFIX}/capabilities`,
      });
      expect(response.json()).toMatchObject({ enabled: false, available: false });
      const created = await disabled.inject({
        method: "POST",
        url: PREFIX,
        payload: {},
      });
      expect(created.statusCode).toBe(503);
      expect(created.json().code).toBe("LOGIN_CODE_UNAVAILABLE");
    } finally {
      await disabled.close();
    }
  });

  it("should report unavailable when the store table is missing", async () => {
    const missingStore = {
      available: async () => false,
    } as unknown as LoginCodesStore;
    const broken = await buildApp({}, {}, missingStore);
    try {
      const caps = await broken.inject({
        method: "GET",
        url: `${PREFIX}/capabilities`,
      });
      expect(caps.json()).toMatchObject({ enabled: true, available: false });
      const created = await broken.inject({
        method: "POST",
        url: PREFIX,
        payload: {},
      });
      expect(created.statusCode).toBe(503);
    } finally {
      await broken.close();
    }
  });

  it("should answer 503 when no hash key is configured", async () => {
    const keyless = await buildApp({ JWT_KEY: "" });
    try {
      const created = await keyless.inject({
        method: "POST",
        url: PREFIX,
        payload: {},
      });
      expect(created.statusCode).toBe(503);
      const caps = await keyless.inject({
        method: "GET",
        url: `${PREFIX}/capabilities`,
      });
      expect(caps.json()).toMatchObject({ enabled: true, available: false });
    } finally {
      await keyless.close();
    }
  });
});

describe("create", () => {
  it("should hand out an 8 character code with the configured expiries", async () => {
    const body = await createCode();
    expect(body.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/);
    expect(body.requestToken).toEqual(expect.any(String));
    expect(body.codeExpiresAt).toBe(new Date(BASE_MS + 30_000).toISOString());
    expect(body.expiresAt).toBe(new Date(BASE_MS + 300_000).toISOString());
    expect(events).toEqual([]);
  });

  it("should enforce the pending cap with 429", async () => {
    const capped = await buildApp({ LOGIN_CODE_MAX_PENDING: 1 });
    try {
      const first = await capped.inject({
        method: "POST",
        url: PREFIX,
        payload: {},
      });
      expect(first.statusCode).toBe(201);
      const second = await capped.inject({
        method: "POST",
        url: PREFIX,
        payload: {},
      });
      expect(second.statusCode).toBe(429);
      expect(second.json().code).toBe("RATE_LIMITED");
    } finally {
      await capped.close();
    }
  });

  it("should rate limit create requests per the configured max", async () => {
    const limited = await buildApp({ LOGIN_CODE_RATE_LIMIT_CREATE_MAX: 2 });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const response = await limited.inject({
          method: "POST",
          url: PREFIX,
          payload: {},
        });
        statuses.push(response.statusCode);
      }
      expect(statuses).toEqual([201, 201, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("preview and approve authorization", () => {
  it("should require authentication (401) for preview and approve", async () => {
    const created = await createCode();
    const preview = await post("/preview", { code: created.code });
    expect(preview.statusCode).toBe(401);
    expect(preview.json().code).toBe("UNAUTHENTICATED");
    const approve = await post("/approve", { code: created.code });
    expect(approve.statusCode).toBe(401);
  });

  it("should reject API keys (403) for preview and approve", async () => {
    const created = await createCode();
    const preview = await post(
      "/preview",
      { code: created.code },
      API_KEY_AUTH,
    );
    expect(preview.statusCode).toBe(403);
    expect(preview.json().code).toBe("FORBIDDEN");
    const approve = await post(
      "/approve",
      { code: created.code },
      API_KEY_AUTH,
    );
    expect(approve.statusCode).toBe(403);
    // The rejected attempt must not consume a try.
    const pending = await post("/poll", { requestToken: created.requestToken });
    expect(pending.json().status).toBe("pending");
  });

  it("should preview the requesting device for a JWT session", async () => {
    const created = await createCode();
    const preview = await post("/preview", { code: created.code }, JWT_AUTH);
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.json()).toMatchObject({
      deviceLabel: "Chrome on macOS",
      userAgent: CHROME_MAC_UA,
      userName: APPROVER_NAME,
      createdAt: new Date(BASE_MS).toISOString(),
      expiresAt: created.expiresAt,
    });
  });
});

describe("approval and redemption", () => {
  it("should approve once, then redeem the session exactly once", async () => {
    const created = await createCode();

    const approved = await post(
      "/approve",
      { code: created.code },
      JWT_AUTH,
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json().approved).toBe(true);

    const secondApproval = await post(
      "/approve",
      { code: created.code },
      JWT_AUTH,
    );
    expect(secondApproval.statusCode).toBe(400);
    expect(secondApproval.json().code).toBe("INVALID_CODE");

    const redeemed = await post("/poll", {
      requestToken: created.requestToken,
    });
    expect(redeemed.statusCode).toBe(200);
    const body = redeemed.json();
    expect(body.status).toBe("approved");
    expect(body.token).toBe(`session-token-for-${APPROVER_ID}`);
    expect(body.user).toEqual({
      id: APPROVER_ID,
      name: APPROVER_NAME,
      role: "user",
    });

    const reuse = await post("/poll", { requestToken: created.requestToken });
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json().code).toBe("ALREADY_USED");

    expect(events.map((event) => event.type)).toEqual([
      "login_code_approved",
      "login_code_consumed",
    ]);
  });

  it("should keep the previous code valid inside the rotation grace window", async () => {
    const created = await createCode();
    nowMs = BASE_MS + 31_000;

    const rotated = await post("/poll", {
      requestToken: created.requestToken,
    });
    expect(rotated.json().status).toBe("pending");
    expect(rotated.json().code).toBeTruthy();
    expect(rotated.json().code).not.toBe(created.code);

    const graceApprove = await post(
      "/approve",
      { code: created.code },
      JWT_AUTH,
    );
    expect(graceApprove.statusCode).toBe(200);

    const newCodeAfterApproval = await post(
      "/approve",
      { code: rotated.json().code },
      JWT_AUTH,
    );
    expect(newCodeAfterApproval.statusCode).toBe(400);
  });

  it("should lock the request after the configured attempts", async () => {
    const created = await createCode();
    // Attempts are counted on code resolution (a matching code), so five
    // previews succeed and the sixth is refused and fails the request.
    for (let i = 0; i < 5; i += 1) {
      const preview = await post("/preview", { code: created.code }, JWT_AUTH);
      expect(preview.statusCode).toBe(200);
    }
    const locked = await post("/preview", { code: created.code }, JWT_AUTH);
    expect(locked.statusCode).toBe(400);
    expect(locked.json().code).toBe("INVALID_CODE");
    const failed = await post("/poll", { requestToken: created.requestToken });
    expect(failed.json().status).toBe("failed");
    expect(
      events.some(
        (event) =>
          event.type === "login_code_failed" &&
          event.reason === "attempts_exceeded",
      ),
    ).toBe(true);
  });

  it("should let the requesting device cancel a pending request", async () => {
    const created = await createCode();
    const cancelled = await post("/cancel", {
      requestToken: created.requestToken,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("cancelled");
    expect((await post("/poll", { requestToken: created.requestToken })).json().status).toBe(
      "cancelled",
    );
    const approve = await post("/approve", { code: created.code }, JWT_AUTH);
    expect(approve.statusCode).toBe(400);
  });

  it("should expire a request after its ttl", async () => {
    const created = await createCode();
    nowMs = BASE_MS + 301_000;
    const polled = await post("/poll", { requestToken: created.requestToken });
    expect(polled.statusCode).toBe(200);
    expect(polled.json().status).toBe("expired");
    const approve = await post("/approve", { code: created.code }, JWT_AUTH);
    expect(approve.statusCode).toBe(400);
  });

  it("should require the account password when step-up is enabled", async () => {
    const stepped = await buildApp(
      { LOGIN_CODE_APPROVE_REQUIRE_PASSWORD: true },
      { approveRequiresPassword: true },
    );
    try {
      const created = await stepped.inject({
        method: "POST",
        url: PREFIX,
        payload: {},
      });
      const code = created.json().code;

      const noPassword = await stepped.inject({
        method: "POST",
        url: `${PREFIX}/approve`,
        payload: { code },
        headers: JWT_AUTH,
      });
      expect(noPassword.statusCode).toBe(400);
      expect(noPassword.json().code).toBe("PASSWORD_REQUIRED");

      const wrong = await stepped.inject({
        method: "POST",
        url: `${PREFIX}/approve`,
        payload: { code, password: "nope" },
        headers: JWT_AUTH,
      });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().code).toBe("INVALID_CODE");

      const right = await stepped.inject({
        method: "POST",
        url: `${PREFIX}/approve`,
        payload: { code, password: "correct" },
        headers: JWT_AUTH,
      });
      expect(right.statusCode).toBe(200);
    } finally {
      await stepped.close();
    }
  });
});

describe("secrets", () => {
  it("should never log the code or the request token", async () => {
    const created = await createCode();
    await post("/approve", { code: created.code }, JWT_AUTH);
    await post("/poll", { requestToken: created.requestToken });

    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(created.code);
    expect(serialized).not.toContain(created.requestToken);
    for (const event of events) {
      expect(event).not.toHaveProperty("code");
      expect(event).not.toHaveProperty("requestToken");
    }
  });
});

describe("poll validation", () => {
  it("should reject a missing or unknown request token", async () => {
    expect((await post("/poll", {})).statusCode).toBe(400);
    expect(
      (await post("/poll", { requestToken: "unknown" })).statusCode,
    ).toBe(400);
  });
});
