/* eslint-disable @typescript-eslint/no-explicit-any */
import * as jwt from "jsonwebtoken";
import {
  AuthInit,
  AuthGenerateJWT,
  AuthMustBeAuthenticated,
  AuthMustBeAdmin,
  AuthGetUserSession,
} from "../users/Auth";
import { User } from "../model/User";

// Mock jsonwebtoken
jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(() => "fake-jwt-token"),
  verify: jest.fn(() => {
    throw new Error("token expired");
  }),
}));

const mockJwt = jwt as jest.Mocked<typeof jwt>;

const mockConfig = {
  JWT_KEY: "test-key",
  JWT_VALIDITY_DURATION: 3600,
} as any;

describe("Auth", () => {
  beforeAll(async () => {
    await AuthInit(mockConfig);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("AuthGenerateJWT", () => {
    it("should call jwt.sign with user payload and config key", async () => {
      const user = new User();
      user.id = "user-1";
      user.name = "testuser";
      user.role = "user";

      const token = await AuthGenerateJWT(user);

      expect(token).toBe("fake-jwt-token");
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          userName: "testuser",
          role: "user",
          exp: expect.any(Number),
        }),
        "test-key",
      );
    });
  });

  describe("AuthMustBeAuthenticated", () => {
    it("should pass when a valid authorization header is provided", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "user-1",
        role: "user",
      });

      const req = { headers: { authorization: "Bearer valid-token" } };
      const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };

      await expect(
        AuthMustBeAuthenticated(req as any, res as any),
      ).resolves.toBeUndefined();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should throw and send 403 when no authorization header", async () => {
      const req = { headers: {} };
      const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };

      await expect(
        AuthMustBeAuthenticated(req as any, res as any),
      ).rejects.toThrow("Access Denied");
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith({ error: "Access Denied" });
    });

    it("should throw and send 403 when token is invalid", async () => {
      (mockJwt.verify as jest.Mock).mockImplementationOnce(() => {
        throw new Error("jwt malformed");
      });

      const req = { headers: { authorization: "Bearer bad-token" } };
      const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };

      await expect(
        AuthMustBeAuthenticated(req as any, res as any),
      ).rejects.toThrow("Access Denied");
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should cache decoded payload in req._jwtPayload", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "user-1",
        role: "user",
      });

      const req: any = { headers: { authorization: "Bearer token" } };
      const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };

      await AuthMustBeAuthenticated(req as any, res as any);
      expect(req._jwtPayload).toBeDefined();
      expect(req._jwtPayload.userId).toBe("user-1");

      // Second call should use cache, not call jwt.verify again
      await AuthMustBeAuthenticated(req as any, res as any);
      expect(mockJwt.verify).toHaveBeenCalledTimes(1);
    });
  });

  describe("AuthMustBeAdmin", () => {
    it("should pass for admin role", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "admin-1",
        role: "admin",
      });

      const req = { headers: { authorization: "Bearer admin-token" } };
      const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };

      await expect(
        AuthMustBeAdmin(req as any, res as any),
      ).resolves.toBeUndefined();
    });

    it("should throw and send 403 for non-admin role", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "user-1",
        role: "user",
      });

      const req = { headers: { authorization: "Bearer user-token" } };
      const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };

      await expect(AuthMustBeAdmin(req as any, res as any)).rejects.toThrow(
        "Access Denied",
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should throw and send 403 when no token", async () => {
      const req = { headers: {} };
      const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };

      await expect(AuthMustBeAdmin(req as any, res as any)).rejects.toThrow(
        "Access Denied",
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("AuthGetUserSession", () => {
    it("should return authenticated session for valid token", async () => {
      (mockJwt.verify as jest.Mock).mockReturnValueOnce({
        userId: "user-1",
        userName: "Alice",
        role: "user",
      });

      const req = { headers: { authorization: "Bearer valid-token" } };
      const session = await AuthGetUserSession(req as any);

      expect(session.isAuthenticated).toBe(true);
      expect(session.userId).toBe("user-1");
      expect(session.userName).toBe("Alice");
      expect(session.role).toBe("user");
    });

    it("should return unauthenticated session when no token", async () => {
      const req = { headers: {} };
      const session = await AuthGetUserSession(req as any);

      expect(session.isAuthenticated).toBe(false);
      expect(session.userId).toBeUndefined();
    });
  });
});
