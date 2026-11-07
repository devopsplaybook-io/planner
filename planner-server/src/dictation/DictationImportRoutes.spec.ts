/* eslint-disable @typescript-eslint/no-explicit-any */
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import { FastifyInstance } from "fastify";
import { Writable } from "stream";
import { Config } from "../Config";
import { AudioExtension, DictationImportRoutes } from "./DictationImportRoutes";
import {
  AuthGetUserSession,
  AuthMustBeAuthenticated,
} from "../users/Auth";
import {
  DictationDataCreate,
  DictationDataGetByClientId,
  DictationDataGetInFlightForUser,
} from "./DictationData";
import {
  DictationLongformStartJob,
  ProbeAudioDurationMs,
} from "./DictationLongform";
import { ProjectsDataGet } from "../projects/ProjectsData";
import {
  hasProjectPermission,
  isProjectVisible,
} from "../projects/ProjectVisibility";
import * as fs from "fs-extra";

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
  AuthRateLimitKey: jest.fn(() => "user:test"),
}));

jest.mock("./DictationData", () => ({
  DictationDataCreate: jest.fn(async () => undefined),
  DictationDataGetByClientId: jest.fn(async () => null),
  DictationDataGetInFlightForUser: jest.fn(async () => null),
}));

jest.mock("./Dictation", () => ({
  DictationJobTtlMs: jest.fn(() => 7 * 24 * 60 * 60 * 1000),
}));

jest.mock("./DictationRoutes", () => ({
  NormalizeLanguage: jest.fn(
    (requested: string | undefined, fallback: string) => {
      const value = (requested || "").trim() || fallback;
      return !value || value === "auto" ? null : value;
    },
  ),
}));

jest.mock("./DictationLongform", () => ({
  DictationLongformStartJob: jest.fn(),
  ProbeAudioDurationMs: jest.fn(async () => 60000),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

jest.mock("../projects/ProjectVisibility", () => ({
  isProjectVisible: jest.fn(() => true),
  hasProjectPermission: jest.fn(() => true),
  permissionDeniedMessage: jest.fn(() => "Permission denied"),
}));

jest.mock("../users/UsersData", () => ({
  UsersDataGet: jest.fn(async () => ({ dictationKeepAudio: false })),
}));

jest.mock("fs-extra", () => ({
  ensureDir: jest.fn(async () => undefined),
  remove: jest.fn(async () => undefined),
  move: jest.fn(async () => undefined),
  createWriteStream: jest.fn(
    () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
  ),
}));

const userSession = {
  isAuthenticated: true,
  userId: "user-1",
  userName: "User",
  role: "user" as const,
};

function buildMultipart(options: {
  fields?: Record<string, string>;
  file?: { filename: string; contentType: string; content: Buffer };
}) {
  const boundary = "importboundary123";
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(options.fields || {})) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (options.file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${options.file.filename}"\r\nContent-Type: ${options.file.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(options.file.content);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("AudioExtension", () => {
  it("maps supported audio types and ignores parameters", () => {
    expect(AudioExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(AudioExtension("audio/mpeg")).toBe("mp3");
    expect(AudioExtension("audio/x-m4a")).toBe("m4a");
    expect(AudioExtension("audio/wav")).toBe("wav");
    expect(AudioExtension("application/pdf")).toBeNull();
  });
});

describe("DictationImportRoutes", () => {
  let app: FastifyInstance;
  let config: Config;

  const upload = (fields: Record<string, string> = {}) =>
    buildMultipart({
      fields,
      file: {
        filename: "meeting.m4a",
        contentType: "audio/mp4",
        content: Buffer.from("fake audio bytes"),
      },
    });

  beforeAll(async () => {
    config = new Config();
    config.DICTATION_ENABLED = true;
    config.DICTATION_IMPORT_ENABLED = true;
    config.STT_MODE = "external";
    config.STT_API_URL = "https://stt.test";
    config.STT_API_KEY = "stt-key";
    config.RATE_LIMIT_DICTATION_IMPORT_MAX = 100;
    config.ATTACHMENT_MAX_SIZE = 500;
    config.DATA_DIR = "/data-test";
    config.TMP_DIR = "/tmp/import-test";

    app = Fastify();
    await app.register(fastifyMultipart, {
      limits: { fileSize: config.ATTACHMENT_MAX_SIZE * 1024 * 1024 },
    });
    await app.register(fastifyRateLimit, { global: false });
    await new DictationImportRoutes(config).getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (AuthMustBeAuthenticated as jest.Mock).mockResolvedValue(undefined);
    (DictationDataGetByClientId as jest.Mock).mockResolvedValue(null);
    (DictationDataGetInFlightForUser as jest.Mock).mockResolvedValue(null);
    (ProbeAudioDurationMs as jest.Mock).mockResolvedValue(60000);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(null);
    (isProjectVisible as jest.Mock).mockReturnValue(true);
    (hasProjectPermission as jest.Mock).mockReturnValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers 401 without a session", async () => {
    (AuthMustBeAuthenticated as jest.Mock).mockImplementation(
      async (_req: any, res: any) => {
        res.status(401).send({ error: "Access Denied" });
        throw new Error("Access Denied");
      },
    );
    const body = upload();
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(401);
    expect(DictationDataCreate).not.toHaveBeenCalled();
  });

  it("answers 404 when imports are disabled", async () => {
    config.DICTATION_IMPORT_ENABLED = false;
    try {
      const body = upload();
      const res = await app.inject({
        method: "POST",
        url: "/",
        headers: { "content-type": body.contentType },
        payload: body.body,
      });
      expect(res.statusCode).toBe(404);
    } finally {
      config.DICTATION_IMPORT_ENABLED = true;
    }
  });

  it("creates a durable meeting job and starts it", async () => {
    const body = upload({ language: "fr", clientId: "client-1", keepAudio: "true" });
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json();
    expect(jobId).toEqual(expect.any(String));

    expect(DictationDataCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: jobId,
        userId: "user-1",
        source: "import",
        jobKind: "meeting",
        clientId: "client-1",
        status: "processing",
        stage: "queued",
        language: "fr",
        engine: "external",
        model: config.STT_MODEL,
        audioPath: `/data-test/dictation-audio/user-1/${jobId}.m4a`,
        audioRetained: true,
      }),
    );
    expect(fs.move).toHaveBeenCalled();
    expect(DictationLongformStartJob).toHaveBeenCalledWith(jobId);
  });

  it("returns the existing job for a retried clientId", async () => {
    (DictationDataGetByClientId as jest.Mock).mockResolvedValue({ id: "job-old" });
    const body = upload({ clientId: "client-1" });
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ jobId: "job-old" });
    expect(DictationDataCreate).not.toHaveBeenCalled();
    expect(fs.remove).toHaveBeenCalled();
  });

  it("refuses a second concurrent import", async () => {
    (DictationDataGetInFlightForUser as jest.Mock).mockResolvedValue({
      id: "job-running",
    });
    const body = upload();
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ jobId: "job-running" });
  });

  it("rejects a recording longer than the import limit", async () => {
    (ProbeAudioDurationMs as jest.Mock).mockResolvedValue(
      config.DICTATION_IMPORT_MAX_DURATION_SECONDS * 1000 + 1,
    );
    const body = upload();
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(400);
    expect(DictationDataCreate).not.toHaveBeenCalled();
    expect(fs.remove).toHaveBeenCalled();
  });

  it("rejects a recording whose duration cannot be read", async () => {
    (ProbeAudioDurationMs as jest.Mock).mockResolvedValue(0);
    const body = upload();
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-audio file", async () => {
    const body = buildMultipart({
      file: {
        filename: "notes.txt",
        contentType: "text/plain",
        content: Buffer.from("hello"),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates the optional target project", async () => {
    const body = upload({ projectId: "project-1" });
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(404);
    expect(ProjectsDataGet).toHaveBeenCalledWith("project-1");
  });

  it("requires update permission on the target project", async () => {
    (ProjectsDataGet as jest.Mock).mockResolvedValue({
      id: "project-1",
      archived: false,
    });
    (hasProjectPermission as jest.Mock).mockReturnValue(false);
    const body = upload({ projectId: "project-1" });
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("honors the stored keep-audio preference", async () => {
    const body = upload();
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(202);
    expect(DictationDataCreate).toHaveBeenCalledWith(
      expect.objectContaining({ audioRetained: false }),
    );
  });
});