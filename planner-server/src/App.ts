import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { watchFile, readJsonSync } from "fs-extra";
import * as path from "path";
import { Config } from "./Config";
import { DbUtilsInit } from "./utils/DbUtils";
import { RunMigrations } from "./DbMigrations";
import { AuthInit, AuthGetUserSession } from "./users/Auth";
import { ApiKeysDataBackfillHashes } from "./users/ApiKeysData";
import { UsersRoutes } from "./users/UsersRoutes";
import { UsersDataList } from "./users/UsersData";
import { ProjectsRoutes } from "./projects/ProjectsRoutes";
import { ProjectsDataAdd, ProjectsDataList } from "./projects/ProjectsData";
import { Project } from "./model/Project";
import { TasksRoutes } from "./tasks/TasksRoutes";
import { NotesRoutes } from "./notes/NotesRoutes";
import { ViewsRoutes } from "./views/ViewsRoutes";
import { StatusesRoutes } from "./statuses/StatusesRoutes";
import { StatusesCatalogSeedIfEmpty } from "./statuses/StatusesData";
import { RecommendationInit } from "./recommendation/Recommendation";
import { RecommendationRoutes } from "./recommendation/RecommendationRoutes";
import { TaskImproveInit } from "./tasks/TaskImprove";
import { DictationInit } from "./dictation/Dictation";
import { DictationRoutes } from "./dictation/DictationRoutes";
import { NotificationsInit } from "./notifications/Notifications";
import { NotificationsRoutes } from "./notifications/NotificationsRoutes";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";

import fastifyCompress from "@fastify/compress";
import fastifyMultipart from "@fastify/multipart";

const logger = console;

logger.info("====== Starting planner Server ======");

const appVersion = (() => {
  try {
    return readJsonSync(path.join(__dirname, "../package.json")).version;
  } catch {
    return "0.0.0";
  }
})();

Promise.resolve()
  .then(async () => {
    //
    const config = new Config();
    await config.reload();
    watchFile(config.CONFIG_FILE, () => {
      logger.info(`Config updated: ${config.CONFIG_FILE}`);
      config.reload().catch((error) => {
        logger.error(`Config reload rejected: ${error.message}`);
      });
    });

    // Initialize database and auth
    await DbUtilsInit(config);
    await AuthInit(config);
    await RunMigrations();
    // Hash any plaintext API keys left by older versions (idempotent)
    await ApiKeysDataBackfillHashes();
    await StatusesCatalogSeedIfEmpty();
    await RecommendationInit(config);
    await TaskImproveInit(config);
    await DictationInit(config);
    await NotificationsInit(config);

    // Ensure a default project exists
    const existingProjects = await ProjectsDataList();
    if (existingProjects.length === 0) {
      const defaultProject = new Project();
      defaultProject.name = "General";
      defaultProject.isDefault = true;
      await ProjectsDataAdd(defaultProject);
      logger.info("Created default project: General");
    }

    // APIs

    const fastify = Fastify({
      logger: {
        level: "error",
      },
    });

    // OpenTelemetry: exported when OPENTELEMETRY_COLLECTOR_* is configured,
    // inert no-op otherwise
    const otelConfig = {
      SERVICE_ID: "planner-server",
      VERSION: appVersion,
      OPENTELEMETRY_COLLECTOR_HTTP_TRACES:
        process.env.OPENTELEMETRY_COLLECTOR_HTTP_TRACES,
      OPENTELEMETRY_COLLECTOR_HTTP_METRICS:
        process.env.OPENTELEMETRY_COLLECTOR_HTTP_METRICS,
      OPENTELEMETRY_COLLECTOR_HTTP_LOGS:
        process.env.OPENTELEMETRY_COLLECTOR_HTTP_LOGS,
      OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER:
        process.env.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER,
    };
    const standardTracer = new StandardTracer(otelConfig);
    const standardLogger = new StandardLogger();
    standardLogger.initOTel(otelConfig);
    StandardTracerFastifyRegisterHooks(fastify, standardTracer, standardLogger, {
      rootApiPath: "/api",
      ignoreListSuffix: ["/api/status"],
    });

    await fastify.register(fastifyCompress, {
      global: true,
      threshold: 1024,
      encodings: ["gzip", "deflate"],
    });

    await fastify.register(fastifyMultipart, {
      limits: {
        fileSize: config.ATTACHMENT_MAX_SIZE * 1024 * 1024,
      },
    });

    // Rate limits are opt-in per route (see the LLM endpoints)
    await fastify.register(fastifyRateLimit, {
      global: false,
    });

    if (config.CORS_POLICY_ORIGIN) {
      await fastify.register(fastifyCors, {
        origin: config.CORS_POLICY_ORIGIN,
        methods: "GET,PUT,POST,DELETE",
      });
    }

    fastify.get("/api/status", async () => {
      return { started: true };
    });

    fastify.get("/api/status/config", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      return res.status(200).send({
        llmRecommendationEnabled:
          config.LLM_RECOMMENDATION_ENABLED && !!config.LLM_API_KEY,
        llmImproveEnabled: !!config.LLM_API_KEY,
        dictationEnabled: config.DICTATION_ENABLED,
        dictationSttConfigured:
          !!config.STT_API_URL && !!config.STT_API_KEY && !!config.STT_MODEL,
      });
    });

    fastify.get("/api/status/initialization", async (req, res) => {
      if ((await UsersDataList()).length === 0) {
        return res.status(200).send({ initialized: false });
      }
      return res.status(200).send({ initialized: true });
    });

    // Register API routes
    await fastify.register(
      async (instance) => {
        await new UsersRoutes().getRoutes(instance);
      },
      { prefix: "/api/users" },
    );

    await fastify.register(
      async (instance) => {
        await new ProjectsRoutes().getRoutes(instance);
      },
      { prefix: "/api/projects" },
    );

    await fastify.register(
      async (instance) => {
        await new TasksRoutes(
          config.RATE_LIMIT_LLM_IMPROVE_MAX,
        ).getRoutes(instance);
      },
      { prefix: "/api/tasks" },
    );

    await fastify.register(
      async (instance) => {
        await new NotesRoutes().getRoutes(instance);
      },
      { prefix: "/api/notes" },
    );

    await fastify.register(
      async (instance) => {
        await new ViewsRoutes().getRoutes(instance);
      },
      { prefix: "/api/views" },
    );

    await fastify.register(
      async (instance) => {
        await new StatusesRoutes().getRoutes(instance);
      },
      { prefix: "/api/statuses" },
    );

    await fastify.register(
      async (instance) => {
        await new RecommendationRoutes(
          config.RATE_LIMIT_LLM_REGENERATE_MAX,
        ).getRoutes(instance);
      },
      { prefix: "/api/recommendation" },
    );

    await fastify.register(
      async (instance) => {
        await new DictationRoutes(config).getRoutes(instance);
      },
      { prefix: "/api/dictation" },
    );

    await fastify.register(
      async (instance) => {
        await new NotificationsRoutes().getRoutes(instance);
      },
      { prefix: "/api/notifications" },
    );

    fastify.register(fastifyStatic, {
      root: path.join(__dirname, "../web"),
      prefix: "/",
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        // Content-hashed build assets can be cached forever; the app shell
        // (index.html, service workers, manifest) must always be revalidated
        // so deploys and PWA updates take effect immediately
        if (filePath.includes(`${path.sep}_nuxt${path.sep}`)) {
          res.header("Cache-Control", "public, max-age=31536000, immutable");
          return;
        }
        if (
          name === "index.html" ||
          name === "sw.js" ||
          name === "sw-push.js" ||
          name === "manifest.webmanifest"
        ) {
          res.header("Cache-Control", "no-cache");
          return;
        }
        res.header("Cache-Control", "public, max-age=86400");
      },
    });

    fastify.setNotFoundHandler((request, reply) => {
      if (
        request.raw.url &&
        !request.raw.url.startsWith("/api/") &&
        !path.extname(request.raw.url)
      ) {
        return reply.sendFile("index.html");
      }
      reply.status(404).send({ error: "Not Found" });
    });

    fastify.listen({ port: config.API_PORT, host: "0.0.0.0" }, (err) => {
      if (err) {
        logger.error("Error starting API", err);
        process.exit(1);
      }
      logger.info("API Listening");
    });
  })
  .catch((error) => {
    logger.error("Startup failed:", error.message);
    process.exit(1);
  });
