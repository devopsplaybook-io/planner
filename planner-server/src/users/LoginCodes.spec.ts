import { Config } from "../Config";
import { User } from "../model/User";
import {
  LoginCodesBuildRoutesOptions,
  LoginCodesBuildSettings,
  LoginCodesLogEvent,
} from "./LoginCodes";
import { LoginCodesStore } from "@devopsplaybook.io/common-utils/users/login-codes";

jest.mock("./Auth", () => ({
  AuthGenerateJWT: jest.fn(async () => "fake-jwt"),
  AuthGetCredentialSession: jest.fn(),
}));

jest.mock("./UsersData", () => ({
  UsersDataGet: jest.fn(),
}));

jest.mock("./UserPassword", () => ({
  UserPasswordCheckPassword: jest.fn(),
}));

import { AuthGenerateJWT, AuthGetCredentialSession } from "./Auth";
import { UsersDataGet } from "./UsersData";
import { UserPasswordCheckPassword } from "./UserPassword";

const mockGetCredentialSession = AuthGetCredentialSession as jest.Mock;
const mockGenerateJWT = AuthGenerateJWT as jest.Mock;
const mockUsersDataGet = UsersDataGet as jest.Mock;
const mockCheckPassword = UserPasswordCheckPassword as jest.Mock;

function makeConfig(overrides: Partial<Config> = {}): Config {
  const config = new Config();
  config.JWT_KEY = "test-key";
  return Object.assign(config, overrides);
}

const store = {} as LoginCodesStore;

function makeUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = "user-1";
  user.name = "ann";
  user.role = "user";
  return Object.assign(user, overrides);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("LoginCodesBuildSettings", () => {
  it("should read Planner's defaults through the library config reader", () => {
    const settings = LoginCodesBuildSettings(makeConfig());
    expect(settings).toEqual({
      enabled: true,
      ttlSeconds: 300,
      rotationSeconds: 30,
      graceSeconds: 60,
      pollIntervalMs: 2000,
      maxAttempts: 5,
      maxPending: 100,
      rateLimitCreateMax: 10,
      rateLimitPollMax: 120,
      rateLimitApproveMax: 10,
      rateLimitWindowSeconds: 60,
      approveRequiresPassword: false,
    });
  });

  it("should apply the library clamps (rotation never below 5 s, ttl below 30 s)", () => {
    const settings = LoginCodesBuildSettings(
      makeConfig({
        LOGIN_CODE_TTL_SECONDS: 1,
        LOGIN_CODE_ROTATION_SECONDS: 1,
        LOGIN_CODE_GRACE_SECONDS: 9999,
      }),
    );
    expect(settings.ttlSeconds).toBe(30);
    expect(settings.rotationSeconds).toBe(5);
    expect(settings.graceSeconds).toBe(600);
  });

  it("should map PLAN's rate-limit window to the library window", () => {
    const settings = LoginCodesBuildSettings(
      makeConfig({ LOGIN_CODE_RATE_LIMIT_WINDOW_SECONDS: 45 }),
    );
    expect(settings.rateLimitWindowSeconds).toBe(45);
  });

  it("should honour the explicit password step-up setting", () => {
    const settings = LoginCodesBuildSettings(
      makeConfig({ LOGIN_CODE_APPROVE_REQUIRE_PASSWORD: true }),
    );
    expect(settings.approveRequiresPassword).toBe(true);
  });
});

describe("LoginCodesLogEvent", () => {
  it("should log only allow-listed fields and never a code or request token", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      LoginCodesLogEvent({
        type: "login_code_approved",
        requestId: "req-1",
        userId: "user-1",
        userName: "ann",
        deviceLabel: "Chrome on macOS",
        reason: "attempts_exceeded",
        ip: "203.0.113.4",
        // Secrets smuggled in through the record must never be logged.
        code: "BCDFGHJK",
        requestToken: "raw-request-token",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const output = String(spy.mock.calls[0][0]);
      expect(output).toContain("[LoginCodes]");
      expect(output).toContain('"type":"login_code_approved"');
      expect(output).toContain('"requestId":"req-1"');
      expect(output).toContain('"userId":"user-1"');
      expect(output).toContain('"reason":"attempts_exceeded"');
      expect(output).toContain('"ip":"203.0.113.4"');
      expect(output).not.toContain("BCDFGHJK");
      expect(output).not.toContain("raw-request-token");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("LoginCodesBuildRoutesOptions", () => {
  it("should pass the settings, the store and the JWT key through", () => {
    const config = makeConfig({ JWT_KEY: "hash-key" });
    const options = LoginCodesBuildRoutesOptions(config, store);
    expect(options.store).toBe(store);
    expect(options.enabled).toBe(true);
    expect(options.rotationSeconds).toBe(30);
    expect((options.hashKey as () => string)()).toBe("hash-key");
  });

  it("should return null for an anonymous approver", async () => {
    mockGetCredentialSession.mockResolvedValueOnce(null);
    const options = LoginCodesBuildRoutesOptions(makeConfig(), store);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await options.getApprovingUser({} as any)).toBeNull();
  });

  it("should accept a JWT session as a plain approver", async () => {
    mockGetCredentialSession.mockResolvedValueOnce({
      userId: "user-1",
      userName: "ann",
      role: "user",
      credentialType: "jwt",
    });
    const options = LoginCodesBuildRoutesOptions(makeConfig(), store);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const approver = await options.getApprovingUser({} as any);
    expect(approver).toEqual({ id: "user-1", name: "ann" });
    expect(approver.isApiToken).toBeUndefined();
  });

  it("should flag an API-key approver so the library answers 403", async () => {
    mockGetCredentialSession.mockResolvedValueOnce({
      userId: "user-1",
      userName: "ann",
      role: "user",
      credentialType: "apiKey",
    });
    const options = LoginCodesBuildRoutesOptions(makeConfig(), store);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const approver = await options.getApprovingUser({} as any);
    expect(approver).toEqual({ id: "user-1", name: "ann", isApiToken: true });
  });

  it("should resolve a user by id and return null when gone", async () => {
    const options = LoginCodesBuildRoutesOptions(makeConfig(), store);
    mockUsersDataGet.mockResolvedValueOnce(makeUser());
    expect(await options.getUserById("user-1")).toEqual({
      id: "user-1",
      name: "ann",
    });
    mockUsersDataGet.mockResolvedValueOnce(null);
    expect(await options.getUserById("gone")).toBeNull();
  });

  it("should issue a Planner session with the transport user shape", async () => {
    const options = LoginCodesBuildRoutesOptions(makeConfig(), store);
    mockUsersDataGet.mockResolvedValueOnce(makeUser({ role: "admin" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await options.issueSession({ id: "user-1", name: "ann" } as any, {} as any);
    expect(mockGenerateJWT).toHaveBeenCalledTimes(1);
    expect(session.token).toBe("fake-jwt");
    expect(session.user).toEqual({ id: "user-1", name: "ann", role: "admin" });
  });

  it("should fail closed when the approver no longer exists at redemption", async () => {
    const options = LoginCodesBuildRoutesOptions(makeConfig(), store);
    mockUsersDataGet.mockResolvedValueOnce(null);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options.issueSession({ id: "gone", name: "ann" } as any, {} as any),
    ).rejects.toThrow(/no longer exists/);
  });

  it("should verify the password against the live user", async () => {
    const options = LoginCodesBuildRoutesOptions(makeConfig(), store);
    const user = makeUser();
    mockUsersDataGet.mockResolvedValueOnce(user);
    mockCheckPassword.mockResolvedValueOnce(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await options.verifyPassword({ id: user.id, name: user.name } as any, "pw")).toBe(true);
    expect(mockCheckPassword).toHaveBeenCalledWith(user, "pw");

    mockUsersDataGet.mockResolvedValueOnce(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await options.verifyPassword({ id: "gone", name: "ann" } as any, "pw")).toBe(false);
  });
});
