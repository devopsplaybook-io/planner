import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import { NotificationsRoutes } from "./NotificationsRoutes";
import { User } from "../model/User";
import { AuthGetUserSession } from "../users/Auth";
import { UsersDataGet, UsersDataSetNotificationDigest } from "../users/UsersData";
import { NotificationsIsEnabled } from "./Notifications";
import {
  NotificationsDataAddSubscription,
} from "./NotificationsData";

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
}));

jest.mock("./Notifications", () => ({
  NotificationsGetPublicKey: jest.fn(() => "public-key"),
  NotificationsIsEnabled: jest.fn(() => true),
}));

jest.mock("./NotificationsData", () => ({
  NotificationsDataAddSubscription: jest.fn(),
  NotificationsDataDeleteSubscription: jest.fn(),
}));

jest.mock("../users/UsersData", () => ({
  UsersDataGet: jest.fn(),
  UsersDataSetNotificationDigest: jest.fn(),
}));

describe("NotificationsRoutes preferences", () => {
  let app: FastifyInstance;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  beforeAll(async () => {
    app = Fastify();
    await new NotificationsRoutes().getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== GET PREFERENCES ====================
  it("should answer 401 when unauthenticated", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });

    const res = await app.inject({ method: "GET", url: "/preferences" });

    expect(res.statusCode).toBe(401);
    expect(UsersDataGet).not.toHaveBeenCalled();
  });

  it("should return the stored digest preference", async () => {
    const user = new User();
    user.notificationDigest = true;
    (UsersDataGet as jest.Mock).mockResolvedValue(user);

    const res = await app.inject({ method: "GET", url: "/preferences" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ digest: true, dictation: true });
    expect(UsersDataGet).toHaveBeenCalledWith("user-1");
  });

  it("should default the digest to false when the user is unknown", async () => {
    (UsersDataGet as jest.Mock).mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/preferences" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ digest: false, dictation: true });
  });

  // ==================== PUT PREFERENCES ====================
  it("should answer 401 when unauthenticated", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });

    const res = await app.inject({
      method: "PUT",
      url: "/preferences",
      payload: { digest: true },
    });

    expect(res.statusCode).toBe(401);
    expect(UsersDataSetNotificationDigest).not.toHaveBeenCalled();
  });

  it("should answer 400 when the digest is missing or not a boolean", async () => {
    const resMissing = await app.inject({
      method: "PUT",
      url: "/preferences",
      payload: {},
    });
    expect(resMissing.statusCode).toBe(400);

    const resString = await app.inject({
      method: "PUT",
      url: "/preferences",
      payload: { digest: "true" },
    });
    expect(resString.statusCode).toBe(400);

    expect(UsersDataSetNotificationDigest).not.toHaveBeenCalled();
  });

  it("should save the digest preference", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/preferences",
      payload: { digest: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ digest: true });
    expect(UsersDataSetNotificationDigest).toHaveBeenCalledWith(
      "user-1",
      true,
    );
  });
});

describe("NotificationsRoutes subscriptions", () => {
  let app: FastifyInstance;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  const validPayload = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "p256dh-key", auth: "auth-key" },
  };

  beforeAll(async () => {
    app = Fastify();
    await new NotificationsRoutes().getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (NotificationsIsEnabled as jest.Mock).mockReturnValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 401 when unauthenticated", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/subscriptions",
      payload: validPayload,
    });

    expect(res.statusCode).toBe(401);
    expect(NotificationsDataAddSubscription).not.toHaveBeenCalled();
  });

  it("should answer 400 when notifications are disabled", async () => {
    (NotificationsIsEnabled as jest.Mock).mockReturnValue(false);

    const res = await app.inject({
      method: "POST",
      url: "/subscriptions",
      payload: validPayload,
    });

    expect(res.statusCode).toBe(400);
    expect(NotificationsDataAddSubscription).not.toHaveBeenCalled();
  });

  it("should answer 400 when the endpoint or keys are missing", async () => {
    for (const payload of [
      {},
      { endpoint: validPayload.endpoint },
      { endpoint: validPayload.endpoint, keys: { p256dh: "x" } },
      { keys: validPayload.keys },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/subscriptions",
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(NotificationsDataAddSubscription).not.toHaveBeenCalled();
  });

  it("should reject malformed and non-public endpoints without storing them", async () => {
    for (const endpoint of [
      "not a url",
      "http://push.example.com/sub",
      "https://localhost/sub",
      "https://127.0.0.1/sub",
      "https://[::1]/sub",
      "https://user:pass@push.example.com/sub",
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/subscriptions",
        payload: { ...validPayload, endpoint },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe(
        "Invalid: endpoint (must be a public HTTPS URL)",
      );
    }
    expect(NotificationsDataAddSubscription).not.toHaveBeenCalled();
  });

  it("should store a valid HTTPS endpoint", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/subscriptions",
      payload: { ...validPayload, endpoint: `  ${validPayload.endpoint}  ` },
    });

    expect(res.statusCode).toBe(201);
    expect(NotificationsDataAddSubscription).toHaveBeenCalledWith(
      "user-1",
      validPayload.endpoint,
      validPayload.keys,
    );
  });
});
