import { FastifyInstance } from "fastify";
import type { RequestGenericInterface } from "fastify";
import { Config } from "../Config";
import { AuthGetUserSession } from "../users/Auth";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { isProjectVisible } from "../projects/ProjectVisibility";
import { TaskTemplatesGet } from "../tasktemplates/TaskTemplatesData";
import { validateLabelList } from "../tasks/TasksRoutes";
import { DbUtilsIsUniqueViolation } from "../utils/DbUtils";
import { NormalizePhraseInput } from "./DictationPhrases";
import {
  DictationPhraseRecord,
  DictationPhrasesAdd,
  DictationPhrasesCountForUser,
  DictationPhrasesDelete,
  DictationPhrasesListForUser,
  DictationPhrasesUpdate,
} from "./DictationPhrasesData";

interface PhraseView {
  id: string;
  phrase: string;
  projectId: string | null;
  templateId: string | null;
  labels: string[];
  dateCreated: string;
}

function toView(record: DictationPhraseRecord): PhraseView {
  return {
    id: record.id,
    phrase: record.phrase,
    projectId: record.projectId,
    templateId: record.templateId,
    labels: record.labels,
    dateCreated: record.dateCreated,
  };
}

/**
 * Per-user custom command phrases API. A phrase maps a spoken prefix to
 * exactly one project (create a task) or template (instantiate it). Phrases
 * are never logged.
 */
export class DictationPhrasesRoutes {
  constructor(private config: Config) {}

  private async resolveTarget(
    projectId: string | null,
    templateId: string | null,
    userSession: Awaited<ReturnType<typeof AuthGetUserSession>>,
  ): Promise<string | null> {
    if ((projectId && templateId) || (!projectId && !templateId)) {
      return "Invalid: exactly one of projectId or templateId";
    }
    if (projectId) {
      const project = await ProjectsDataGet(projectId);
      if (!project || !isProjectVisible(project, userSession)) {
        return "Project Not Found";
      }
      return null;
    }
    const template = await TaskTemplatesGet(templateId as string);
    if (!template) {
      return "Template Not Found";
    }
    const project = await ProjectsDataGet(template.projectId);
    if (!project || !isProjectVisible(project, userSession)) {
      return "Template Not Found";
    }
    return null;
  }

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const phrases = await DictationPhrasesListForUser(
        userSession.userId,
      );
      return res.status(200).send({ phrases: phrases.map(toView) });
    });

    interface PostBody extends RequestGenericInterface {
      Body: {
        phrase?: unknown;
        projectId?: unknown;
        templateId?: unknown;
        labels?: unknown;
      };
    }
    fastify.post<PostBody>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const normalized = NormalizePhraseInput(req.body?.phrase);
      if (!normalized) {
        return res.status(400).send({ error: "Invalid: phrase" });
      }
      const projectId =
        typeof req.body?.projectId === "string" && req.body.projectId.trim()
          ? req.body.projectId.trim()
          : null;
      const templateId =
        typeof req.body?.templateId === "string" && req.body.templateId.trim()
          ? req.body.templateId.trim()
          : null;
      const targetError = await this.resolveTarget(
        projectId,
        templateId,
        userSession,
      );
      if (targetError) {
        const status = targetError.endsWith("Not Found") ? 404 : 400;
        return res.status(status).send({ error: targetError });
      }
      let labels: string[];
      try {
        labels =
          req.body?.labels === undefined
            ? []
            : validateLabelList(req.body.labels);
      } catch (error) {
        return res
          .status(400)
          .send({ error: (error as Error).message });
      }
      const total = await DictationPhrasesCountForUser(
        userSession.userId,
      );
      if (total >= this.config.DICTATION_PHRASES_MAX) {
        return res.status(400).send({ error: "Phrases limit reached" });
      }
      try {
        const phrase = await DictationPhrasesAdd(
          userSession.userId,
          normalized,
          projectId,
          templateId,
          labels,
        );
        return res.status(201).send({ phrase: toView(phrase) });
      } catch (error) {
        if (DbUtilsIsUniqueViolation(error)) {
          return res
            .status(409)
            .send({ error: "This phrase already exists" });
        }
        throw error;
      }
    });

    interface PutBody extends RequestGenericInterface {
      Body: {
        phrase?: unknown;
        projectId?: unknown;
        templateId?: unknown;
        labels?: unknown;
      };
    }
    fastify.put<PutBody & { Params: { id: string } }>(
      "/:id",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(401).send({ error: "Access Denied" });
        }
        const normalized = NormalizePhraseInput(req.body?.phrase);
        if (!normalized) {
          return res.status(400).send({ error: "Invalid: phrase" });
        }
        const projectId =
          typeof req.body?.projectId === "string" && req.body.projectId.trim()
            ? req.body.projectId.trim()
            : null;
        const templateId =
          typeof req.body?.templateId === "string" &&
          req.body.templateId.trim()
            ? req.body.templateId.trim()
            : null;
        const targetError = await this.resolveTarget(
          projectId,
          templateId,
          userSession,
        );
        if (targetError) {
          const status = targetError.endsWith("Not Found") ? 404 : 400;
          return res.status(status).send({ error: targetError });
        }
        let labels: string[];
        try {
          labels =
            req.body?.labels === undefined
              ? []
              : validateLabelList(req.body.labels);
        } catch (error) {
          return res
            .status(400)
            .send({ error: (error as Error).message });
        }
        try {
          const phrase = await DictationPhrasesUpdate(
            userSession.userId,
            req.params.id,
            normalized,
            projectId,
            templateId,
            labels,
          );
          if (!phrase) {
            return res
              .status(404)
              .send({ error: "Phrase Not Found" });
          }
          return res.status(200).send({ phrase: toView(phrase) });
        } catch (error) {
          if (DbUtilsIsUniqueViolation(error)) {
            return res
              .status(409)
              .send({ error: "This phrase already exists" });
          }
          throw error;
        }
      },
    );

    fastify.delete<{ Params: { id: string } }>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const deleted = await DictationPhrasesDelete(
        userSession.userId,
        req.params.id,
      );
      if (!deleted) {
        return res.status(404).send({ error: "Phrase Not Found" });
      }
      return res.status(204).send();
    });
  }
}
