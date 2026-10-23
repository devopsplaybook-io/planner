import { FastifyInstance, RequestGenericInterface } from "fastify";
import { User } from "../model/User";
import { ApiKey } from "../model/ApiKey";
import {
  AuthGenerateJWT,
  AuthGetUserSession,
  AuthInvalidateUserCache,
  AuthMustBeAdmin,
} from "./Auth";
import {
  UserPasswordCheckPassword,
  UserPasswordCompareDummy,
  UserPasswordSetPassword,
  UserPasswordValidate,
} from "./UserPassword";
import {
  UsersDataAdd,
  UsersDataDelete,
  UsersDataGet,
  UsersDataGetByName,
  UsersDataList,
  UsersDataUpdatePassword,
  UsersDataUpdateUser,
} from "./UsersData";
import {
  ApiKeysDataAdd,
  ApiKeysDataDeleteByUserId,
  ApiKeysDataGetByKey,
  ApiKeysDataGetByUserId,
  ApiKeysDataList,
} from "./ApiKeysData";
import { buildTasksIcs, CalendarFeedEntry } from "./CalendarFeed";
import { ProjectsDataList } from "../projects/ProjectsData";
import { TasksDataList, TaskListFilters } from "../tasks/TasksData";

const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Done tasks stay in the feed for this long after their last update. */
const CALENDAR_DONE_WINDOW_DAYS = 30;

/**
 * Failed-login limiter, keyed by client IP + user name. Deliberately not a
 * global rate limit so that legitimate session refreshes (and API-key
 * clients) are never throttled.
 */
export class LoginRateLimiter {
  private failures = new Map<string, number[]>();

  constructor(
    private maxFailures: number = LOGIN_MAX_FAILURES,
    private windowMs: number = LOGIN_WINDOW_MS,
  ) {}

  private recentFailures(key: string, now: number): number[] {
    const recent = (this.failures.get(key) || []).filter(
      (t) => now - t < this.windowMs,
    );
    if (recent.length === 0) {
      this.failures.delete(key);
    } else {
      this.failures.set(key, recent);
    }
    return recent;
  }

  /** Seconds before the next attempt is allowed; 0 when allowed now. */
  public retryAfterSeconds(key: string, now: number = Date.now()): number {
    const recent = this.recentFailures(key, now);
    if (recent.length < this.maxFailures) {
      return 0;
    }
    return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
  }

  public registerFailure(key: string, now: number = Date.now()): void {
    const recent = this.recentFailures(key, now);
    recent.push(now);
    this.failures.set(key, recent);
  }

  public reset(key: string): void {
    this.failures.delete(key);
  }

  /**
   * Drops expired timestamps and deletes the keys that have none left.
   * Returns the number of removed keys.
   */
  public sweep(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, timestamps] of this.failures) {
      const recent = timestamps.filter((t) => now - t < this.windowMs);
      if (recent.length === 0) {
        this.failures.delete(key);
        removed++;
      } else {
        this.failures.set(key, recent);
      }
    }
    return removed;
  }

  /** Number of keys currently tracked (test helper). */
  public size(): number {
    return this.failures.size;
  }
}

const loginRateLimiter = new LoginRateLimiter();

let loginRateLimiterSweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Periodically prunes the failed-login map so attacker-controlled
 * IP|username keys cannot accumulate forever. The timer never blocks
 * process exit and starting it twice is a no-op.
 */
export function LoginRateLimiterStartSweep(
  intervalMs: number = LOGIN_WINDOW_MS,
): void {
  if (loginRateLimiterSweepTimer) {
    return;
  }
  loginRateLimiterSweepTimer = setInterval(() => {
    loginRateLimiter.sweep();
  }, intervalMs);
  loginRateLimiterSweepTimer.unref?.();
}

export class UsersRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== SESSION (Login) ====================
    interface PostSession extends RequestGenericInterface {
      Body: { name: string; password: string };
    }
    fastify.post<PostSession>("/session", async (req, res) => {
      // From token
      const userSession = await AuthGetUserSession(req);
      if (userSession.isAuthenticated) {
        const user = await UsersDataGet(userSession.userId);
        if (!user) {
          return res.status(403).send({ error: "Authentication Failed" });
        }
        return res.status(201).send({
          success: true,
          token: await AuthGenerateJWT(user),
          user: user.toTransportJson(),
        });
      }

      // From User/Pass
      if (!req.body?.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      const limiterKey = `${req.ip}|${req.body.name}`;
      const retryAfter = loginRateLimiter.retryAfterSeconds(limiterKey);
      if (retryAfter > 0) {
        res.header("Retry-After", String(retryAfter));
        return res.status(429).send({ error: "Too Many Attempts" });
      }
      const user = await UsersDataGetByName(req.body.name);
      if (!user) {
        // Same bcrypt work as a wrong password: a miss must not be
        // distinguishable from a hit by response timing.
        await UserPasswordCompareDummy(req.body.password);
        loginRateLimiter.registerFailure(limiterKey);
        return res.status(403).send({ error: "Authentication Failed" });
      }
      if (await UserPasswordCheckPassword(user, req.body.password)) {
        loginRateLimiter.reset(limiterKey);
        return res.status(201).send({
          success: true,
          token: await AuthGenerateJWT(user),
          user: user.toTransportJson(),
        });
      }
      loginRateLimiter.registerFailure(limiterKey);
      return res.status(403).send({ error: "Authentication Failed" });
    });

    // ==================== LIST USERS (Admin only) ====================
    fastify.get("/", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const users = await UsersDataList();
      const apiKeys = await ApiKeysDataList();
      const keyByUser = new Map(apiKeys.map((key) => [key.userId, key]));
      return res.status(200).send(
        users.map((u) => {
          const apiKey = keyByUser.get(u.id);
          return {
            ...u.toTransportJson(),
            apiKey: apiKey
              ? {
                  keyPrefix: apiKey.keyPrefix,
                  expiresAt: apiKey.expiresAt,
                  dateCreated: apiKey.dateCreated,
                }
              : null,
          };
        }),
      );
    });

    // ==================== USER PICKER (Authenticated users) ====================
    fastify.get("/picker", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const users = await UsersDataList();
      return res
        .status(200)
        .send(users.map((u) => ({ id: u.id, name: u.name })));
    });

    // ==================== CREATE USER ====================
    interface PostUser extends RequestGenericInterface {
      Body: { name: string; password: string; role?: string };
    }
    fastify.post<PostUser>("/", async (req, res) => {
      let isInitialized = true;
      if ((await UsersDataList()).length === 0) {
        isInitialized = false;
      }

      if (isInitialized) {
        try {
          await AuthMustBeAdmin(req, res);
        } catch {
          return;
        }
      }

      if (!req.body?.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      const passwordError = UserPasswordValidate(req.body.password);
      if (passwordError) {
        return res.status(400).send({ error: passwordError });
      }
      if (await UsersDataGetByName(req.body.name)) {
        return res.status(400).send({ error: "Username Already Exists" });
      }

      const newUser = new User();
      newUser.name = req.body.name;
      newUser.role = isInitialized
        ? req.body.role === "admin"
          ? "admin"
          : "user"
        : "admin";
      await UserPasswordSetPassword(newUser, req.body.password);
      await UsersDataAdd(newUser);
      return res.status(201).send({ user: newUser.toTransportJson() });
    });

    // ==================== CHANGE OWN PASSWORD ====================
    interface PutOwnPassword extends RequestGenericInterface {
      Body: { password: string; passwordOld: string };
    }
    fastify.put<PutOwnPassword>("/password", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const user = await UsersDataGet(userSession.userId);
      if (!req.body?.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      const passwordError = UserPasswordValidate(req.body.password);
      if (passwordError) {
        return res.status(400).send({ error: passwordError });
      }
      if (!(await UserPasswordCheckPassword(user, req.body.passwordOld))) {
        return res.status(403).send({ error: "Old Password Wrong" });
      }
      await UserPasswordSetPassword(user, req.body.password);
      // Revokes every session of the user, including the current one
      await UsersDataUpdatePassword(user);
      AuthInvalidateUserCache(user.id);
      return res.status(201).send({});
    });

    // ==================== ADMIN: UPDATE USER ====================
    interface PutUser extends RequestGenericInterface {
      Params: { id: string };
      Body: { role?: string; password?: string };
    }
    fastify.put<PutUser>("/:id", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }

      const user = await UsersDataGet(req.params.id);
      if (!user) {
        return res.status(404).send({ error: "User Not Found" });
      }
      if (!req.body) {
        return res.status(400).send({ error: "Missing: body" });
      }
      if (req.body.password) {
        const passwordError = UserPasswordValidate(req.body.password);
        if (passwordError) {
          return res.status(400).send({ error: passwordError });
        }
      }

      if (req.body.role) {
        const newRole = req.body.role === "admin" ? "admin" : "user";
        if (newRole !== user.role) {
          // Check at least 1 admin remains (same guard as DELETE)
          if (user.role === "admin") {
            const admins = (await UsersDataList()).filter(
              (u) => u.role === "admin",
            );
            if (admins.length <= 1) {
              return res
                .status(400)
                .send({ error: "At least 1 admin must be defined" });
            }
          }
          user.role = newRole;
          // Bumps the token version: outstanding tokens are revoked
          await UsersDataUpdateUser(user);
          AuthInvalidateUserCache(user.id);
        }
      }

      if (req.body.password) {
        await UserPasswordSetPassword(user, req.body.password);
        await UsersDataUpdatePassword(user);
        AuthInvalidateUserCache(user.id);
      }

      return res.status(201).send({ user: user.toTransportJson() });
    });

    // ==================== ADMIN: DELETE USER ====================
    interface DeleteUser extends RequestGenericInterface {
      Params: { id: string };
    }
    fastify.delete<DeleteUser>("/:id", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }

      const userSession = await AuthGetUserSession(req);
      if (userSession.userId === req.params.id) {
        return res.status(400).send({ error: "Cannot Delete Yourself" });
      }

      const user = await UsersDataGet(req.params.id);
      if (!user) {
        return res.status(404).send({ error: "User Not Found" });
      }

      // Check at least 1 admin remains
      if (user.role === "admin") {
        const admins = (await UsersDataList()).filter(
          (u) => u.role === "admin",
        );
        if (admins.length <= 1) {
          return res
            .status(400)
            .send({ error: "At least 1 admin must be defined" });
        }
      }

      await UsersDataDelete(req.params.id);
      AuthInvalidateUserCache(req.params.id);
      return res.status(201).send({});
    });

    // ==================== API KEYS (Self) ====================
    fastify.get("/api-key", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const apiKey = await ApiKeysDataGetByUserId(userSession.userId);
      if (!apiKey) {
        return res.status(404).send({ error: "No API Key" });
      }
      return res.status(200).send(apiKey.toTransportJson());
    });

    interface PostApiKey extends RequestGenericInterface {
      Body: { expiresAt?: string };
    }
    fastify.post<PostApiKey>("/api-key", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const apiKey = new ApiKey();
      apiKey.userId = userSession.userId;
      const expiresAt = parseExpiresAt(req.body?.expiresAt);
      if (expiresAt === null) {
        return res
          .status(400)
          .send({ error: "Invalid: expiresAt (must be an ISO 8601 date)" });
      }
      apiKey.expiresAt = expiresAt;
      await ApiKeysDataAdd(apiKey);
      // Return the full key ONCE so the user can copy it
      return res.status(201).send({
        key: apiKey.key,
        keyPrefix: apiKey.keyPrefix,
        expiresAt: apiKey.expiresAt,
      });
    });

    fastify.delete("/api-key", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      await ApiKeysDataDeleteByUserId(userSession.userId);
      return res.status(201).send({});
    });

    // ==================== CALENDAR FEED (ICS) ====================
    interface CalendarIcsQuery extends RequestGenericInterface {
      Querystring: { apiKey?: string };
    }
    fastify.get<CalendarIcsQuery>("/calendar.ics", async (req, res) => {
      let userId: string;
      let role: string;
      const userSession = await AuthGetUserSession(req);
      if (userSession.isAuthenticated) {
        userId = userSession.userId;
        role = userSession.role;
      } else {
        // Calendar clients cannot send custom headers, so this route also
        // accepts the API key as a query parameter. The fallback is scoped
        // to this route on purpose: a key in a URL leaks into logs and
        // history, and the key owner treats the feed URL as a secret.
        const apiKeyParam = req.query?.apiKey;
        if (!apiKeyParam) {
          return res.status(401).send({ error: "Access Denied" });
        }
        const keyRecord = await ApiKeysDataGetByKey(apiKeyParam);
        const user = keyRecord ? await UsersDataGet(keyRecord.userId) : null;
        if (!user) {
          return res.status(401).send({ error: "Access Denied" });
        }
        userId = user.id;
        role = user.role;
      }

      const filters: TaskListFilters = {
        doneSince: new Date(
          Date.now() - CALENDAR_DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
        hasDueDate: true,
      };
      // Admins see everything; other users only get tasks from projects
      // they can see (same enforcement as the task list endpoint).
      if (role !== "admin") {
        filters.visibleTo = { userId };
      }
      const tasks = await TasksDataList(
        filters,
        new Set(["id", "projectId", "title", "description", "status", "dueDate"]),
      );
      const projects = await ProjectsDataList();
      const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
      const entries: CalendarFeedEntry[] = tasks
        .filter((t) => t.dueDate)
        .map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          projectName: projectNameById.get(t.projectId),
          dueDate: t.dueDate,
        }));
      res.header("Content-Type", "text/calendar; charset=utf-8");
      return res.status(200).send(buildTasksIcs(entries, new Date()));
    });

    // ==================== API KEYS (Admin) ====================
    fastify.get<{ Params: { id: string } }>("/:id/api-key", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const apiKey = await ApiKeysDataGetByUserId(req.params.id);
      if (!apiKey) {
        return res.status(404).send({ error: "No API Key" });
      }
      return res.status(200).send(apiKey.toTransportJson());
    });

    fastify.post<{ Params: { id: string }; Body: { expiresAt?: string } }>(
      "/:id/api-key",
      async (req, res) => {
        try {
          await AuthMustBeAdmin(req, res);
        } catch {
          return;
        }
        const user = await UsersDataGet(req.params.id);
        if (!user) {
          return res.status(404).send({ error: "User Not Found" });
        }
        const expiresAt = parseExpiresAt(req.body?.expiresAt);
        if (expiresAt === null) {
          return res
            .status(400)
            .send({ error: "Invalid: expiresAt (must be an ISO 8601 date)" });
        }
        const apiKey = new ApiKey();
        apiKey.userId = user.id;
        apiKey.expiresAt = expiresAt;
        await ApiKeysDataAdd(apiKey);
        // Return the full key ONCE so the admin can share it with the user
        return res.status(201).send({
          key: apiKey.key,
          keyPrefix: apiKey.keyPrefix,
          expiresAt: apiKey.expiresAt,
        });
      },
    );

    fastify.delete<{ Params: { id: string } }>("/:id/api-key", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      await ApiKeysDataDeleteByUserId(req.params.id);
      return res.status(201).send({});
    });
  }
}

/**
 * Normalizes an optional ISO 8601 expiry. Returns undefined when absent and
 * null when present but invalid (caller answers 400).
 */
function parseExpiresAt(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}
