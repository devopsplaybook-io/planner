/* eslint-disable @typescript-eslint/no-explicit-any */
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import { FastifyInstance } from "fastify";
import { Config } from "../Config";
import { DictationRoutes, NormalizeLanguage } from "./DictationRoutes";
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

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
  AuthRateLimitKey: jest.fn(() => "user:test"),
}));

jest.mock("./Dictation", () => ({
  DictationStartJob: jest.fn(() => "job-abc"),
  DictationGetJob: jest.fn(),
  DictationGetInFlightJobId: jest.fn(() => null),
}));

jest.mock("fs-extra", () => {
  const { Writable } = require("stream");
  return {
    ensureDir: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    createWriteStream: jest.fn(
      () =>
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
    ),
  };
});

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
  const boundary = "testboundary123";
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

describe("DictationRoutes", () => {
  let app: FastifyInstance;
  let config: Config;

  beforeAll(async () => {
    config = new Config();
    config.RATE_LIMIT_DICTATION_MAX = 100;
    app = Fastify();
    await app.register(fastifyMultipart, {
      limits: { fileSize: config.ATTACHMENT_MAX_SIZE * 1024 * 1024 },
    });
    await app.register(fastifyRateLimit, { global: false });
    await new DictationRoutes(config).getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (AuthMustBeAuthenticated as jest.Mock).mockResolvedValue(undefined);
    (AuthRateLimitKey as jest.Mock).mockReturnValue("user:test");
    (DictationGetInFlightJobId as jest.Mock).mockReturnValue(null);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 401 when not authenticated", async () => {
    (AuthMustBeAuthenticated as jest.Mock).mockImplementation(
      async (_req: any, res: any) => {
        res.status(401).send({ error: "Access Denied" });
        throw new Error("Access Denied");
      },
    );
    const res = await app.inject({ method: "POST", url: "/", payload: {} });
    expect(res.statusCode).toBe(401);
    expect(DictationStartJob).not.toHaveBeenCalled();
  });

  it("should accept an audio upload with 202 and start a job", async () => {
    const body = buildMultipart({
      fields: { language: "fr" },
      file: {
        filename: "speech.webm",
        contentType: "audio/webm;codecs=opus",
        content: Buffer.from("fake audio bytes"),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ jobId: "job-abc" });
    expect(DictationStartJob).toHaveBeenCalledWith(
      "user-1",
      expect.stringContaining("dictation"),
      "audio/webm",
      "fr",
    );
  });

  it("should default the language to the server configuration", async () => {
    config.DICTATION_LANGUAGE = "en";
    const body = buildMultipart({
      file: {
        filename: "speech.webm",
        contentType: "audio/webm",
        content: Buffer.from("fake audio bytes"),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(202);
    expect(DictationStartJob).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      "audio/webm",
      "en",
    );
    config.DICTATION_LANGUAGE = "auto";
  });

  it("should answer 400 when no file is uploaded", async () => {
    const body = buildMultipart({ fields: { language: "fr" } });
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(400);
    expect(DictationStartJob).not.toHaveBeenCalled();
  });

  it("should answer 400 when the uploaded file is not audio", async () => {
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
    expect(res.json()).toEqual({ error: "Invalid: an audio file is expected" });
    expect(DictationStartJob).not.toHaveBeenCalled();
  });

  it("should answer 413 when the audio exceeds the configured size cap", async () => {
    config.DICTATION_MAX_UPLOAD_MB = 0;
    const body = buildMultipart({
      file: {
        filename: "speech.webm",
        contentType: "audio/webm",
        content: Buffer.from("fake audio bytes"),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": body.contentType },
      payload: body.body,
    });
    expect(res.statusCode).toBe(413);
    expect(DictationStartJob).not.toHaveBeenCalled();
    config.DICTATION_MAX_UPLOAD_MB = 10;
  });

  it("should answer 409 when a job is already in flight", async () => {
    (DictationGetInFlightJobId as jest.Mock).mockReturnValue("job-running");
    const res = await app.inject({ method: "POST", url: "/", payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: "A dictation job is already in progress",
      jobId: "job-running",
    });
    expect(DictationStartJob).not.toHaveBeenCalled();
  });

  it("should return the job view for its owner", async () => {
    (DictationGetJob as jest.Mock).mockReturnValue({
      jobId: "job-abc",
      status: "processing",
      stage: "transcribing",
      result: null,
      error: null,
    });
    const res = await app.inject({ method: "GET", url: "/job-abc" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ jobId: "job-abc", stage: "transcribing" });
    expect(DictationGetJob).toHaveBeenCalledWith("user-1", "job-abc");
  });

  it("should answer 404 for an unknown job", async () => {
    (DictationGetJob as jest.Mock).mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/missing" });
    expect(res.statusCode).toBe(404);
  });

  it("should answer 401 for the job poll without a session", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/job-abc" });
    expect(res.statusCode).toBe(401);
    expect(DictationGetJob).not.toHaveBeenCalled();
  });
});

describe("DictationRoutes rate limiting", () => {
  it("should answer 429 once the hourly dictation budget is exhausted", async () => {
    const app = Fastify();
    const config = new Config();
    config.RATE_LIMIT_DICTATION_MAX = 2;
    await app.register(fastifyMultipart, {
      limits: { fileSize: config.ATTACHMENT_MAX_SIZE * 1024 * 1024 },
    });
    await app.register(fastifyRateLimit, { global: false });
    await new DictationRoutes(config).getRoutes(app);
    await app.ready();

    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (AuthMustBeAuthenticated as jest.Mock).mockResolvedValue(undefined);
    (AuthRateLimitKey as jest.Mock).mockReturnValue("user:test");
    (DictationGetInFlightJobId as jest.Mock).mockReturnValue(null);

    try {
      const body = buildMultipart({
        file: {
          filename: "speech.webm",
          contentType: "audio/webm",
          content: Buffer.from("fake audio bytes"),
        },
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/",
            headers: { "content-type": body.contentType },
            payload: body.body,
          })
        ).statusCode,
      ).toBe(202);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/",
            headers: { "content-type": body.contentType },
            payload: body.body,
          })
        ).statusCode,
      ).toBe(202);
      const blocked = await app.inject({
        method: "POST",
        url: "/",
        headers: { "content-type": body.contentType },
        payload: body.body,
      });
      expect(blocked.statusCode).toBe(429);
      expect(DictationStartJob).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});

describe("NormalizeLanguage", () => {
  it("should prefer the requested language over the fallback", () => {
    expect(NormalizeLanguage("fr", "en")).toBe("fr");
  });

  it("should use the fallback when no language is requested", () => {
    expect(NormalizeLanguage(undefined, "en")).toBe("en");
    expect(NormalizeLanguage("", "en")).toBe("en");
    expect(NormalizeLanguage("  ", "en")).toBe("en");
  });

  it("should return null in auto mode", () => {
    expect(NormalizeLanguage("auto", "auto")).toBeNull();
    expect(NormalizeLanguage(undefined, "auto")).toBeNull();
    expect(NormalizeLanguage("", "auto")).toBeNull();
  });
});
