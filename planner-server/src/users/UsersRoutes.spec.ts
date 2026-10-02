/* eslint-disable @typescript-eslint/no-explicit-any */
import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import { LoginRateLimiter, UsersRoutes } from "./UsersRoutes";
import { ApiKey } from "../model/ApiKey";
import { User } from "../model/User";
import {
  AuthGenerateJWT,
  AuthGetUserSession,
  AuthInvalidateUserCache,
  AuthMustBeAdmin,
} from "./Auth";
import {
  UserPasswordCheckPassword,
  UserPasswordSetPassword,
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
  ApiKeysDataGetByUserId,
  ApiKeysDataList,
} from "./ApiKeysData";

jest.mock("./Auth", () => ({
  AuthGenerateJWT: jest.fn(),
  AuthGetUserSession: jest.fn(),
  AuthInvalidateUserCache: jest.fn(),
  AuthMustBeAdmin: jest.fn(),
}));

jest.mock("./UserPassword", () => ({
  UserPasswordCheckPassword: jest.fn(),
  UserPasswordSetPassword: jest.fn(),
}));

jest.mock("./UsersData", () => ({
  UsersDataAdd: jest.fn(),
  UsersDataDelete: jest.fn(),
  UsersDataGet: jest.fn(),
  UsersDataGetByName: jest.fn(),
  UsersDataList: jest.fn(async () => []),
  UsersDataUpdatePassword: jest.fn(),
  UsersDataUpdateUser: jest.fn(),
}));

jest.mock("./ApiKeysData", () => ({
  ApiKeysDataAdd: jest.fn(),
  ApiKeysDataDeleteByUserId: jest.fn(),
  ApiKeysDataGetByUserId: jest.fn(),
  ApiKeysDataList: jest.fn(async () => []),
}));

function makeUser(overrides: Record<string, unknown> = {}): User {
  const user = new User();
  user.name = "User";
  Object.assign(user, overrides);
  return user;
}

describe("LoginRateLimiter", () => {
  it("should allow requests below the failure limit", () => {
    const limiter = new LoginRateLimiter(3, 1000);
    limiter.registerFailure("k", 0);
    limiter.registerFailure("k", 0);
    expect(limiter.retryAfterSeconds("k", 0)).toBe(0);
  });

  it("should block at the limit and report the retry delay", () => {
    const limiter = new LoginRateLimiter(2, 60000);
    limiter.registerFailure("k", 0);
    limiter.registerFailure("k", 1000);
    const retry = limiter.retryAfterSeconds("k", 1000);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it("should forget failures outside the window", () => {
    const limiter = new LoginRateLimiter(1, 1000);
    limiter.registerFailure("k", 0);
    expect(limiter.retryAfterSeconds("k", 500)).toBeGreaterThan(0);
    expect(limiter.retryAfterSeconds("k", 2000)).toBe(0);
  });

  it("should clear the key on reset (successful login)", () => {
    const limiter = new LoginRateLimiter(1, 60000);
    limiter.registerFailure("k", 0);
    limiter.reset("k");
    expect(limiter.retryAfterSeconds("k", 0)).toBe(0);
  });

  it("should keep different keys independent", () => {
    const limiter = new LoginRateLimiter(1, 60000);
    limiter.registerFailure("a", 0);
    expect(limiter.retryAfterSeconds("b", 0)).toBe(0);
  });
});

describe("UsersRoutes", () => {
  let app: FastifyInstance;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  const adminSession = {
    isAuthenticated: true,
    userId: "admin-1",
    userName: "Admin",
    role: "admin" as const,
  };

  beforeAll(async () => {
    app = Fastify();
    await new UsersRoutes().getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
    (AuthGenerateJWT as jest.Mock).mockResolvedValue("fake-token");
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== SESSION (Login) ====================
  it("should refresh the token for an already authenticated session", async () => {
    const user = makeUser({ id: "user-1", name: "alice" });
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (UsersDataGet as jest.Mock).mockResolvedValue(user);

    const res = await app.inject({ method: "POST", url: "/session", payload: {} });

    expect(res.statusCode).toBe(201);
    expect(res.json().token).toBe("fake-token");
    expect(UsersDataGet).toHaveBeenCalledWith("user-1");
  });

  it("should answer 400 when the name is missing", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({
      method: "POST",
      url: "/session",
      payload: { password: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("should answer 403 for unknown credentials without leaking which part failed", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    (UsersDataGetByName as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/session",
      payload: { name: "ghost", password: "x" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Authentication Failed" });
  });

  it("should answer 201 with a token on a correct login", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const user = makeUser({ id: "user-1", name: "alice" });
    (UsersDataGetByName as jest.Mock).mockResolvedValue(user);
    (UserPasswordCheckPassword as jest.Mock).mockResolvedValue(true);

    const res = await app.inject({
      method: "POST",
      url: "/session",
      payload: { name: "alice", password: "pw" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().token).toBe("fake-token");
    expect(res.json().user).toEqual(user.toTransportJson());
  });

  it("should answer 429 with Retry-After after too many failures", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    (UsersDataGetByName as jest.Mock).mockResolvedValue(null);
    const payload = { name: "bruteforce-target", password: "wrong" };

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: "POST", url: "/session", payload });
      expect(res.statusCode).toBe(403);
    }

    const blocked = await app.inject({ method: "POST", url: "/session", payload });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  // ==================== LIST (Admin) ====================
  it("should answer 401 for the user list without a session", async () => {
    (AuthMustBeAdmin as jest.Mock).mockImplementation(
      async (_req: any, res: any) => {
        res.status(401).send({ error: "Access Denied" });
        throw new Error("Access Denied");
      },
    );
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(401);
  });

  it("should attach api key metadata (never key material) to the user list", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    (UsersDataList as jest.Mock).mockResolvedValue([
      makeUser({ id: "u1", name: "with-key" }),
      makeUser({ id: "u2", name: "without-key" }),
    ]);
    (ApiKeysDataList as jest.Mock).mockResolvedValue([
      ApiKey.fromJson({
        id: "key-1",
        userId: "u1",
        key: "",
        keyHash: "hash-1",
        keyPrefix: "pk_12345",
        expiresAt: null,
        dateCreated: "2026-01-01T00:00:00.000Z",
      }),
    ]);

    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].apiKey).toEqual({
      keyPrefix: "pk_12345",
      expiresAt: null,
      dateCreated: "2026-01-01T00:00:00.000Z",
    });
    expect(body[1].apiKey).toBeNull();
    expect(JSON.stringify(body)).not.toContain("hash-1");
  });

  // ==================== USER PICKER ====================
  it("should answer 401 for the picker without a session", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/picker" });
    expect(res.statusCode).toBe(401);
  });

  it("should expose only id and name in the picker", async () => {
    (UsersDataList as jest.Mock).mockResolvedValue([
      makeUser({ id: "u1", name: "alice" }),
    ]);
    const res = await app.inject({ method: "GET", url: "/picker" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: "u1", name: "alice" }]);
  });

  // ==================== CREATE (bootstrap) ====================
  it("should create the very first user as admin without authentication", async () => {
    (UsersDataList as jest.Mock).mockResolvedValue([]);
    (UsersDataGetByName as jest.Mock).mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { name: "root", password: "pw" },
    });

    expect(res.statusCode).toBe(201);
    expect(AuthMustBeAdmin).not.toHaveBeenCalled();
    expect((UsersDataAdd as jest.Mock).mock.calls[0][0].role).toBe("admin");
  });

  it("should enforce admin rights once a user exists", async () => {
    (UsersDataList as jest.Mock).mockResolvedValue([makeUser({ id: "u1" })]);
    (AuthMustBeAdmin as jest.Mock).mockImplementation(
      async (_req: any, res: any) => {
        res.status(403).send({ error: "Access Denied" });
        throw new Error("Access Denied");
      },
    );

    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { name: "newbie", password: "pw" },
    });

    expect(res.statusCode).toBe(403);
    expect(UsersDataAdd).not.toHaveBeenCalled();
  });

  // ==================== OWN PASSWORD ====================
  it("should answer 401 for the own-password change without a session", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({
      method: "PUT",
      url: "/password",
      payload: { password: "new", passwordOld: "old" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("should answer 403 when the old password is wrong", async () => {
    (UsersDataGet as jest.Mock).mockResolvedValue(makeUser());
    (UserPasswordCheckPassword as jest.Mock).mockResolvedValue(false);
    const res = await app.inject({
      method: "PUT",
      url: "/password",
      payload: { password: "new", passwordOld: "wrong" },
    });
    expect(res.statusCode).toBe(403);
    expect(UsersDataUpdatePassword).not.toHaveBeenCalled();
  });

  it("should change the password and revoke every session", async () => {
    const user = makeUser({ id: "user-1" });
    (UsersDataGet as jest.Mock).mockResolvedValue(user);
    (UserPasswordCheckPassword as jest.Mock).mockResolvedValue(true);

    const res = await app.inject({
      method: "PUT",
      url: "/password",
      payload: { password: "new", passwordOld: "old" },
    });

    expect(res.statusCode).toBe(201);
    expect(UserPasswordSetPassword).toHaveBeenCalled();
    expect(UsersDataUpdatePassword).toHaveBeenCalledWith(user);
    expect(AuthInvalidateUserCache).toHaveBeenCalledWith("user-1");
  });

  // ==================== ADMIN: UPDATE USER ====================
  it("should refuse to demote the last remaining admin", async () => {
    const onlyAdmin = makeUser({ id: "admin-2", role: "admin" });
    (UsersDataGet as jest.Mock).mockResolvedValue(onlyAdmin);
    (UsersDataList as jest.Mock).mockResolvedValue([onlyAdmin]);

    const res = await app.inject({
      method: "PUT",
      url: "/admin-2",
      payload: { role: "user" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("At least 1 admin must be defined");
    expect(UsersDataUpdateUser).not.toHaveBeenCalled();
  });

  it("should allow demoting an admin when another admin remains", async () => {
    const admin = makeUser({ id: "admin-2", role: "admin" });
    const other = makeUser({ id: "admin-3", role: "admin" });
    (UsersDataGet as jest.Mock).mockResolvedValue(admin);
    (UsersDataList as jest.Mock).mockResolvedValue([admin, other]);

    const res = await app.inject({
      method: "PUT",
      url: "/admin-2",
      payload: { role: "user" },
    });

    expect(res.statusCode).toBe(201);
    expect(admin.role).toBe("user");
    expect(UsersDataUpdateUser).toHaveBeenCalledWith(admin);
    expect(AuthInvalidateUserCache).toHaveBeenCalledWith("admin-2");
  });

  it("should promote a user to admin", async () => {
    const user = makeUser({ id: "user-2", role: "user" });
    (UsersDataGet as jest.Mock).mockResolvedValue(user);

    const res = await app.inject({
      method: "PUT",
      url: "/user-2",
      payload: { role: "admin" },
    });

    expect(res.statusCode).toBe(201);
    expect(UsersDataUpdateUser).toHaveBeenCalledWith(user);
  });

  it("should not write when the requested role is unchanged", async () => {
    const user = makeUser({ id: "user-2", role: "user" });
    (UsersDataGet as jest.Mock).mockResolvedValue(user);

    const res = await app.inject({
      method: "PUT",
      url: "/user-2",
      payload: { role: "user" },
    });

    expect(res.statusCode).toBe(201);
    expect(UsersDataUpdateUser).not.toHaveBeenCalled();
  });

  // ==================== ADMIN: DELETE USER ====================
  it("should refuse to delete your own account", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    const res = await app.inject({ method: "DELETE", url: "/admin-1" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Cannot Delete Yourself");
  });

  it("should refuse to delete the last remaining admin", async () => {
    const onlyAdmin = makeUser({ id: "admin-2", role: "admin" });
    (UsersDataGet as jest.Mock).mockResolvedValue(onlyAdmin);
    (UsersDataList as jest.Mock).mockResolvedValue([onlyAdmin]);
    const res = await app.inject({ method: "DELETE", url: "/admin-2" });
    expect(res.statusCode).toBe(400);
    expect(UsersDataDelete).not.toHaveBeenCalled();
  });

  it("should delete another user including all related rows", async () => {
    const user = makeUser({ id: "user-2", role: "user" });
    (UsersDataGet as jest.Mock).mockResolvedValue(user);
    const res = await app.inject({ method: "DELETE", url: "/user-2" });
    expect(res.statusCode).toBe(201);
    expect(UsersDataDelete).toHaveBeenCalledWith("user-2");
    expect(AuthInvalidateUserCache).toHaveBeenCalledWith("user-2");
  });

  it("should answer 404 when deleting a missing user", async () => {
    (UsersDataGet as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({ method: "DELETE", url: "/missing" });
    expect(res.statusCode).toBe(404);
  });

  // ==================== API KEYS (Self) ====================
  it("should answer 401 for the own api-key endpoints without a session", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    expect((await app.inject({ method: "GET", url: "/api-key" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/api-key", payload: {} }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/api-key" })).statusCode).toBe(401);
  });

  it("should create an api key and return the full key exactly once", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api-key",
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key.startsWith("pk_")).toBe(true);
    expect(body.keyPrefix).toBe(body.key.substring(0, 8));
    const stored = (ApiKeysDataAdd as jest.Mock).mock.calls[0][0] as ApiKey;
    expect(stored.userId).toBe("user-1");
    expect(stored.keyHash).toBeDefined();
  });

  it("should reject an invalid expiresAt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api-key",
      payload: { expiresAt: "garbage" },
    });
    expect(res.statusCode).toBe(400);
    expect(ApiKeysDataAdd).not.toHaveBeenCalled();
  });

  it("should normalize a valid expiresAt to ISO 8601", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api-key",
      payload: { expiresAt: "2027-01-01" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().expiresAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("should return the api key metadata masked (never the full key)", async () => {
    (ApiKeysDataGetByUserId as jest.Mock).mockResolvedValue(
      ApiKey.fromJson({
        id: "key-1",
        userId: "user-1",
        key: "",
        keyHash: "hash-1",
        keyPrefix: "pk_12345",
        expiresAt: null,
        dateCreated: "2026-01-01T00:00:00.000Z",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api-key" });
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toBe("pk_12345...");
    expect(JSON.stringify(res.json())).not.toContain("hash-1");
  });

  it("should answer 404 when no api key exists", async () => {
    (ApiKeysDataGetByUserId as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/api-key" });
    expect(res.statusCode).toBe(404);
  });

  it("should delete the own api key", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api-key" });
    expect(res.statusCode).toBe(201);
    expect(ApiKeysDataDeleteByUserId).toHaveBeenCalledWith("user-1");
  });

  // ==================== API KEYS (Admin) ====================
  it("should answer 404 when creating an api key for a missing user", async () => {
    (UsersDataGet as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/missing/api-key",
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(ApiKeysDataAdd).not.toHaveBeenCalled();
  });

  it("should create an api key for another user as admin", async () => {
    const user = makeUser({ id: "user-2" });
    (UsersDataGet as jest.Mock).mockResolvedValue(user);
    const res = await app.inject({
      method: "POST",
      url: "/user-2/api-key",
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect((ApiKeysDataAdd as jest.Mock).mock.calls[0][0].userId).toBe("user-2");
  });
});
