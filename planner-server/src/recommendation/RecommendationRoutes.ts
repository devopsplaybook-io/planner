import { FastifyInstance } from "fastify";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import {
  RecommendationGenerateForUser,
  RecommendationGetCached,
} from "./Recommendation";

export class RecommendationRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // GET /api/recommendation — returns the cached recommendation for the current user
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
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

    // POST /api/recommendation/regenerate — regenerate for the current user
    fastify.post("/regenerate", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const userSession = await AuthGetUserSession(req);
      await RecommendationGenerateForUser(userSession.userId);
      const cached = await RecommendationGetCached(userSession.userId);
      return res.status(200).send(cached);
    });
  }
}
