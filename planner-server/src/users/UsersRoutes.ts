import { FastifyInstance, RequestGenericInterface } from "fastify";
import { User } from "../model/User";
import { AuthGenerateJWT, AuthGetUserSession, AuthMustBeAdmin } from "./Auth";
import {
  UserPasswordCheckPassword,
  UserPasswordSetPassword,
} from "./UserPassword";
import {
  UsersDataAdd,
  UsersDataDelete,
  UsersDataGet,
  UsersDataGetByName,
  UsersDataList,
  UsersDataUpdatePassword,
  UsersDataUpdateUser,
} from "./UsersData";

export class UsersRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== SESSION (Login) ====================
    interface PostSession extends RequestGenericInterface {
      Body: { name: string; password: string };
    }
    fastify.post<PostSession>("/session", async (req, res) => {
      // From token
      const userSession = await AuthGetUserSession(req);
      if (userSession.isAuthenticated) {
        const user = await UsersDataGet(userSession.userId);
        if (!user) {
          return res.status(403).send({ error: "Authentication Failed" });
        }
        return res.status(201).send({
          success: true,
          token: await AuthGenerateJWT(user),
          user: user.toTransportJson(),
        });
      }

      // From User/Pass
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      const user = await UsersDataGetByName(req.body.name);
      if (!user) {
        return res.status(403).send({ error: "Authentication Failed" });
      }
      if (await UserPasswordCheckPassword(user, req.body.password)) {
        return res.status(201).send({
          success: true,
          token: await AuthGenerateJWT(user),
          user: user.toTransportJson(),
        });
      }
      return res.status(403).send({ error: "Authentication Failed" });
    });

    // ==================== LIST USERS (Admin only) ====================
    fastify.get("/", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const users = await UsersDataList();
      return res.status(200).send(users.map((u) => u.toTransportJson()));
    });

    // ==================== USER PICKER (Authenticated users) ====================
    fastify.get("/picker", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const users = await UsersDataList();
      return res
        .status(200)
        .send(users.map((u) => ({ id: u.id, name: u.name })));
    });

    // ==================== CREATE USER ====================
    interface PostUser extends RequestGenericInterface {
      Body: { name: string; password: string; role?: string };
    }
    fastify.post<PostUser>("/", async (req, res) => {
      let isInitialized = true;
      if ((await UsersDataList()).length === 0) {
        isInitialized = false;
      }

      if (isInitialized) {
        try {
          await AuthMustBeAdmin(req, res);
        } catch {
          return;
        }
      }

      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      if (await UsersDataGetByName(req.body.name)) {
        return res.status(400).send({ error: "Username Already Exists" });
      }

      const newUser = new User();
      newUser.name = req.body.name;
      newUser.role = isInitialized
        ? req.body.role === "admin"
          ? "admin"
          : "user"
        : "admin";
      await UserPasswordSetPassword(newUser, req.body.password);
      await UsersDataAdd(newUser);
      return res.status(201).send({ user: newUser.toTransportJson() });
    });

    // ==================== CHANGE OWN PASSWORD ====================
    interface PutOwnPassword extends RequestGenericInterface {
      Body: { password: string; passwordOld: string };
    }
    fastify.put<PutOwnPassword>("/password", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const user = await UsersDataGet(userSession.userId);
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      if (!(await UserPasswordCheckPassword(user, req.body.passwordOld))) {
        return res.status(403).send({ error: "Old Password Wrong" });
      }
      await UserPasswordSetPassword(user, req.body.password);
      await UsersDataUpdatePassword(user);
      return res.status(201).send({});
    });

    // ==================== ADMIN: UPDATE USER ====================
    interface PutUser extends RequestGenericInterface {
      Params: { id: string };
      Body: { role?: string; password?: string };
    }
    fastify.put<PutUser>("/:id", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }

      const user = await UsersDataGet(req.params.id);
      if (!user) {
        return res.status(404).send({ error: "User Not Found" });
      }

      if (req.body.role) {
        user.role = req.body.role === "admin" ? "admin" : "user";
      }
      await UsersDataUpdateUser(user);

      if (req.body.password) {
        await UserPasswordSetPassword(user, req.body.password);
        await UsersDataUpdatePassword(user);
      }

      return res.status(201).send({ user: user.toTransportJson() });
    });

    // ==================== ADMIN: DELETE USER ====================
    interface DeleteUser extends RequestGenericInterface {
      Params: { id: string };
    }
    fastify.delete<DeleteUser>("/:id", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }

      const userSession = await AuthGetUserSession(req);
      if (userSession.userId === req.params.id) {
        return res.status(400).send({ error: "Cannot Delete Yourself" });
      }

      const user = await UsersDataGet(req.params.id);
      if (!user) {
        return res.status(404).send({ error: "User Not Found" });
      }

      // Check at least 1 admin remains
      if (user.role === "admin") {
        const admins = (await UsersDataList()).filter(
          (u) => u.role === "admin",
        );
        if (admins.length <= 1) {
          return res
            .status(400)
            .send({ error: "At least 1 admin must be defined" });
        }
      }

      await UsersDataDelete(req.params.id);
      return res.status(201).send({});
    });
  }
}
