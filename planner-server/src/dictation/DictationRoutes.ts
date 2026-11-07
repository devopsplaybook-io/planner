import { FastifyInstance } from "fastify";
import type { RequestGenericInterface } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs-extra";
import * as path from "path";
import { Config } from "../Config";
import {
  AuthGetUserSession,
  AuthMustBeAuthenticated,
  AuthRateLimitKey,
} from "../users/Auth";
import {
  UsersDataGet,
  UsersDataSetDictationKeepAudio,
  UsersDataSetDictationTargetLanguage,
} from "../users/UsersData";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { isProjectVisible } from "../projects/ProjectVisibility";
import { DbUtilsIsUniqueViolation } from "../utils/DbUtils";
import {
  DictationGetInFlightJobId,
  DictationGetJob,
  DictationGetRecentJobs,
  DictationStartJob,
  DictationWaitForJob,
} from "./Dictation";
import {
  DictationDataGetByClientId,
  DictationDataGetForUser,
  DictationJobRecord,
  DictationJobSource,
} from "./DictationData";
import { DictationVocabularyResolveForPrompt } from "./DictationVocabularyData";
import { ComposeHotwordPrompt } from "./DictationHotwords";
import {
  BuildActionPreviews,
  LoadDictationResolutionContext,
} from "./DictationResolution";
import {
  ApplyDictationActions,
  NormalizeActionSelections,
  ParseStoredActions,
  UndoDictationActions,
} from "./DictationActionApply";
import { DictationActionDataListForJob } from "./DictationActionData";
import {
  DICTATION_ASK_QUESTION_MAX_LENGTH,
  DictationAskQuestion,
} from "./DictationAsk";

/**
 * Resolves the STT language for an upload: the language field sent by the
 * client takes precedence over the server default; "auto" (or an empty
 * value) means engine-side language detection. Pure so it can be
 * unit-tested.
 */
export function NormalizeLanguage(
  requested: string | undefined,
  fallback: string,
): string | null {
  const value = (requested || "").trim() || fallback;
  if (!value || value === "auto") {
    return null;
  }
  return value;
}

const RECENT_JOBS_DEFAULT_LIMIT = 20;
const RECENT_JOBS_MAX_LIMIT = 50;
const TRANSLATION_OFF_VALUES = new Set(["", "none", "off"]);

export class DictationRoutes {
  constructor(private config: Config) {}

  /** Validates a translation target against DICTATION_LANGUAGES. */
  private normalizeTargetLanguage(value: unknown): {
    valid: boolean;
    value: string | null;
  } {
    if (value === null || value === undefined) {
      return { valid: true, value: null };
    }
    if (typeof value !== "string") {
      return { valid: false, value: null };
    }
    const code = value.trim().toLowerCase();
    if (TRANSLATION_OFF_VALUES.has(code)) {
      return { valid: true, value: null };
    }
    if (this.config.DICTATION_LANGUAGES.includes(code)) {
      return { valid: true, value: code };
    }
    return { valid: false, value: null };
  }

  /**
   * Resolves the per-dictation translation target: an explicit value wins
   * (an explicit empty/off value disables the stored preference), otherwise
   * the user's stored preference applies.
   */
  private async resolveTargetLanguage(
    requested: string | undefined,
    userId: string,
  ): Promise<{ valid: boolean; value: string | null }> {
    if (requested !== undefined) {
      return this.normalizeTargetLanguage(requested);
    }
    const user = await UsersDataGet(userId);
    return this.normalizeTargetLanguage(user?.dictationTargetLanguage ?? null);
  }

  /** Owned, non-expired job record; null makes the route answer 404. */
  private async getOwnedJob(
    userId: string,
    jobId: string,
  ): Promise<DictationJobRecord | null> {
    const record = await DictationDataGetForUser(userId, jobId);
    if (!record || Date.parse(record.expiresAt) < Date.now()) {
      return null;
    }
    return record;
  }

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // POST /api/dictation — upload a recorded audio clip and start a
    // background dictation job for the current user (single-flight).
    // The client polls/long-polls GET /:jobId for the staged result.
    fastify.post(
      "/",
      {
        config: {
          rateLimit: {
            max: this.config.RATE_LIMIT_DICTATION_MAX,
            timeWindow: "1 hour",
            keyGenerator: (req) => AuthRateLimitKey(req),
          },
        },
      },
      async (req, res) => {
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const userSession = await AuthGetUserSession(req);

        // Fail fast instead of accepting a job that can never be processed
        if (
          !this.config.DICTATION_ENABLED ||
          !this.config.IsDictationSttConfigured()
        ) {
          return res.status(404).send({ error: "Dictation Not Available" });
        }

        const inFlightJobId = await DictationGetInFlightJobId(
          userSession.userId,
        );
        if (inFlightJobId) {
          return res.status(409).send({
            error: "A dictation job is already in progress",
            jobId: inFlightJobId,
          });
        }

        const audioDir = path.join(this.config.TMP_DIR, "dictation");
        await fs.ensureDir(audioDir);
        const audioPath = path.join(audioDir, `${uuidv4()}.audio`);
        const maxBytes = this.config.DICTATION_MAX_UPLOAD_MB * 1024 * 1024;
        const fields: Record<string, string> = {};
        let audio: MultipartFile | null = null;
        let audioSize = 0;
        let tooLarge = false;
        let writeError = false;

        try {
          // The size limit is enforced while streaming: the multipart stream
          // stops at maxBytes (truncated) and the chunk counter aborts early
          // for engines that keep delivering data.
          for await (const part of req.parts({
            limits: { fileSize: maxBytes },
          })) {
            if (part.type === "field") {
              fields[part.fieldname] = String(part.value ?? "");
              continue;
            }
            if (audio) {
              // Only the first file is used; drain the others
              part.file.resume();
              continue;
            }
            audio = part;
            if (!part.mimetype.startsWith("audio/")) {
              part.file.resume();
              continue;
            }
            const writeStream = fs.createWriteStream(audioPath);
            part.file.on("data", (chunk: Buffer) => {
              audioSize += chunk.length;
              if (audioSize > maxBytes && !tooLarge) {
                tooLarge = true;
                part.file.destroy();
              }
            });
            await new Promise<void>((resolve) => {
              part.file.pipe(writeStream);
              part.file.on("error", () => {
                writeError = true;
                resolve();
              });
              writeStream.on("error", () => {
                writeError = true;
                resolve();
              });
              writeStream.on("finish", () => resolve());
              part.file.on("close", () => resolve());
            });
          }
        } catch (error) {
          await fs.remove(audioPath).catch(() => undefined);
          if (
            (error as { code?: string })?.code === "FST_REQ_FILE_TOO_LARGE"
          ) {
            return res.status(413).send({ error: "Audio file too large" });
          }
          return res.status(400).send({ error: "Invalid multipart upload" });
        }

        if (tooLarge || audio?.file.truncated || audioSize > maxBytes) {
          await fs.remove(audioPath).catch(() => undefined);
          return res.status(413).send({ error: "Audio file too large" });
        }
        if (writeError) {
          await fs.remove(audioPath).catch(() => undefined);
          return res.status(400).send({ error: "Invalid audio upload" });
        }
        if (!audio) {
          await fs.remove(audioPath).catch(() => undefined);
          return res.status(400).send({ error: "No audio file uploaded" });
        }
        if (!audio.mimetype.startsWith("audio/")) {
          await fs.remove(audioPath).catch(() => undefined);
          return res
            .status(400)
            .send({ error: "Invalid: an audio file is expected" });
        }

        const language = NormalizeLanguage(
          fields.language,
          this.config.DICTATION_LANGUAGE,
        );

        // Optional project scope: project vocabulary biases the engine and
        // the project must be visible to the caller.
        const projectId = (fields.projectId || "").trim() || null;
        if (projectId) {
          const project = await ProjectsDataGet(projectId);
          if (!project || !isProjectVisible(project, userSession)) {
            await fs.remove(audioPath).catch(() => undefined);
            return res.status(404).send({ error: "Project Not Found" });
          }
        }

        // Translation target: explicit field > stored preference > off
        const target = await this.resolveTargetLanguage(
          fields.targetLanguage,
          userSession.userId,
        );
        if (!target.valid) {
          await fs.remove(audioPath).catch(() => undefined);
          return res.status(400).send({ error: "Invalid: targetLanguage" });
        }

        // Vocabulary prompt: never persisted, never logged
        const vocabularyTerms = await DictationVocabularyResolveForPrompt(
          userSession.userId,
          projectId,
          this.config.DICTATION_HOTWORDS_MAX,
        );
        const hotwordPrompt = ComposeHotwordPrompt(
          [],
          vocabularyTerms,
          this.config.DICTATION_HOTWORDS_MAX,
        );

        // Inline jobs are tagged so inline usage and latency can be measured
        // separately from the modal; quick captures (and offline queue
        // retries) are tagged too. Import has its own long-form route.
        if (fields.source === "import") {
          await fs.remove(audioPath).catch(() => undefined);
          return res
            .status(400)
            .send({ error: "Invalid: source (use /api/dictation/import)" });
        }
        const source: DictationJobSource =
          fields.source === "inline"
            ? "inline"
            : fields.source === "quick_capture"
              ? "quick_capture"
              : "dictation";
        const clientId =
          typeof fields.clientId === "string"
            ? fields.clientId.trim().slice(0, 100) || null
            : null;
        if (clientId) {
          const existing = await DictationDataGetByClientId(
            userSession.userId,
            clientId,
          );
          if (existing) {
            await fs.remove(audioPath).catch(() => undefined);
            return res.status(202).send({ jobId: existing.id });
          }
        }
        let jobId: string;
        try {
          jobId = await DictationStartJob(
            userSession.userId,
            audioPath,
            audio.mimetype,
            language,
            source,
            {
              prompt: hotwordPrompt,
              hotwordsCount: vocabularyTerms.length,
              targetLanguage: target.value,
              clientId,
            },
          );
        } catch (error) {
          // Two concurrent retries of the same clientId: the unique index
          // decides, and the loser returns the winner's job.
          if (clientId && DbUtilsIsUniqueViolation(error)) {
            await fs.remove(audioPath).catch(() => undefined);
            const existing = await DictationDataGetByClientId(
              userSession.userId,
              clientId,
            );
            if (existing) {
              return res.status(202).send({ jobId: existing.id });
            }
          }
          throw error;
        }
        return res.status(202).send({ jobId });
      },
    );

    interface AskBody extends RequestGenericInterface {
      Body: { question?: unknown; projectId?: unknown };
    }
    // POST /api/dictation/ask — read-only question about the caller's
    // visible data. Never writes; deterministic answers with optional LLM
    // rephrasing behind a strict timeout.
    fastify.post<AskBody>(
      "/ask",
      {
        config: {
          rateLimit: {
            max: this.config.RATE_LIMIT_DICTATION_ASK_MAX,
            timeWindow: "1 hour",
            keyGenerator: (req) => AuthRateLimitKey(req),
          },
        },
      },
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(401).send({ error: "Access Denied" });
        }
        if (!this.config.DICTATION_ENABLED) {
          return res.status(404).send({ error: "Dictation Not Available" });
        }
        const question =
          typeof req.body?.question === "string"
            ? req.body.question.trim()
            : "";
        if (!question) {
          return res.status(400).send({ error: "Missing: question" });
        }
        if (question.length > DICTATION_ASK_QUESTION_MAX_LENGTH) {
          return res.status(400).send({
            error: `Invalid: question (max ${DICTATION_ASK_QUESTION_MAX_LENGTH} characters)`,
          });
        }
        const projectId =
          typeof req.body?.projectId === "string" && req.body.projectId.trim()
            ? req.body.projectId.trim()
            : undefined;
        if (projectId) {
          const project = await ProjectsDataGet(projectId);
          if (!project || !isProjectVisible(project, userSession)) {
            return res.status(404).send({ error: "Project Not Found" });
          }
        }
        const answer = await DictationAskQuestion(
          this.config,
          userSession,
          question,
          projectId,
        );
        return res.status(200).send(answer);
      },
    );

    // GET/PUT /api/dictation/preferences — the user's translation target
    fastify.get("/preferences", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const user = await UsersDataGet(userSession.userId);
      return res.status(200).send({
        targetLanguage: user?.dictationTargetLanguage ?? null,
        keepAudio: user ? !!user.dictationKeepAudio : false,
      });
    });

    interface PutPreferences extends RequestGenericInterface {
      Body: { targetLanguage?: string | null; keepAudio?: boolean };
    }
    fastify.put<PutPreferences>("/preferences", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const hasLanguage = req.body?.targetLanguage !== undefined;
      const hasKeepAudio = typeof req.body?.keepAudio === "boolean";
      if (!hasLanguage && !hasKeepAudio) {
        return res
          .status(400)
          .send({ error: "Missing: targetLanguage or keepAudio" });
      }
      const response: { targetLanguage?: string | null; keepAudio?: boolean } =
        {};
      if (hasLanguage) {
        const normalized = this.normalizeTargetLanguage(
          req.body?.targetLanguage,
        );
        if (!normalized.valid) {
          return res
            .status(400)
            .send({ error: "Invalid: targetLanguage (unsupported language)" });
        }
        await UsersDataSetDictationTargetLanguage(
          userSession.userId,
          normalized.value,
        );
        response.targetLanguage = normalized.value;
      }
      if (hasKeepAudio) {
        await UsersDataSetDictationKeepAudio(
          userSession.userId,
          req.body.keepAudio as boolean,
        );
        response.keepAudio = req.body.keepAudio;
      }
      return res.status(200).send(response);
    });

    // GET /api/dictation/jobs — recent jobs of the caller (bounded previews)
    fastify.get<{ Querystring: { limit?: string; source?: string } }>(
      "/jobs",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(401).send({ error: "Access Denied" });
        }
        const parsedLimit = parseInt(req.query.limit || "", 10);
        const limit = Number.isFinite(parsedLimit)
          ? Math.max(1, Math.min(RECENT_JOBS_MAX_LIMIT, parsedLimit))
          : RECENT_JOBS_DEFAULT_LIMIT;
        const source: DictationJobSource =
          req.query.source === "voice_comment" ? "voice_comment" : "dictation";
        const jobs = await DictationGetRecentJobs(
          userSession.userId,
          limit,
          source,
        );
        return res.status(200).send({ jobs });
      },
    );

    // POST /api/dictation/:jobId/actions/preview — resolve every stored
    // proposal against the caller-visible data. Read-only: nothing is
    // written and each card is resolved independently.
    fastify.post<{ Params: { jobId: string } }>(
      "/:jobId/actions/preview",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(401).send({ error: "Access Denied" });
        }
        const record = await this.getOwnedJob(
          userSession.userId,
          req.params.jobId,
        );
        if (!record) {
          return res.status(404).send({ error: "Dictation Job Not Found" });
        }
        const actions = ParseStoredActions(record);
        const context = await LoadDictationResolutionContext(userSession);
        return res.status(200).send({
          jobId: record.id,
          actions: BuildActionPreviews(actions, context),
        });
      },
    );

    // GET /api/dictation/:jobId/actions — applied batches, grouped by the
    // client requestId so the dialog can restore the Undo button after a
    // reload. Undo snapshots are never exposed.
    fastify.get<{ Params: { jobId: string } }>(
      "/:jobId/actions",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(401).send({ error: "Access Denied" });
        }
        const record = await this.getOwnedJob(
          userSession.userId,
          req.params.jobId,
        );
        if (!record) {
          return res.status(404).send({ error: "Dictation Job Not Found" });
        }
        const rows = await DictationActionDataListForJob(record.id);
        const batches = new Map<
          string,
          {
            requestId: string;
            dateCreated: string;
            actions: {
              index: number;
              type: string;
              status: string;
              targetId: string | null;
              targetType: string | null;
              undoneAt: string | null;
              error: string | null;
            }[];
          }
        >();
        for (const row of rows) {
          let batch = batches.get(row.requestId);
          if (!batch) {
            batch = {
              requestId: row.requestId,
              dateCreated: row.dateCreated,
              actions: [],
            };
            batches.set(row.requestId, batch);
          }
          batch.actions.push({
            index: row.actionIndex,
            type: row.type,
            status: row.status,
            targetId: row.targetId,
            targetType: row.targetType,
            undoneAt: row.undoneAt,
            error: row.error,
          });
        }
        return res.status(200).send({
          jobId: record.id,
          batches: [...batches.values()],
        });
      },
    );

    interface ApplyActionsBody extends RequestGenericInterface {
      Body: { requestId?: unknown; selections?: unknown };
    }
    // POST /api/dictation/:jobId/actions/apply — applies the selected
    // proposals server-side with the caller's permissions. Idempotent per
    // (requestId, action index); one failure never rolls back the batch.
    fastify.post<{ Params: { jobId: string } } & ApplyActionsBody>(
      "/:jobId/actions/apply",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(401).send({ error: "Access Denied" });
        }
        const record = await this.getOwnedJob(
          userSession.userId,
          req.params.jobId,
        );
        if (!record) {
          return res.status(404).send({ error: "Dictation Job Not Found" });
        }
        const requestId =
          typeof req.body?.requestId === "string"
            ? req.body.requestId.trim()
            : "";
        const selections = NormalizeActionSelections(req.body?.selections);
        if (selections.length === 0) {
          return res.status(400).send({ error: "Missing: selections" });
        }
        const outcome = await ApplyDictationActions(
          userSession,
          record,
          requestId || uuidv4(),
          selections,
        );
        return res.status(200).send(outcome);
      },
    );

    interface UndoActionsBody extends RequestGenericInterface {
      Body: { requestId?: unknown };
    }
    // POST /api/dictation/:jobId/actions/undo — best-effort reversal of one
    // applied batch, newest action first.
    fastify.post<{ Params: { jobId: string } } & UndoActionsBody>(
      "/:jobId/actions/undo",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(401).send({ error: "Access Denied" });
        }
        const record = await this.getOwnedJob(
          userSession.userId,
          req.params.jobId,
        );
        if (!record) {
          return res.status(404).send({ error: "Dictation Job Not Found" });
        }
        const requestId =
          typeof req.body?.requestId === "string"
            ? req.body.requestId.trim()
            : "";
        if (!requestId) {
          return res.status(400).send({ error: "Missing: requestId" });
        }
        const outcome = await UndoDictationActions(
          userSession,
          record.id,
          requestId,
        );
        return res.status(200).send(outcome);
      },
    );

    // GET /api/dictation/:jobId — read a job, or long-poll it with
    // `?wait=1&since=<revision>` until a newer revision is persisted. Users
    // can only see their own jobs.
    fastify.get<{
      Params: { jobId: string };
      Querystring: { wait?: string; since?: string };
    }>("/:jobId", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const wait = req.query.wait === "1" || req.query.wait === "true";
      const sinceRevision = Number.parseInt(req.query.since || "0", 10) || 0;
      const job = wait
        ? await DictationWaitForJob(
            userSession.userId,
            req.params.jobId,
            sinceRevision,
          )
        : await DictationGetJob(userSession.userId, req.params.jobId);
      if (!job) {
        return res.status(404).send({ error: "Dictation Job Not Found" });
      }
      return res.status(200).send(job);
    });
  }
}
