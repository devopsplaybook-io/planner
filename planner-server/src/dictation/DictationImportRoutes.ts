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
import { UsersDataGet } from "../users/UsersData";
import { ProjectsDataGet } from "../projects/ProjectsData";
import {
  hasProjectPermission,
  isProjectVisible,
  permissionDeniedMessage,
} from "../projects/ProjectVisibility";
import {
  DictationDataCreate,
  DictationDataGetByClientId,
  DictationDataGetInFlightForUser,
} from "./DictationData";
import { DictationJobTtlMs } from "./Dictation";
import { NormalizeLanguage } from "./DictationRoutes";
import {
  DictationLongformStartJob,
  ProbeAudioDurationMs,
} from "./DictationLongform";
import { DbUtilsIsUniqueViolation } from "../utils/DbUtils";

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
};

export function AudioExtension(mimetype: string): string | null {
  return AUDIO_EXTENSIONS[mimetype.split(";")[0].trim().toLowerCase()] ?? null;
}

/**
 * Long-form import (meetings, 30-60+ minute recordings). The audio is stored
 * under DATA_DIR so an in-flight import survives a restart; a single import
 * runs per user at a time and interactive dictation is never blocked by it.
 */
export class DictationImportRoutes {
  constructor(private config: Config) {}

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.post(
      "/",
      {
        config: {
          rateLimit: {
            max: this.config.RATE_LIMIT_DICTATION_IMPORT_MAX,
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

        if (
          !this.config.DICTATION_ENABLED ||
          !this.config.DICTATION_IMPORT_ENABLED ||
          !this.config.IsDictationSttConfigured()
        ) {
          return res.status(404).send({ error: "Dictation Not Available" });
        }

        const tempDir = path.join(this.config.TMP_DIR, "dictation");
        await fs.ensureDir(tempDir);
        const tempPath = path.join(tempDir, `import-${uuidv4()}.audio`);
        const maxBytes = this.config.DICTATION_IMPORT_MAX_MB * 1024 * 1024;
        const fields: Record<string, string> = {};
        let audio: MultipartFile | null = null;
        let audioSize = 0;
        let tooLarge = false;
        let writeError = false;

        try {
          for await (const part of req.parts({
            limits: { fileSize: maxBytes },
          })) {
            if (part.type === "field") {
              fields[part.fieldname] = String(part.value ?? "");
              continue;
            }
            if (audio) {
              part.file.resume();
              continue;
            }
            audio = part;
            if (!AudioExtension(part.mimetype)) {
              part.file.resume();
              continue;
            }
            const writeStream = fs.createWriteStream(tempPath);
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
          await fs.remove(tempPath).catch(() => undefined);
          if (
            (error as { code?: string })?.code === "FST_REQ_FILE_TOO_LARGE"
          ) {
            return res.status(413).send({ error: "Audio file too large" });
          }
          return res.status(400).send({ error: "Invalid multipart upload" });
        }

        const cleanup = () => fs.remove(tempPath).catch(() => undefined);

        if (tooLarge || audio?.file.truncated || audioSize > maxBytes) {
          await cleanup();
          return res.status(413).send({ error: "Audio file too large" });
        }
        if (writeError) {
          await cleanup();
          return res.status(400).send({ error: "Invalid audio upload" });
        }
        if (!audio) {
          await cleanup();
          return res.status(400).send({ error: "No audio file uploaded" });
        }
        const extension = AudioExtension(audio.mimetype);
        if (!extension) {
          await cleanup();
          return res.status(400).send({
            error: "Invalid: audio file (wav, mp3, m4a or webm expected)",
          });
        }

        const clientId = (fields.clientId || "").trim();
        if (clientId.length > 100) {
          await cleanup();
          return res.status(400).send({ error: "Invalid: clientId" });
        }
        if (clientId) {
          const existing = await DictationDataGetByClientId(
            userSession.userId,
            clientId,
          );
          if (existing) {
            await cleanup();
            return res.status(202).send({ jobId: existing.id });
          }
        }

        const inFlight = await this.getProcessingImport(userSession.userId);
        if (inFlight) {
          await cleanup();
          return res.status(409).send({
            error: "An import is already in progress",
            jobId: inFlight,
          });
        }

        const projectId = (fields.projectId || "").trim() || null;
        if (projectId) {
          const project = await ProjectsDataGet(projectId);
          if (!project || !isProjectVisible(project, userSession)) {
            await cleanup();
            return res.status(404).send({ error: "Project Not Found" });
          }
          if (project.archived) {
            await cleanup();
            return res.status(400).send({ error: "Project is archived" });
          }
          if (!hasProjectPermission(project, userSession, "update")) {
            await cleanup();
            return res.status(403).send({
              error: permissionDeniedMessage("update"),
            });
          }
        }

        const durationMs = await ProbeAudioDurationMs(tempPath);
        if (!durationMs || durationMs <= 0) {
          await cleanup();
          return res
            .status(400)
            .send({ error: "Invalid: the audio duration cannot be read" });
        }
        if (
          durationMs >
          this.config.DICTATION_IMPORT_MAX_DURATION_SECONDS * 1000
        ) {
          await cleanup();
          return res.status(400).send({
            error: "Audio is longer than the import limit",
          });
        }

        let keepAudio: boolean;
        if (fields.keepAudio !== undefined) {
          keepAudio = fields.keepAudio === "true" || fields.keepAudio === "1";
        } else {
          const user = await UsersDataGet(userSession.userId);
          keepAudio = !!user?.dictationKeepAudio;
        }

        const audioDir = path.join(
          this.config.DATA_DIR,
          "dictation-audio",
          userSession.userId,
        );
        await fs.ensureDir(audioDir);
        const jobId = uuidv4();
        const audioPath = path.join(audioDir, `${jobId}.${extension}`);
        try {
          await fs.move(tempPath, audioPath, { overwrite: true });
        } catch {
          await cleanup();
          return res.status(400).send({ error: "Invalid audio upload" });
        }

        const language = NormalizeLanguage(
          fields.language,
          this.config.DICTATION_LANGUAGE,
        );
        try {
          await DictationDataCreate({
            id: jobId,
            userId: userSession.userId,
            source: "import",
            jobKind: "meeting",
            clientId: clientId || null,
            projectId,
            status: "processing",
            stage: "queued",
            language,
            engine:
              this.config.STT_MODE === "external" ? "external" : "embedded",
            model:
              this.config.STT_MODE === "embedded"
                ? this.config.STT_EMBEDDED_MODEL
                : this.config.STT_MODEL,
            expiresAt: new Date(
              Date.now() + DictationJobTtlMs("import", "meeting"),
            ).toISOString(),
            audioPath,
            audioRetained: keepAudio,
          });
        } catch (error) {
          await fs.remove(audioPath).catch(() => undefined);
          if (DbUtilsIsUniqueViolation(error)) {
            const existing = clientId
              ? await DictationDataGetByClientId(userSession.userId, clientId)
              : null;
            if (existing) {
              return res.status(202).send({ jobId: existing.id });
            }
            return res
              .status(409)
              .send({ error: "An import is already in progress" });
          }
          throw error;
        }

        DictationLongformStartJob(jobId);
        return res.status(202).send({ jobId });
      },
    );
  }

  private async getProcessingImport(userId: string): Promise<string | null> {
    const record = await DictationDataGetInFlightForUser(
      userId,
      "import",
      "meeting",
    );
    return record?.id ?? null;
  }
}