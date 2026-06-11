import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { ViewsDataGetDashboard } from "./ViewsData";

export class ViewsRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== DASHBOARD VIEW ====================
    fastify.get<{
      Querystring: {
        projectId?: string;
        labels?: string;
      };
    }>("/dashboard", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const labels = req.query.labels
        ? req.query.labels.split(",").map((l) => l.trim())
        : undefined;
      const data = await ViewsDataGetDashboard({
        projectId: req.query.projectId,
        labels,
      });
      return res.status(200).send(data);
    });

    // ==================== NEXT VIEW (legacy, for backward compat) ====================
    fastify.get("/next", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const data = await ViewsDataGetDashboard();
      return res.status(200).send(data);
    });
  }
}
