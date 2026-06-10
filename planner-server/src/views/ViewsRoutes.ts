import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { ViewsDataGetNextTasks } from "./ViewsData";

export class ViewsRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== NEXT VIEW ====================
    fastify.get("/next", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const data = await ViewsDataGetNextTasks();
      return res.status(200).send(data);
    });
  }
}
