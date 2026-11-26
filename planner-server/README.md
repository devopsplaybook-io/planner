# Planner Server

Backend service of Planner: the HTTP API used by `planner-web`, the Planner LLM
Agent and the CLI/API clients. It is a Node.js + TypeScript application that
serves REST endpoints, persists data in SQLite (default) or PostgreSQL, runs
database migrations, stores attachments, and hosts the dictation (speech-to-text)
and LLM recommendation modules.

## Layout

| Path | Purpose |
| --- | --- |
| `src/App.ts` | Application bootstrap: configuration, database, routes and background processors |
| `src/Config.ts` | Configuration loader (`config.json` plus environment overrides) |
| `src/DbMigrations.ts`, `src/migrate-database.ts` | Migration runner and its CLI entry point |
| `src/tasks/`, `src/tasktemplates/` | Tasks and recurring task templates |
| `src/projects/`, `src/statuses/`, `src/labels/` | Projects, their statuses and labels |
| `src/notes/` | Notes attached to projects/tasks |
| `src/users/` | Users, sessions, login codes and authorization |
| `src/notifications/` | Web push and notification scheduling |
| `src/dictation/` | Speech-to-text (embedded whisper.cpp or remote STT), import and broadcast |
| `src/dictation/bench/` | STT benchmarking CLI |
| `src/recommendation/` | LLM-backed task recommendations |
| `src/views/`, `src/settings/`, `src/cleanup/` | Aggregated views, settings and retention jobs |
| `src/model/`, `src/utils/` | Shared domain model and helpers |
| `src/integration/` | Cross-module integration tests |
| `sql/` | SQL migration files |
| `config.json` | Runtime configuration (see below) |

## Configuration

`config.json` holds the non-secret, per-deployment settings:

- `DATABASE_TYPE` — `sqlite` (default) or `postgres`.
- `CORS_POLICY_ORIGIN` — allowed CORS origin for the web client.
- `API_PORT` — listening port (default `8080`).
- `processors.system` — system background processors (e.g. scheduled jobs).
- `processors.user` — per-user background processors.

Every value can be overridden with an environment variable of the same name
(`DATABASE_TYPE`, `CORS_POLICY_ORIGIN`, `API_PORT`). Additional environment
variables cover the rest of the configuration, notably:

- `CONFIG_FILE` — path to `config.json` (defaults to `../config.json`).
- `DATA_DIR` (default `/data`), `TMP_DIR` (default `/tmp`), `DEV_MODE`.
- `JWT_KEY`, `JWT_VALIDITY_DURATION`, `ATTACHMENT_MAX_SIZE`.
- `DATABASE_POSTGRES_*` — host, port, database, user and password for PostgreSQL.
- `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_RECOMMENDATION_*`.
- `STT_*`, `DICTATION_*` — dictation engine and limits.
- `LOGIN_CODE_*`, `WEB_PUSH_*`, `RATE_LIMIT_*`, `OPENTELEMETRY_*`.

## Scripts

| Script | Runs |
| --- | --- |
| `npm run build` | `tsc` plus a type-check of the spec files |
| `npm run lint` | `oxlint src` |
| `npm test` | `jest --coverage` |
| `npm run test:postgres` | PostgreSQL migration tests (`TEST_POSTGRES=1`) |
| `npm run dev` | `tsx watch src/App.ts` |
| `npm run dev:test` | Jest in watch mode |
| `npm run migrate` | Applies database migrations (`tsx src/migrate-database.ts`) |
| `npm run bench:stt` | Speech-to-text benchmark (`tsx src/dictation/bench/BenchStt.ts`) |

## Tests

Unit and integration tests are co-located with the source as `*.spec.ts` files
(including `src/integration/`). `npm test` runs the whole Jest suite with
coverage; `npm run test:postgres` requires a reachable PostgreSQL instance and
exercises the migration runner against it.
