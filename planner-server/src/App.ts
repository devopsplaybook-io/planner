import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { watchFile, promises as fs } from "fs-extra";
import * as path from "path";
import { Config } from "./Config";
import {
  DbUtilsInit,
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "./utils/DbUtils";
import { AuthInit } from "./users/Auth";
import { UsersRoutes } from "./users/UsersRoutes";
import { ProjectsRoutes } from "./projects/ProjectsRoutes";
import { TasksRoutes } from "./tasks/TasksRoutes";
import { NotesRoutes } from "./notes/NotesRoutes";

import fastifyCompress from "@fastify/compress";

const logger = console;

logger.info("====== Starting planner Server ======");

async function runMigrations(): Promise<void> {
  const dbType = DbUtilsGetType();
  const migrationsDir = path.join(__dirname, `../sql/${dbType}`);

  // Ensure metadata table exists for tracking migrations
  await DbUtilsExecSQL(
    `CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)`,
    [],
  );

  // Get already applied migrations
  const rows = await DbUtilsQuerySQL(
    "SELECT value FROM metadata WHERE key = 'migrations'",
    [],
  );
  const applied: string[] =
    rows.length > 0 && rows[0].value ? JSON.parse(rows[0].value) : [];

  // Read and apply new migrations in order
  const files = (await fs.readdir(migrationsDir))
    .filter((f: string) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (!applied.includes(file)) {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf-8");
      logger.info(`Running migration: ${file}`);
      // Split by semicolons and execute each statement
      const statements = sql
        .split(";")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
      for (const stmt of statements) {
        await DbUtilsExecSQL(stmt, []);
      }
      applied.push(file);
    }
  }

  // Save applied migrations
  await DbUtilsExecSQL(
    "INSERT OR REPLACE INTO metadata (key, value) VALUES ('migrations', ?)",
    [JSON.stringify(applied)],
  );
}

Promise.resolve().then(async () => {
  //
  const config = new Config();
  await config.reload();
  watchFile(config.CONFIG_FILE, () => {
    logger.info(`Config updated: ${config.CONFIG_FILE}`);
    config.reload();
  });

  // Initialize database and auth
  await DbUtilsInit(config);
  await AuthInit(config);
  await runMigrations();

  // APIs

  const fastify = Fastify({
    logger: {
      level: "error",
    },
  });

  await fastify.register(fastifyCompress, {
    global: true,
    threshold: 1024,
    encodings: ["gzip", "deflate"],
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
      await new TasksRoutes().getRoutes(instance);
    },
    { prefix: "/api/tasks" },
  );

  await fastify.register(
    async (instance) => {
      await new NotesRoutes().getRoutes(instance);
    },
    { prefix: "/api/notes" },
  );

  fastify.register(fastifyStatic, {
    root: path.join(__dirname, "../web"),
    prefix: "/",
    maxAge: "1d",
    etag: true,
    lastModified: true,
    immutable: true,
    cacheControl: true,
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (
      request.raw.url &&
      !request.raw.url.startsWith("/api/") &&
      !path.extname(request.raw.url)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (reply as any).sendFile("index.html");
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
});
