import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { LabelListFilters, LabelsDataList } from "./LabelsData";

export class LabelsRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== LIST (label autocomplete source) ====================
    fastify.get<{ Querystring: { q?: string } }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const filters: LabelListFilters = {
        q: req.query.q?.trim() || undefined,
      };
      if (userSession.role !== "admin") {
        filters.visibleTo = { userId: userSession.userId };
      }
      const labels = await LabelsDataList(filters);
      return res.status(200).send(labels);
    });
  }
}
