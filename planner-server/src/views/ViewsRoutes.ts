import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { DashboardFilters, ViewsDataGetDashboard } from "./ViewsData";
import { parseProjectIds } from "../tasks/TasksRoutes";

export class ViewsRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== DASHBOARD VIEW ====================
    fastify.get<{
      Querystring: {
        projectId?: string;
        projectIds?: string;
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
      const filters: DashboardFilters = {
        projectId: req.query.projectId,
        projectIds: parseProjectIds(req.query.projectIds),
        labels,
      };
      if (userSession.role !== "admin") {
        filters.visibleTo = { userId: userSession.userId };
      }
      const data = await ViewsDataGetDashboard(filters);
      return res.status(200).send(data);
    });

    // ==================== NEXT VIEW (legacy, for backward compat) ====================
    fastify.get("/next", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const filters: DashboardFilters =
        userSession.role !== "admin"
          ? { visibleTo: { userId: userSession.userId } }
          : {};
      const data = await ViewsDataGetDashboard(filters);
      return res.status(200).send(data);
    });
  }
}
