import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import {
  NotificationsGetPublicKey,
  NotificationsIsEnabled,
} from "./Notifications";
import {
  NotificationsDataAddSubscription,
  NotificationsDataDeleteSubscription,
} from "./NotificationsData";

export class NotificationsRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== CONFIG ====================
    fastify.get("/config", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      return res.status(200).send({
        enabled: NotificationsIsEnabled(),
        publicKey: NotificationsGetPublicKey() || null,
      });
    });

    // ==================== SUBSCRIBE ====================
    interface PostSubscription extends RequestGenericInterface {
      Body: {
        endpoint: string;
        keys?: { p256dh?: string; auth?: string };
      };
    }
    fastify.post<PostSubscription>("/subscriptions", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!NotificationsIsEnabled()) {
        return res
          .status(400)
          .send({ error: "Notifications are not enabled on the server" });
      }
      if (
        !req.body?.endpoint ||
        !req.body?.keys?.p256dh ||
        !req.body?.keys?.auth
      ) {
        return res.status(400).send({ error: "Missing: endpoint or keys" });
      }
      await NotificationsDataAddSubscription(
        userSession.userId,
        req.body.endpoint,
        {
          p256dh: req.body.keys.p256dh,
          auth: req.body.keys.auth,
        },
      );
      return res.status(201).send({});
    });

    // ==================== UNSUBSCRIBE ====================
    interface DeleteSubscription extends RequestGenericInterface {
      Body: {
        endpoint: string;
      };
    }
    fastify.delete<DeleteSubscription>("/subscriptions", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body?.endpoint) {
        return res.status(400).send({ error: "Missing: endpoint" });
      }
      await NotificationsDataDeleteSubscription(
        userSession.userId,
        req.body.endpoint,
      );
      return res.status(201).send({});
    });
  }
}
