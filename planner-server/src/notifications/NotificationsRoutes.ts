import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { UsersDataGet, UsersDataSetNotificationDictation, UsersDataSetNotificationDigest } from "../users/UsersData";
import {
  NotificationsGetPublicKey,
  NotificationsIsEnabled,
} from "./Notifications";
import {
  NotificationsDataAddSubscription,
  NotificationsDataDeleteSubscription,
} from "./NotificationsData";
import { NotificationsEndpointNormalize } from "./NotificationsEndpoint";

export class NotificationsRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== CONFIG ====================
    fastify.get("/config", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
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
        return res.status(401).send({ error: "Access Denied" });
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
      const endpoint = NotificationsEndpointNormalize(req.body.endpoint);
      if (!endpoint) {
        return res
          .status(400)
          .send({ error: "Invalid: endpoint (must be a public HTTPS URL)" });
      }
      await NotificationsDataAddSubscription(userSession.userId, endpoint, {
        p256dh: req.body.keys.p256dh,
        auth: req.body.keys.auth,
      });
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
        return res.status(401).send({ error: "Access Denied" });
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

    // ==================== PREFERENCES ====================
    fastify.get("/preferences", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const user = await UsersDataGet(userSession.userId);
      return res.status(200).send({
        digest: !!user?.notificationDigest,
        dictation: user ? !!user.notificationDictation : true,
      });
    });

    interface PutPreferences extends RequestGenericInterface {
      Body: {
        digest?: boolean;
        dictation?: boolean;
      };
    }
    fastify.put<PutPreferences>("/preferences", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const digest = req.body?.digest;
      const dictation = req.body?.dictation;
      if (typeof digest !== "boolean" && typeof dictation !== "boolean") {
        return res
          .status(400)
          .send({ error: "Missing: digest or dictation (boolean)" });
      }
      const updated: { digest?: boolean; dictation?: boolean } = {};
      if (typeof digest === "boolean") {
        await UsersDataSetNotificationDigest(userSession.userId, digest);
        updated.digest = digest;
      }
      if (typeof dictation === "boolean") {
        await UsersDataSetNotificationDictation(
          userSession.userId,
          dictation,
        );
        updated.dictation = dictation;
      }
      return res.status(200).send(updated);
    });
  }
}
