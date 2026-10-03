/* eslint-disable @typescript-eslint/no-explicit-any */
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import {
  AUTH_USER_CACHE_TTL_MS,
  AuthInit,
  AuthGenerateJWT,
  AuthInvalidateUserCache,
  AuthMustBeAuthenticated,
  AuthMustBeAdmin,
  AuthGetUserSession,
  AuthRateLimitKey,
} from "../users/Auth";
import { User } from "../model/User";

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(() => "fake-jwt-token"),
  verify: jest.fn(() => {
    throw new Error("token expired");
  }),
}));

jest.mock("./UsersData", () => ({
  UsersDataGet: jest.fn(),
}));

jest.mock("./ApiKeysData", () => ({
  ApiKeysDataGetByKey: jest.fn(),
}));

import { UsersDataGet } from "./UsersData";
import { ApiKeysDataGetByKey } from "./ApiKeysData";

const mockJwt = jwt as jest.Mocked<typeof jwt>;
const mockUsersDataGet = UsersDataGet as jest.Mock;
const mockApiKeysDataGetByKey = ApiKeysDataGetByKey as jest.Mock;

const mockConfig = {
  JWT_KEY: "test-key",
  JWT_VALIDITY_DURATION: 3600,
} as any;

function makeUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = "user-1";
  user.name = "testuser";
  user.role = "user";
  user.tokenVersion = 0;
  Object.assign(user, overrides);
  return user;
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), send: jest.fn() };
}

describe("Auth", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset the module-level user cache between tests
    await AuthInit(mockConfig);
  });

  describe("AuthGenerateJWT", () => {
    it("should sign the user payload including the token version", async () => {
      const user = makeUser({ id: "user-1", name: "testuser", role: "user" });

      const token = await AuthGenerateJWT(user);

      expect(token).toBe("fake-jwt-token");
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          userName: "testuser",
          role: "user",
          tv: 0,
          exp: expect.any(Number),
        }),
        "test-key",
      );
    });

    it("should sign the current token version", async () => {
      const user = makeUser({ tokenVersion: 4 });
      await AuthGenerateJWT(user);
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ tv: 4 }),
        "test-key",
      );
    });
  });

  describe("AuthMustBeAuthenticated", () => {
    it("should pass when the token is valid and the user exists", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "user-1",
        tv: 0,
      });
      mockUsersDataGet.mockResolvedValue(makeUser());

      const req = { headers: { authorization: "Bearer valid-token" } };
      const res = makeRes();

      await expect(
        AuthMustBeAuthenticated(req as any, res as any),
      ).resolves.toBeUndefined();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should answer 401 when no credential is provided", async () => {
      const req = { headers: {} };
      const res = makeRes();

      await expect(
        AuthMustBeAuthenticated(req as any, res as any),
      ).rejects.toThrow("Access Denied");
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({ error: "Access Denied" });
    });

    it("should answer 401 when the token is invalid", async () => {
      (mockJwt.verify as jest.Mock).mockImplementationOnce(() => {
        throw new Error("jwt malformed");
      });

      const req = { headers: { authorization: "Bearer bad-token" } };
      const res = makeRes();

      await expect(
        AuthMustBeAuthenticated(req as any, res as any),
      ).rejects.toThrow("Access Denied");
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("should answer 401 when the user behind the token no longer exists", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "deleted-user",
        tv: 0,
      });
      mockUsersDataGet.mockResolvedValue(null);

      const req = { headers: { authorization: "Bearer valid-token" } };
      const res = makeRes();

      await expect(
        AuthMustBeAuthenticated(req as any, res as any),
      ).rejects.toThrow("Access Denied");
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("should answer 401 when the token version is revoked (tv mismatch)", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "user-1",
        tv: 0,
      });
      // Password change / role change / delete bumped the stored version
      mockUsersDataGet.mockResolvedValue(makeUser({ tokenVersion: 1 }));

      const req = { headers: { authorization: "Bearer old-token" } };
      const res = makeRes();

      await expect(
        AuthMustBeAuthenticated(req as any, res as any),
      ).rejects.toThrow("Access Denied");
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("should authenticate through a valid API key", async () => {
      mockApiKeysDataGetByKey.mockResolvedValue({ userId: "user-1" });
      mockUsersDataGet.mockResolvedValue(makeUser());

      const req = { headers: { "x-api-key": "pk_valid" } };
      const res = makeRes();

      await expect(
        AuthMustBeAuthenticated(req as any, res as any),
      ).resolves.toBeUndefined();
      expect(mockApiKeysDataGetByKey).toHaveBeenCalledWith("pk_valid");
    });

    it("should answer 401 for an unknown or expired API key", async () => {
      mockApiKeysDataGetByKey.mockResolvedValue(null);

      const req = { headers: { "x-api-key": "pk_unknown" } };
      const res = makeRes();

      await expect(
        AuthMustBeAuthenticated(req as any, res as any),
      ).rejects.toThrow("Access Denied");
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("should cache the decoded payload on the request", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValue({
        userId: "user-1",
        tv: 0,
      });
      mockUsersDataGet.mockResolvedValue(makeUser());

      const req: any = { headers: { authorization: "Bearer token" } };
      const res = makeRes();

      await AuthMustBeAuthenticated(req as any, res as any);
      expect(req._jwtPayload).toBeDefined();
      expect(req._jwtPayload.userId).toBe("user-1");

      // Second call should use the request cache, not call jwt.verify again
      await AuthMustBeAuthenticated(req as any, res as any);
      expect(mockJwt.verify).toHaveBeenCalledTimes(1);
    });

    it("should reuse the validated user across requests within the TTL", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValue({ userId: "user-1", tv: 0 });
      mockUsersDataGet.mockResolvedValue(makeUser());

      await AuthMustBeAuthenticated(
        { headers: { authorization: "Bearer t1" } } as any,
        makeRes() as any,
      );
      await AuthMustBeAuthenticated(
        { headers: { authorization: "Bearer t2" } } as any,
        makeRes() as any,
      );

      expect(mockUsersDataGet).toHaveBeenCalledTimes(1);
    });

    it("should re-validate the user after an explicit cache invalidation", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValue({ userId: "user-1", tv: 0 });
      mockUsersDataGet.mockResolvedValue(makeUser());

      await AuthMustBeAuthenticated(
        { headers: { authorization: "Bearer t1" } } as any,
        makeRes() as any,
      );
      AuthInvalidateUserCache("user-1");
      await AuthMustBeAuthenticated(
        { headers: { authorization: "Bearer t2" } } as any,
        makeRes() as any,
      );

      expect(mockUsersDataGet).toHaveBeenCalledTimes(2);
    });

    it("should document a short cache TTL (revocation latency bound)", () => {
      expect(AUTH_USER_CACHE_TTL_MS).toBeLessThanOrEqual(60 * 1000);
    });
  });

  describe("AuthMustBeAdmin", () => {
    it("should pass for an admin", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "admin-1",
        tv: 0,
      });
      mockUsersDataGet.mockResolvedValue(
        makeUser({ id: "admin-1", role: "admin" }),
      );

      const req = { headers: { authorization: "Bearer admin-token" } };
      const res = makeRes();

      await expect(
        AuthMustBeAdmin(req as any, res as any),
      ).resolves.toBeUndefined();
    });

    it("should answer 403 for an authenticated non-admin", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "user-1",
        tv: 0,
      });
      mockUsersDataGet.mockResolvedValue(makeUser());

      const req = { headers: { authorization: "Bearer user-token" } };
      const res = makeRes();

      await expect(AuthMustBeAdmin(req as any, res as any)).rejects.toThrow(
        "Access Denied",
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should answer 401 when not authenticated at all", async () => {
      const req = { headers: {} };
      const res = makeRes();

      await expect(AuthMustBeAdmin(req as any, res as any)).rejects.toThrow(
        "Access Denied",
      );
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe("AuthGetUserSession", () => {
    it("should return the authenticated session for a valid token", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "user-1",
        tv: 0,
      });
      mockUsersDataGet.mockResolvedValue(makeUser({ name: "Alice" }));

      const req = { headers: { authorization: "Bearer valid-token" } };
      const session = await AuthGetUserSession(req as any);

      expect(session.isAuthenticated).toBe(true);
      expect(session.userId).toBe("user-1");
      expect(session.userName).toBe("Alice");
      expect(session.role).toBe("user");
    });

    it("should prefer the stored user over the token claims", async () => {
      // The token says admin but the database says user (role downgraded):
      // the stored role wins
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "user-1",
        role: "admin",
        tv: 0,
      });
      mockUsersDataGet.mockResolvedValue(makeUser({ role: "user" }));

      const req = { headers: { authorization: "Bearer old-token" } };
      const session = await AuthGetUserSession(req as any);

      expect(session.isAuthenticated).toBe(true);
      expect(session.role).toBe("user");
    });

    it("should return an unauthenticated session when no credential is given", async () => {
      const session = await AuthGetUserSession({ headers: {} } as any);
      expect(session.isAuthenticated).toBe(false);
      expect(session.userId).toBeUndefined();
    });
  });

  describe("AuthRateLimitKey", () => {
    it("should key by user id for a verifiable JWT", () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "user-1",
        tv: 0,
      });
      expect(
        AuthRateLimitKey({
          headers: { authorization: "Bearer some-token" },
          ip: "1.2.3.4",
        }),
      ).toBe("user:user-1");
    });

    it("should key by hashed API key when no valid JWT is present", () => {
      (mockJwt.verify as jest.Mock).mockImplementationOnce(() => {
        throw new Error("invalid");
      });
      const key = AuthRateLimitKey({
        headers: { "x-api-key": "pk_secret" },
        ip: "1.2.3.4",
      });
      expect(key).toBe(
        "key:" + crypto.createHash("sha256").update("pk_secret").digest("hex"),
      );
      expect(key).not.toContain("pk_secret");
    });

    it("should fall back to the client IP without any credential", () => {
      expect(AuthRateLimitKey({ headers: {}, ip: "1.2.3.4" })).toBe(
        "ip:1.2.3.4",
      );
    });
  });
});
