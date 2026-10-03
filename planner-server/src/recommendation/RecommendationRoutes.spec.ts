/* eslint-disable @typescript-eslint/no-explicit-any */
import Fastify from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { FastifyInstance } from "fastify";
import { RecommendationRoutes } from "./RecommendationRoutes";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import {
  RecommendationGetCached,
  RecommendationRegenerateForUser,
} from "./Recommendation";

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
  AuthRateLimitKey: jest.fn(() => "user:test"),
}));

jest.mock("./Recommendation", () => ({
  RecommendationGetCached: jest.fn(),
  RecommendationRegenerateForUser: jest.fn(),
}));

const userSession = {
  isAuthenticated: true,
  userId: "user-1",
  userName: "User",
  role: "user" as const,
};

describe("RecommendationRoutes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(fastifyRateLimit, { global: false });
    await new RecommendationRoutes(5).getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (AuthMustBeAuthenticated as jest.Mock).mockResolvedValue(undefined);
    (RecommendationRegenerateForUser as jest.Mock).mockReturnValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 401 for the cached recommendation without a session", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(401);
    expect(RecommendationGetCached).not.toHaveBeenCalled();
  });

  it("should return an empty shape when nothing is cached", async () => {
    (RecommendationGetCached as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      generatedAt: null,
      analysis: null,
      recommendations: null,
      tasks: [],
    });
  });

  it("should return the cached recommendation for the current user", async () => {
    const cached = {
      generatedAt: "2026-09-01T00:00:00.000Z",
      analysis: "analysis",
      recommendations: "recommendations",
      tasks: [{ id: "t1" }],
    };
    (RecommendationGetCached as jest.Mock).mockResolvedValue(cached);

    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(cached);
    expect(RecommendationGetCached).toHaveBeenCalledWith("user-1");
  });

  it("should answer 401 for regenerate without a session", async () => {
    (AuthMustBeAuthenticated as jest.Mock).mockImplementation(
      async (_req: any, res: any) => {
        res.status(401).send({ error: "Access Denied" });
        throw new Error("Access Denied");
      },
    );
    const res = await app.inject({ method: "POST", url: "/regenerate" });
    expect(res.statusCode).toBe(401);
    expect(RecommendationRegenerateForUser).not.toHaveBeenCalled();
  });

  it("should accept regeneration asynchronously with 202 and report started", async () => {
    (RecommendationRegenerateForUser as jest.Mock).mockReturnValue(true);
    const res = await app.inject({ method: "POST", url: "/regenerate" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ started: true });
    expect(RecommendationRegenerateForUser).toHaveBeenCalledWith("user-1");
  });

  it("should report started=false when a regeneration is already in flight", async () => {
    (RecommendationRegenerateForUser as jest.Mock).mockReturnValue(false);
    const res = await app.inject({ method: "POST", url: "/regenerate" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ started: false });
  });
});

describe("RecommendationRoutes rate limiting", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(fastifyRateLimit, { global: false });
    await new RecommendationRoutes(2).getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (AuthMustBeAuthenticated as jest.Mock).mockResolvedValue(undefined);
    (RecommendationRegenerateForUser as jest.Mock).mockReturnValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 429 once the hourly regenerate budget is exhausted", async () => {
    expect((await app.inject({ method: "POST", url: "/regenerate" })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: "/regenerate" })).statusCode).toBe(202);
    const blocked = await app.inject({ method: "POST", url: "/regenerate" });
    expect(blocked.statusCode).toBe(429);
    expect(RecommendationRegenerateForUser).toHaveBeenCalledTimes(2);
  });
});
