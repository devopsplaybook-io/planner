import { FastifyInstance } from "fastify";
import type { RequestGenericInterface } from "fastify";
import { Config } from "../Config";
import { AuthGetUserSession } from "../users/Auth";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { isProjectVisible } from "../projects/ProjectVisibility";
import { DbUtilsIsUniqueViolation } from "../utils/DbUtils";
import {
  DictationVocabularyAdd,
  DictationVocabularyCountForScope,
  DictationVocabularyCountForUser,
  DictationVocabularyDelete,
  DictationVocabularyListForUser,
  DictationVocabularyReplaceScope,
  NormalizeVocabularyTerm,
} from "./DictationVocabularyData";

/**
 * Per-user vocabulary API. Every term belongs to the caller: project-scoped
 * terms additionally require the project to be visible (admins bypass).
 * Terms are never logged.
 */
export class DictationVocabularyRoutes {
  constructor(private config: Config) {}

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const terms = await DictationVocabularyListForUser(
        userSession.userId,
      );
      return res.status(200).send({ terms });
    });

    interface PostBody extends RequestGenericInterface {
      Body: { term?: string; projectId?: string | null };
    }
    fastify.post<PostBody>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const projectId = req.body?.projectId || null;
      if (projectId) {
        const project = await ProjectsDataGet(projectId);
        if (!project || !isProjectVisible(project, userSession)) {
          return res.status(404).send({ error: "Project Not Found" });
        }
      }
      if (typeof req.body?.term !== "string" || !req.body.term.trim()) {
        return res.status(400).send({ error: "Missing: term" });
      }
      const total = await DictationVocabularyCountForUser(
        userSession.userId,
      );
      if (total >= this.config.DICTATION_VOCABULARY_MAX) {
        return res.status(400).send({
          error: "Vocabulary limit reached",
        });
      }
      try {
        const term = await DictationVocabularyAdd(
          userSession.userId,
          projectId,
          req.body.term,
        );
        return res.status(201).send({ term });
      } catch (error) {
        if (DbUtilsIsUniqueViolation(error)) {
          return res
            .status(409)
            .send({ error: "This term is already in the vocabulary" });
        }
        throw error;
      }
    });

    interface PutBody extends RequestGenericInterface {
      Body: { projectId?: string | null; terms?: unknown };
    }
    fastify.put<PutBody>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const projectId = req.body?.projectId || null;
      if (projectId) {
        const project = await ProjectsDataGet(projectId);
        if (!project || !isProjectVisible(project, userSession)) {
          return res.status(404).send({ error: "Project Not Found" });
        }
      }
      if (!Array.isArray(req.body?.terms)) {
        return res.status(400).send({ error: "Missing: terms (array)" });
      }
      const terms = req.body.terms;
      const existingScope = await DictationVocabularyCountForScope(
        userSession.userId,
        projectId,
      );
      const total = await DictationVocabularyCountForUser(
        userSession.userId,
      );
      // The replace is bounded by the number of valid, deduped terms
      const uniqueTerms = new Set<string>();
      for (const raw of terms) {
        const normalized = NormalizeVocabularyTerm(raw);
        if (normalized) {
          uniqueTerms.add(normalized.normalizedTerm);
        }
      }
      const projected =
        total - existingScope + uniqueTerms.size >
        this.config.DICTATION_VOCABULARY_MAX;
      if (projected) {
        return res.status(400).send({ error: "Vocabulary limit reached" });
      }
      const saved = await DictationVocabularyReplaceScope(
        userSession.userId,
        projectId,
        terms,
      );
      return res.status(200).send({ terms: saved });
    });

    fastify.delete<{ Params: { id: string } }>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const deleted = await DictationVocabularyDelete(
        userSession.userId,
        req.params.id,
      );
      if (!deleted) {
        return res.status(404).send({ error: "Vocabulary Term Not Found" });
      }
      return res.status(204).send();
    });
  }
}
