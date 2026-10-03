import { FastifyInstance } from "fastify";
import {
  AuthGetUserSession,
  AuthMustBeAuthenticated,
  AuthRateLimitKey,
} from "../users/Auth";
import {
  RecommendationGetCached,
  RecommendationRegenerateForUser,
} from "./Recommendation";

export class RecommendationRoutes {
  constructor(private rateLimitRegenerateMax: number = 5) {}

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // GET /api/recommendation — returns the cached recommendation for the current user
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const cached = await RecommendationGetCached(userSession.userId);
      if (!cached) {
        return res.status(200).send({
          generatedAt: null,
          analysis: null,
          recommendations: null,
          tasks: [],
        });
      }
      return res.status(200).send(cached);
    });

    // POST /api/recommendation/regenerate — start a background regeneration
    // for the current user (single-flight). The client polls GET / for the
    // result so the LLM call never blocks the request.
    fastify.post(
      "/regenerate",
      {
        config: {
          rateLimit: {
            max: this.rateLimitRegenerateMax,
            timeWindow: "1 hour",
            keyGenerator: (req) => AuthRateLimitKey(req),
          },
        },
      },
      async (req, res) => {
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const userSession = await AuthGetUserSession(req);
        const started = RecommendationRegenerateForUser(userSession.userId);
        return res.status(202).send({ started });
      },
    );
  }
}
