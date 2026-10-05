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
  DictationStartJob,
} from "./Dictation";

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

export class DictationRoutes {
  constructor(private config: Config) {}

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // POST /api/dictation — upload a recorded audio clip and start a
    // background dictation job for the current user (single-flight).
    // The client polls GET /:jobId for the staged result.
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

        const inFlightJobId = DictationGetInFlightJobId(userSession.userId);
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

        try {
          for await (const part of req.parts()) {
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
            });
            await new Promise<void>((resolve, reject) => {
              part.file.pipe(writeStream);
              writeStream.on("finish", () => resolve());
              writeStream.on("error", reject);
            });
          }
        } catch {
          await fs.remove(audioPath).catch(() => undefined);
          return res.status(400).send({ error: "Invalid multipart upload" });
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
        if (audio.file.truncated || audioSize > maxBytes) {
          await fs.remove(audioPath).catch(() => undefined);
          return res.status(413).send({ error: "Audio file too large" });
        }

        const language = NormalizeLanguage(
          fields.language,
          this.config.DICTATION_LANGUAGE,
        );
        const jobId = DictationStartJob(
          userSession.userId,
          audioPath,
          audio.mimetype,
          language,
        );
        return res.status(202).send({ jobId });
      },
    );

    // GET /api/dictation/:jobId — poll the state/stage/result of a job.
    // Users can only poll their own jobs.
    fastify.get<{ Params: { jobId: string } }>("/:jobId", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const job = DictationGetJob(userSession.userId, req.params.jobId);
      if (!job) {
        return res.status(404).send({ error: "Dictation Job Not Found" });
      }
      return res.status(200).send(job);
    });
  }
}
