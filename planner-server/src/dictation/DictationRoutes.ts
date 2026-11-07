import { FastifyInstance } from "fastify";
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
  DictationGetInFlightJobId,
  DictationGetJob,
  DictationGetRecentJobs,
  DictationStartJob,
  DictationWaitForJob,
} from "./Dictation";
import { DictationJobSource } from "./DictationData";

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

export class DictationRoutes {
  constructor(private config: Config) {}

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
        // Inline jobs are tagged so inline usage and latency can be measured
        // separately from the modal; unknown sources keep the historic value.
        const source: DictationJobSource =
          fields.source === "inline" ? "inline" : "dictation";
        const jobId = await DictationStartJob(
          userSession.userId,
          audioPath,
          audio.mimetype,
          language,
          source,
        );
        return res.status(202).send({ jobId });
      },
    );

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
