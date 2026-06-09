import { FastifyInstance, RequestGenericInterface } from "fastify";
import { Project } from "../model/Project";
import { AuthGetUserSession, AuthMustBeAuthenticated } from "../users/Auth";
import {
  ProjectsDataAdd,
  ProjectsDataDelete,
  ProjectsDataGet,
  ProjectsDataList,
  ProjectsDataUpdate,
} from "./ProjectsData";

export class ProjectsRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== LIST ====================
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const projects = await ProjectsDataList();
      return res.status(200).send(projects.map((p) => p.toTransportJson()));
    });

    // ==================== GET BY ID ====================
    fastify.get<{ Params: { id: string } }>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const project = await ProjectsDataGet(req.params.id);
      if (!project) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      return res.status(200).send(project.toTransportJson());
    });

    // ==================== CREATE ====================
    interface PostProject extends RequestGenericInterface {
      Body: { name: string; description?: string; statuses?: string[] };
    }
    fastify.post<PostProject>("/", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      const project = new Project();
      project.name = req.body.name;
      project.description = req.body.description || "";
      if (req.body.statuses && req.body.statuses.length >= 2) {
        if (!req.body.statuses.includes("Done")) {
          return res.status(400).send({ error: '"Done" status is mandatory' });
        }
        project.statuses = req.body.statuses;
      }
      await ProjectsDataAdd(project);
      return res.status(201).send(project.toTransportJson());
    });

    // ==================== UPDATE ====================
    interface PutProject extends RequestGenericInterface {
      Params: { id: string };
      Body: { name?: string; description?: string; statuses?: string[] };
    }
    fastify.put<PutProject>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const project = await ProjectsDataGet(req.params.id);
      if (!project) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      if (req.body.name) {
        project.name = req.body.name;
      }
      if (req.body.description !== undefined) {
        project.description = req.body.description;
      }
      if (req.body.statuses) {
        if (
          req.body.statuses.length >= 2 &&
          !req.body.statuses.includes("Done")
        ) {
          return res.status(400).send({ error: '"Done" status is mandatory' });
        }
        project.statuses = req.body.statuses;
      }
      await ProjectsDataUpdate(project);
      return res.status(201).send(project.toTransportJson());
    });

    // ==================== DELETE ====================
    fastify.delete<{ Params: { id: string } }>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const project = await ProjectsDataGet(req.params.id);
      if (!project) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      if (project.isDefault) {
        return res.status(400).send({ error: "Cannot delete default project" });
      }
      await ProjectsDataDelete(req.params.id);
      return res.status(201).send({});
    });
  }
}
