# Planner

**Planner** is a task and project management application designed for individuals and small teams. It provides an intuitive interface for managing tasks, notes, and projects with support for multiple views, user collaboration, and custom workflows.

## Features

- **Project Management** - Admins create and manage multiple projects from the admin section and select which statuses they use
- **Centralized Status Management** - Admins define and order the global status catalog from the admin section, with a color per status chosen from a preset palette; the order is reflected across the Tasks board
- **Task Tracking** - Tasks with title, description, checklists, comments, attachments, due dates, priorities, and labels
- **Task Assignment** - Assign tasks to one or more users
- **Smart Refresh** - Lists refresh when a dialog closes and open tasks are polled for changes; assignees receive a push notification when their task is updated by another user
- **Note Taking** - Notes with title, description, comments, attachments, and labels
- **Multiple Views** - Next (overdue/upcoming), Calendar view, and Kanban board
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

> **JWT_KEY is mandatory**: the server refuses to start when `JWT_KEY` is empty or set to the placeholder `"dev"` (unless `DEV_MODE=true`). Generate one with `openssl rand -hex 32` and provide it via a Secret / environment variable. To rotate it, change the value and restart the server: all user sessions are invalidated (API keys are unaffected).

## LLM Recommendation

Planner can generate task recommendations using any OpenAI-compatible chat completions API. Recommendations are enabled when `LLM_RECOMMENDATION_ENABLED` is set to `true` and `LLM_API_KEY` is configured.

| Variable                           | Description                                            | Default                                     |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `LLM_API_KEY`                      | API key for the LLM provider                           |                                             |
| `LLM_API_URL`                      | Chat completions endpoint URL                          | `https://api.deepseek.com/chat/completions` |
| `LLM_MODEL`                        | Model name to use                                      | `deepseek-chat`                             |
| `LLM_RECOMMENDATION_ENABLED`       | Enable LLM-based task recommendations                  | `false`                                     |
| `LLM_RECOMMENDATION_SCHEDULE_CRON` | Cron expression for recommendation schedule (UTC time) | `0 0 * * *` (daily at midnight)             |
| `RATE_LIMIT_LLM_IMPROVE_MAX`       | Max `improve` requests per user per hour               | `30`                                        |
| `RATE_LIMIT_LLM_REGENERATE_MAX`    | Max recommendation regenerations per user per hour     | `5`                                         |

## Voice Dictation

Planner offers advanced voice dictation: the user records a voice clip in the browser, the audio is transcribed by a speech-to-text engine, an LLM polishes the transcript, and a second LLM call proposes follow-up actions (create tasks or notes). The user reviews everything before anything is created. Dictation is enabled when `DICTATION_ENABLED` is set to `true` and both `STT_API_URL` and `STT_API_KEY` are configured.

The server is engine-agnostic: `STT_API_URL` is the base URL of any OpenAI-compatible speech-to-text service (the server appends `/v1/audio/transcriptions`).

| Variable                         | Description                                              | Default                   |
| -------------------------------- | -------------------------------------------------------- | ------------------------- |
| `DICTATION_ENABLED`              | Enable the dictation feature                             | `false`                   |
| `STT_API_URL`                    | Base URL of the OpenAI-compatible STT service            |                           |
| `STT_API_KEY`                    | API key for the STT service (provide via a Secret)       |                           |
| `STT_MODEL`                      | STT model name                                           | `whisper-large-v3-turbo`  |
| `DICTATION_LANGUAGE`             | Default STT language (`auto` = engine-side detection)    | `auto`                    |
| `DICTATION_MAX_DURATION_SECONDS` | Maximum recording duration (client-side auto-stop)       | `120`                     |
| `DICTATION_MAX_UPLOAD_MB`        | Maximum audio upload size in megabytes                   | `10`                      |
| `RATE_LIMIT_DICTATION_MAX`       | Max dictation uploads per user per hour                  | `30`                      |

Audio is never persisted: the uploaded file is deleted immediately after transcription, and transcripts are never logged.

Example setups:

- **Self-hosted**: run [Speaches](https://github.com/speaches-ai/speaches) (OpenAI-compatible, faster-whisper) in your cluster and set `STT_API_URL=http://speaches:8000`, `STT_API_KEY` (as required by your deployment) and `STT_MODEL=whisper-large-v3-turbo` — the audio never leaves your homelab.
- **Cloud**: point `STT_API_URL` at an OpenAI-compatible cloud endpoint (e.g. Groq `https://api.groq.com`) with `STT_MODEL=whisper-large-v3-turbo` and a Groq API key.

Always provide `STT_API_KEY` via an environment variable or a Kubernetes Secret — never commit it to `config.json`.

## Web Push Notifications

Planner sends browser push notifications for tasks due today or tomorrow, and to task assignees when their task is updated by another user (status change, comment, assignee, label or attachment change). Notifications are enabled when `WEB_PUSH_ENABLED` is set to `true`. Users opt in from the Settings page.

VAPID keys are read from the environment when both `WEB_PUSH_VAPID_PUBLIC_KEY` and `WEB_PUSH_VAPID_PRIVATE_KEY` are set, otherwise they are loaded from `DATA_DIR/vapid-keys.json` and generated on first start. Providing them explicitly keeps the identity of the server across a lost volume and allows several replicas.

| Variable                     | Description                                                         | Default                        |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------ |
| `WEB_PUSH_ENABLED`           | Enable web push reminders                                           | `true`                         |
| `WEB_PUSH_SUBJECT`           | Contact address advertised to push services (`mailto:` or `https:`) | `mailto:admin@localhost`       |
| `WEB_PUSH_NOTIFY_HOUR`       | Hour of the day (0-23) from which reminders are sent                | `9`                            |
| `WEB_PUSH_SCHEDULE_CRON`     | Cron expression for the reminder check                              | `\*/15 * * * *` (every 15 min) |
| `WEB_PUSH_TIMEZONE`          | Timezone used for the day/hour calculation (IANA name)              | empty (server timezone)        |
| `WEB_PUSH_VAPID_PUBLIC_KEY`  | VAPID public key (base64url), overrides the generated one           |                                |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | VAPID private key (base64url), overrides the generated one          |                                |

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

Additional API endpoints for projects, tasks, notes, and users will be available as the implementation progresses.

## Contributing

Contributions are welcome! Please open issues or pull requests on [GitHub](https://github.com/devopsplaybook-io/planner).
