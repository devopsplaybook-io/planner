# Planner

**Planner** is a task and project management application designed for individuals and small teams. It provides an intuitive interface for managing tasks, notes, and projects with support for multiple views, user collaboration, and custom workflows.

## Features

- **Project Management** - Admins create and manage multiple projects from the admin section and select which statuses they use
- **Centralized Status Management** - Admins define and order the global status catalog from the admin section, with a color per status chosen from a preset palette; the order is reflected across the Tasks board
- **Task Tracking** - Tasks with title, description, checklists, comments, attachments, due dates, priorities, labels, and recurring tasks that automatically create their next occurrence on completion
- **Task Assignment** - Assign tasks to one or more users
- **Smart Refresh** - Lists refresh when a dialog closes and open tasks are polled for changes; assignees receive a push notification when their task is updated by another user
- **Note Taking** - Notes with title, description, comments, attachments, and labels, with a debounced search over titles and descriptions
- **Global Search & Command Palette** - Jump to any task or note from every page with Ctrl/Cmd+K (fuzzy search across tasks and notes) plus quick actions for new task, new note and go to view
- **Multiple Views** - Next (overdue/upcoming), Calendar view, and Kanban board
- **Calendar Feed** - Subscribable ICS feed of task due dates, works with Google, Apple and Outlook calendars
- **Markdown Support** - Task, note, and project descriptions support markdown syntax
- **User Management** - First user automatically set as admin, additional users can be added
- **PWA Support** - Installable progressive web application for mobile and desktop
- **Responsive Design** - Optimized for all screen sizes with auto-collapsing navigation on mobile

## Specification

- Fastify API server with SQLite database (configurable for PostgreSQL)
- Nuxt SPA frontend with server-side rendering disabled
- PWA enabled for offline-capable installable application
- Responsive design with left-side menu navigation
- All-in-one container deployment

## Quick Start

### Docker

Run Planner in Docker:

```bash
mkdir -p data
docker run --name planner -p 8080:8080 -v "$(pwd)/data:/data" -d devopsplaybookio/planner
```

- Docker image: `devopsplaybookio/planner`
- Exposes port: `8080`
- Data volume: `/data`

### Kubernetes

Deploy Planner on Kubernetes:

```bash
git clone https://github.com/devopsplaybook-io/planner
cd planner/docs/deployments/kubernetes/planner
kubectl kustomize . | kubectl apply -f -
```

> **Note:** To expose the service externally, use an Ingress or a NodePort service.

## More Deployment Examples

See [`docs/deployments`](docs/deployments) for additional deployment options.

## Configuration

Configuration can be provided via a JSON configuration file (e.g., using a ConfigMap) or environment variables.

| Parameter             | Description                                          | Default             | Availability                        |
| --------------------- | ---------------------------------------------------- | ------------------- | ----------------------------------- |
| API_PORT              | API server port                                      | 8080                | Config file or environment variable |
| ATTACHMENT_MAX_SIZE   | Maximum attachment size in megabytes                 | `10`                | Config file or environment variable |
| CORS_POLICY_ORIGIN    | CORS origin policy (empty = same-origin only)        |                     | Config file or environment variable |
| DATABASE_TYPE         | Database type (`sqlite` or `postgres`)               | sqlite              | Config file or environment variable |
| DATA_DIR              | Data directory                                       | /data               | Config file or environment variable |
| DEV_MODE              | Skip the JWT_KEY requirement (local development)     | `false`             | Environment variable                |
| JWT_KEY               | JWT signing key (required; refuses empty or `"dev"`) |                     | Config file or environment variable |
| JWT_VALIDITY_DURATION | JWT token validity duration in seconds               | `2592000` (30 days) | Config file or environment variable |
| TZ                    | Server timezone (IANA name, e.g. `Europe/Paris`)     | `UTC`               | Environment variable                |

> **JWT_KEY is mandatory**: the server refuses to start when `JWT_KEY` is empty or set to the placeholder `"dev"` (unless `DEV_MODE=true`). Generate one with `openssl rand -hex 32` and provide it via a Secret / environment variable. To rotate it, change the value and restart the server: all user sessions are invalidated (API keys are unaffected).

## Timezone

The server timezone — the container's system timezone, set with the `TZ` environment variable (IANA name) — drives every day-level behavior of the instance:

- **Task template schedules**: cron automations fire at server-local time ("every day at 00:00" is server-local midnight).
- **Dated instance titles**: the ` YYYY.MN.DD` suffix of instances created from a template uses the server's calendar day.
- **Due-date day boundaries**: the dashboard overdue/upcoming windows and the LLM recommendation overdue stats evaluate "today" in the server timezone.
- **Voice dictation**: relative dates ("tomorrow", "next Monday") are resolved against the server's calendar day.
- **Notifications**: the fallback timezone for "today"/"tomorrow" and the reminder hour when `WEB_PUSH_TIMEZONE` is empty (see below).

The default is `UTC`. Set it at the container level, e.g. `TZ=Europe/Paris` — the image ships the `tzdata` package so any IANA timezone name works. Per-user display (dates, "Today" grouping, due-date urgency) always follows the browser's timezone, and reminders can use a different timezone than the server via `WEB_PUSH_TIMEZONE`. The effective timezone is logged at startup (`[Timezone] Server timezone: ...`).

## LLM Recommendation

Planner can generate task recommendations using any OpenAI-compatible chat completions API. Recommendations are enabled when `LLM_RECOMMENDATION_ENABLED` is set to `true` and `LLM_API_KEY` is configured.

| Variable                           | Description                                            | Default                                     |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `LLM_API_KEY`                      | API key for the LLM provider                           |                                             |
| `LLM_API_URL`                      | Chat completions endpoint URL                          | `https://api.deepseek.com/chat/completions` |
| `LLM_MODEL`                        | Model name to use                                      | `deepseek-chat`                             |
| `LLM_RECOMMENDATION_ENABLED`       | Enable LLM-based task recommendations                  | `false`                                     |
| `LLM_RECOMMENDATION_SCHEDULE_CRON` | Cron expression for recommendation schedule (server time) | `0 0 * * *` (daily at midnight)             |
| `RATE_LIMIT_LLM_IMPROVE_MAX`       | Max `improve` requests per user per hour               | `30`                                        |
| `RATE_LIMIT_LLM_REGENERATE_MAX`    | Max recommendation regenerations per user per hour     | `5`                                         |

## Voice Dictation

Planner offers advanced voice dictation: the user records a voice clip in the browser, the audio is transcribed by a speech-to-text engine, an LLM polishes the transcript, and a second LLM call proposes follow-up actions (create tasks or notes). The user reviews everything before anything is created. Dictation is enabled when `DICTATION_ENABLED` is set to `true` and a speech-to-text engine is available: `STT_MODE=embedded` (the engine embedded in the server, see below) or the default `external` mode with `STT_API_URL` and `STT_API_KEY`.

The server is engine-agnostic in `external` mode: `STT_API_URL` is the base URL of any OpenAI-compatible speech-to-text service (the server appends `/v1/audio/transcriptions`).

| Variable                         | Description                                              | Default                   |
| -------------------------------- | -------------------------------------------------------- | ------------------------- |
| `DICTATION_ENABLED`              | Enable the dictation feature                             | `false`                   |
| `STT_MODE`                       | Speech-to-text mode: `external` (API service) or `embedded` (built-in whisper.cpp engine) | `external`                |
| `STT_API_URL`                    | Base URL of the OpenAI-compatible STT service (external mode) |                      |
| `STT_API_KEY`                    | API key for the STT service (provide via a Secret)       |                           |
| `STT_MODEL`                      | STT model name (external mode)                           | `whisper-large-v3-turbo`  |
| `STT_EMBEDDED_MODEL`             | Embedded whisper.cpp model (embedded mode)               | `ggml-base`               |
| `STT_EMBEDDED_BIN_PATH`          | Path to a custom `whisper-cli` binary (embedded mode; defaults to the binary bundled in the image) | bundled binary |
| `DICTATION_LANGUAGE`             | Default STT language (`auto` = engine-side detection)    | `auto`                    |
| `DICTATION_MAX_DURATION_SECONDS` | Maximum recording duration (client-side auto-stop)       | `120`                     |
| `DICTATION_MAX_UPLOAD_MB`        | Maximum audio upload size in megabytes                   | `10`                      |
| `RATE_LIMIT_DICTATION_MAX`       | Max dictation uploads per user per hour                  | `30`                      |

Audio is never persisted: the uploaded file is deleted immediately after transcription, and transcripts are never logged.

Example setups:

- **Self-hosted**: run [Speaches](https://github.com/speaches-ai/speaches) (OpenAI-compatible, faster-whisper) in your cluster and set `STT_API_URL=http://speaches:8000`, `STT_API_KEY` (as required by your deployment) and `STT_MODEL=whisper-large-v3-turbo` — the audio never leaves your homelab.
- **Cloud**: point `STT_API_URL` at an OpenAI-compatible cloud endpoint (e.g. Groq `https://api.groq.com`) with `STT_MODEL=whisper-large-v3-turbo` and a Groq API key.

Always provide `STT_API_KEY` via an environment variable or a Kubernetes Secret — never commit it to `config.json`.

### Embedded STT mode (`STT_MODE=embedded`)

With `STT_MODE=embedded`, Planner embeds its own speech-to-text engine ([whisper.cpp](https://github.com/ggml-org/whisper.cpp)): no external STT service is needed, `STT_API_URL`/`STT_API_KEY` become unnecessary, and audio never leaves the host.

- **Nothing runs by default.** The engine ships as a `whisper-cli` binary inside the image and stays dormant until a dictation needs transcription: a short-lived transcription process is spawned for the duration of the dictation and shuts down immediately afterwards. No engine process or memory is used between dictations.
- **Model downloaded on demand.** The selected `STT_EMBEDDED_MODEL` (`ggml-base` by default, ≈ 148 MB; other options include `ggml-tiny`, `ggml-small`, `ggml-large-v3-turbo`) is downloaded once on the first dictation into the persistent `DATA_DIR` volume (`stt-models/`). This requires outbound internet exactly once; afterwards dictation works fully offline. If a downloaded model is corrupted, delete the file from `stt-models/` and it is fetched again on the next dictation.
- **CPU-only and serialized.** Transcriptions run on CPU, one at a time; uploads of any common format (webm, mp4, …) are decoded through the `ffmpeg` bundled in the image.

## Web Push Notifications

Planner sends personal browser push notifications for task due dates: the assignees of a task are reminded the day before, on the day, and daily while it is overdue (at most once per day per task). Reminders are filtered by project visibility, so restricted-project tasks never reach non-members, and tasks without assignees do not trigger reminders. Task assignees are also notified when their task is updated by another user (status change, comment, assignee, label or attachment change). Users can opt in to a daily digest (Settings → Notifications) that consolidates the day's due and overdue reminders into a single notification. Notifications are enabled when `WEB_PUSH_ENABLED` is set to `true`. Users opt in from the Settings page.

VAPID keys are read from the environment when both `WEB_PUSH_VAPID_PUBLIC_KEY` and `WEB_PUSH_VAPID_PRIVATE_KEY` are set, otherwise they are loaded from `DATA_DIR/vapid-keys.json` and generated on first start. Providing them explicitly keeps the identity of the server across a lost volume and allows several replicas.

| Variable                     | Description                                                         | Default                        |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------ |
| `WEB_PUSH_ENABLED`           | Enable web push reminders                                           | `true`                         |
| `WEB_PUSH_SUBJECT`           | Contact address advertised to push services (`mailto:` or `https:`) | `mailto:admin@localhost`       |
| `WEB_PUSH_NOTIFY_HOUR`       | Hour of the day (0-23) from which reminders are sent                | `9`                            |
| `WEB_PUSH_SCHEDULE_CRON`     | Cron expression for the reminder check                              | `\*/15 * * * *` (every 15 min) |
| `WEB_PUSH_TIMEZONE`          | Timezone used for the day/hour calculation (IANA name)              | empty (server timezone, `TZ`)  |
| `WEB_PUSH_VAPID_PUBLIC_KEY`  | VAPID public key (base64url), overrides the generated one           |                                |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | VAPID private key (base64url), overrides the generated one          |                                |

## Calendar Feed

Planner exposes a subscribable ICS calendar feed of your task due dates at `GET /api/users/calendar.ics`, so Planner due dates appear in Google Calendar, Apple Calendar or Outlook without manual entry. Subscribe from Settings → Profile (Calendar Feed section): copy the https or webcal URL right after generating or regenerating your API key, then add it as a calendar subscription ("From URL" in Google Calendar).

- **Authentication**: the feed uses your per-user API key, sent either via the `x-api-key` header or via the `?apiKey=` query parameter (calendar clients cannot send custom headers).
- **The feed URL contains your API key — treat it like a password.** Regenerating the key (Settings → Profile) revokes every calendar subscribed with the previous URL.
- **Visibility**: you only get tasks from projects you can see (admins see everything); Done tasks stay in the feed for 30 days after their last update, matching the dashboard.
- **Events**: all-day events covering the due date, with a stable identity so clients update existing events in place; the title carries `Project path / Task title`.

## Development

To start development on Planner:

```bash
git clone https://github.com/devopsplaybook-io/planner
cd planner
./docs/dev/run-dev-env.sh
```

This will install dependencies for all sub-projects (planner-proxy, planner-server, planner-web) and start them using PM2.

## Project Structure

```
planner/
  planner-proxy/       # Traefik reverse proxy
  planner-server/      # Fastify API server
    src/               # TypeScript source
    config.json        # Server configuration
  planner-web/         # Nuxt SPA frontend
  docs/
    dev/               # Development scripts
    deployments/       # Deployment examples (Docker, Kubernetes, Docker Compose)
    specs/             # Application specifications
```

## API

Planner exposes a RESTful API under the `/api/` prefix:

| Endpoint             | Description                                             |
| -------------------- | ------------------------------------------------------- |
| GET /api/status      | Health check endpoint                                   |
| GET /api/statuses    | Get the global, ordered status catalog (any user)       |
| PUT /api/statuses    | Replace the global status catalog (admin only)          |
| POST /api/dictation  | Upload a dictation audio clip and start a job           |
| GET /api/dictation/:jobId | Poll the state/stage/result of a dictation job     |
| GET /api/users/calendar.ics | ICS calendar feed of the authenticated user's visible task due dates (API key required) |

Additional API endpoints for projects, tasks, notes, and users will be available as the implementation progresses.

## Contributing

Contributions are welcome! Please open issues or pull requests on [GitHub](https://github.com/devopsplaybook-io/planner).
