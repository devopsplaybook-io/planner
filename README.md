# Planner

**Planner** is a task and project management application designed for individuals and small teams. It provides an intuitive interface for managing tasks, notes, and projects with support for multiple views, user collaboration, and custom workflows.

## Features

- **Project Management** - Admins create and manage multiple projects from the admin section and select which statuses they use; deleting a project can move its tasks to another project instead of deleting them
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
- The container runs as the non-root `node` user (UID/GID 1000): the mounted
  `data` directory must be writable by that user. On an existing installation
  created by a root container, run `sudo chown -R 1000:1000 data` once.

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

Planner offers advanced voice dictation: the user records a voice clip in the browser, the audio is transcribed by a speech-to-text engine, an LLM polishes the transcript, and a second LLM call proposes follow-up actions (create tasks or notes). The user reviews everything before anything is created. The single navigation button opens one tabbed menu (Dictate, Capture, Import) that groups interactive dictation, quick capture and long-form meeting import. Dictation is enabled when `DICTATION_ENABLED` is set to `true` and a speech-to-text engine is available: `STT_MODE=embedded` (the engine embedded in the server, see below) or the default `external` mode with `STT_API_URL` and `STT_API_KEY`. The dictation language is a user preference configured in Settings and applies to the dictation dialog and to the microphone buttons next to task, note and comment fields.

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
| `STT_EMBEDDED_THREADS`           | whisper.cpp thread count (embedded mode; `0` = follow the cgroup CPU limit, capped at 4) | `0`               |
| `STT_EMBEDDED_TRIM_SILENCE`      | Trim leading/trailing silence before transcription (embedded mode) | `true`           |
| `DICTATION_LANGUAGE`             | Default STT language (`auto` = engine-side detection)    | `auto`                    |
| `DICTATION_LANGUAGES`            | Comma-separated languages offered in the UI (the UI prepends `auto`) | `en,fr,de,es,it,pt,nl` |
| `DICTATION_ESTIMATED_RTF`        | Real-time factor used for the processing ETA (`0` = engine default) | `0`                      |
| `DICTATION_MAX_DURATION_SECONDS` | Maximum recording duration (client-side auto-stop)       | `120`                     |
| `DICTATION_MAX_UPLOAD_MB`        | Maximum audio upload size in megabytes                   | `10`                      |
| `DICTATION_HOTWORDS_MAX`         | Maximum vocabulary terms injected into the STT prompt    | `50`                      |
| `DICTATION_VOCABULARY_MAX`       | Maximum stored vocabulary terms per user                 | `200`                     |
| `DICTATION_CONFIDENCE_THRESHOLD` | Confidence below which the review highlights a word      | `0.6`                     |
| `RATE_LIMIT_DICTATION_MAX`       | Max dictation uploads per user per hour                  | `30`                      |
| `DICTATION_IMPORT_ENABLED`       | Allow importing long meeting recordings                  | `true`                    |
| `DICTATION_IMPORT_MAX_MB`        | Maximum meeting import size in megabytes                 | `200`                     |
| `DICTATION_IMPORT_MAX_DURATION_SECONDS` | Maximum imported recording duration               | `7200` (2 h)              |
| `DICTATION_IMPORT_SEGMENT_SECONDS` | Target length of one transcription chunk               | `30`                      |
| `DICTATION_INBOX_TTL_HOURS`      | Retention of inbox jobs without kept audio               | `168` (7 days)            |
| `DICTATION_MEETING_TTL_DAYS`     | Retention of imported meeting jobs                       | `7`                       |
| `DICTATION_AUDIO_KEEP_MAX_MB`    | Maximum kept audio per user (`0` disables keeping)       | `500`                     |
| `DICTATION_AUDIO_RETENTION_DAYS` | Maximum age of kept audio                                | `30`                      |
| `DICTATION_NOTIFY_READY`         | Send "Dictation ready" / "Meeting ready" push notifications | `true`                |
| `RATE_LIMIT_DICTATION_IMPORT_MAX` | Max meeting imports per user per hour                   | `5`                       |

For short recordings (dialog, inline, quick capture, voice comments) audio is never persisted: the uploaded file is deleted immediately after transcription, and transcripts are never logged. Imported meeting audio is deleted as soon as the job finishes unless the user keeps it (per-import choice or the stored `keepAudio` preference), in which case it is removed after `DICTATION_AUDIO_RETENTION_DAYS` or when the per-user `DICTATION_AUDIO_KEEP_MAX_MB` cap is exceeded. Vocabulary terms and the prompt composed from them are never logged either; only aggregate counters reach telemetry. The web client gets the recording/upload/import limits, the language list, the vocabulary/confidence limits, the retention settings and the engine state from `GET /api/status/config`, so a configuration change does not require a web rebuild.

Users can manage a custom vocabulary (personal and per-project) that biases transcription, choose an optional target output language, and review low-confidence words. Vocabulary is available through `GET/POST/PUT /api/dictation/vocabulary` and `DELETE /api/dictation/vocabulary/:id`; the target language and the "keep audio" retention preference are stored per user through `GET/PUT /api/dictation/preferences`. A `projectId` and an optional `targetLanguage` can be sent with a dictation upload.

Example setups:

- **Self-hosted**: run [Speaches](https://github.com/speaches-ai/speaches) (OpenAI-compatible, faster-whisper) in your cluster and set `STT_API_URL=http://speaches:8000`, `STT_API_KEY` (as required by your deployment) and `STT_MODEL=whisper-large-v3-turbo` — the audio never leaves your homelab.
- **Cloud**: point `STT_API_URL` at an OpenAI-compatible cloud endpoint (e.g. Groq `https://api.groq.com`) with `STT_MODEL=whisper-large-v3-turbo` and a Groq API key.

Always provide `STT_API_KEY` via an environment variable or a Kubernetes Secret — never commit it to `config.json`.

### Embedded STT mode (`STT_MODE=embedded`)

With `STT_MODE=embedded`, Planner embeds its own speech-to-text engine ([whisper.cpp](https://github.com/ggml-org/whisper.cpp)): no external STT service is needed, `STT_API_URL`/`STT_API_KEY` become unnecessary, and audio never leaves the host.

- **Nothing runs by default.** The engine ships as a `whisper-cli` binary inside the image and stays dormant between dictations: a short-lived process is spawned for each transcription and exits immediately afterwards. No engine process or memory is used between dictations.
- **Model pre-downloaded at startup.** The selected `STT_EMBEDDED_MODEL` (`ggml-base` by default, ≈ 148 MB; other options include `ggml-tiny`, `ggml-small`, `ggml-large-v3-turbo` and quantized variants such as `ggml-base-q5_1`) is downloaded asynchronously when the server starts into the persistent `DATA_DIR` volume (`stt-models/`), so the first dictation does not wait for a download. The download uses a `.part` file, retries with backoff and never blocks readiness; while it runs the engine reports a `preparing` state and the UI shows "Preparing speech engine…". Afterwards dictation works fully offline; delete a corrupted model to fetch it again.
- **CPU-only, sized from the cgroup.** Transcriptions run on CPU, one at a time; the thread count follows the container's cgroup CPU limit (`STT_EMBEDDED_THREADS`, capped at 4) instead of a hardcoded value. Uploads of any common format (webm, mp4, …) are decoded through the bundled `ffmpeg`.
- **Silence trim and no-speech detection.** Leading and trailing silence is removed before transcription (`STT_EMBEDDED_TRIM_SILENCE`, enabled by default); a clip shorter than 300 ms after trimming is reported as "no speech detected" instead of sending it to the engine.
- **Benchmarked and sized.** See [`docs/dictation-benchmark.md`](docs/dictation-benchmark.md) for the harness (`npm run bench:stt`), results and the model/sizing rationale.

### Voice comments

Voice comments on tasks reuse the same STT and polish stages. When an audio attachment is uploaded, the transcription runs in the background and posts the transcript as a task comment; the task dialog shows the transcription status per audio attachment and offers a **Retry** action for failed or skipped transcriptions. The hourly voice quota is shared with dictation, and a skipped transcription is reported inline (the audio is still kept). Transcripts can be corrected by editing the generated comment.

### Voice inbox and capture anywhere

The **Inbox** page (`/inbox`, also in the navigation with a badge) lists every dictation, inline transcription, quick capture and imported meeting. Each entry can be opened in the review dialog, converted into a task, note, task comment or checklist items (project and permissions are re-checked server-side), archived (the state survives reloads and restarts) or deleted. The list supports filters and pagination; `voice_comment` jobs stay on their task and are excluded unless requested explicitly. Jobs expire by source: voice comments after 1 hour, inbox jobs after `DICTATION_INBOX_TTL_HOURS` and meeting imports after `DICTATION_MEETING_TTL_DAYS`.

**Quick capture** records a thought from the navigation or with `Ctrl/Cmd+Shift+D` and uploads it in the background with `source=quick_capture`; the dialog closes immediately, so the recording is safe even if the page or app is closed. A client-generated `clientId` makes retries idempotent. When the job finishes, the user gets a **content-free** "Dictation ready" / "Meeting ready" push notification (if web push is configured and the user opted in under Settings → Notifications → Dictation ready) plus an in-app toast and a refreshed badge; the notification deep-links to `/inbox?jobId=<id>` and opens the finished job. The notification never contains audio, transcript or summary text, and a push failure never fails the job.

**Offline queue**: recordings made offline are stored in the browser (IndexedDB, with an in-memory fallback) and uploaded automatically on reconnect, on the next app start or after sign-in. The queue is limited to **20 recordings / 100 MB per device**; the oldest recordings are evicted first and an oversized single recording is refused with a visible error. A queued recording keeps its `clientId`, so the server deduplicates retries; permanent rejections are reported and dropped, transient failures are retried.

**Share to Planner** (best effort): the PWA manifest registers an audio share target. Supported browsers (Android/Chrome-class; iOS Safari does not support share targets) can share an audio file to the installed app; the service worker queues it and redirects to the inbox, which uploads it. Without service-worker support the server redirects to the inbox with an explanation, and **Import meeting** remains the fallback.

The STT priority scheduler, the per-user single-flight checks and the meeting worker are in-process: **a single server replica is assumed**. Long-running jobs are stored in SQLite/PostgreSQL and resume after a restart, but a multi-replica deployment would need a shared queue and coordination.

### Meeting import (long-form)

`POST /api/dictation/import` uploads a 30 s–2 h recording (`wav/mp3/m4a/webm`, up to `DICTATION_IMPORT_MAX_MB`) and starts a durable background job; only one import may be processing per user at a time. The server probes the duration, detects silences with `ffmpeg`, splits the audio into chunks of roughly `DICTATION_IMPORT_SEGMENT_SECONDS` (never longer than 45 s), transcribes them sequentially with timestamped segments, and resumes from the last finished chunk after a restart. A final map-reduce LLM pass produces a summary, decisions and action items; the action items become regular task proposals scoped to the import project, reviewable and applicable through the existing structured-action flow.

The import dialog shows the stage, `segmentsDone/segmentsTotal`, elapsed time and an ETA based on the configured real-time factor. Import chunks run in a **batch** lane behind interactive dictation, so a dialog, inline or quick-capture recording never waits for a long meeting chunk. Imported audio is deleted when the job finishes unless the user keeps it (per-import or via Settings → Dictation → Keep audio after transcription); kept audio is bounded by `DICTATION_AUDIO_RETENTION_DAYS` and `DICTATION_AUDIO_KEEP_MAX_MB`. Embedded transcription is CPU-bound (roughly 0.4–0.5× real time for `ggml-base` on 2 CPU), so a 60-minute meeting can take about 25–30 minutes; the UI states this explicitly. Diarization, real-time streaming and sharing transcripts are out of scope.

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
- **Size limit**: the feed is bounded to the 1000 tasks with the nearest due dates, so accounts with very many due tasks receive a truncated (nearest-first) feed instead of an unbounded response.
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
    deployments/       # Deployment examples (Docker Compose, Kubernetes)
    specs/             # Application specifications
```

## API

Planner exposes a RESTful API under the `/api/` prefix:

| Endpoint             | Description                                             |
| -------------------- | ------------------------------------------------------- |
| GET /api/status      | Health check endpoint                                   |
| GET /api/statuses    | Get the global, ordered status catalog (any user)       |
| PUT /api/statuses    | Replace the global status catalog (admin only)          |
| POST /api/dictation  | Upload a dictation audio clip and start a job (`projectId` and `targetLanguage` optional) |
| GET /api/dictation/jobs | List the authenticated user's recent dictation jobs |
| GET /api/dictation/:jobId | Poll the state/stage/result of a dictation job; `?wait=1&since=<revision>` long-polls for progressive updates |
| GET /api/dictation/vocabulary | List the caller's custom vocabulary terms |
| POST /api/dictation/vocabulary | Add a vocabulary term (personal or project scope) |
| PUT /api/dictation/vocabulary | Replace one vocabulary scope from a plain-text list |
| DELETE /api/dictation/vocabulary/:id | Delete a vocabulary term owned by the caller |
| GET /api/dictation/preferences | Read the stored dictation preferences (target output language, keep audio) |
| PUT /api/dictation/preferences | Update the target output language and/or the keep-audio preference |
| GET /api/dictation/inbox | List the caller's voice inbox (`limit`, `offset`, `status`, `source`, `includeArchived`) |
| GET /api/dictation/inbox/badge | Unread and processing counts for the navigation badge (`since`) |
| PATCH /api/dictation/inbox/:jobId | Archive or unarchive an inbox job |
| DELETE /api/dictation/inbox/:jobId | Delete a settled inbox job and its kept audio |
| POST /api/dictation/inbox/:jobId/convert | Convert a job into a task, note, task comment or checklist items |
| POST /api/dictation/import | Upload a long recording for chunked transcription, summary and action items |
| GET /api/tasks/:taskId/voice-transcriptions | Latest voice-transcription status per audio attachment |
| POST /api/tasks/:taskId/attachments/:attachmentId/transcribe | Retry a failed or skipped voice transcription |
| GET /api/notifications/preferences | Read the notification preferences (`digest`, `dictation`) |
| PUT /api/notifications/preferences | Update the notification preferences |
| GET /api/users/calendar.ics | ICS calendar feed of the authenticated user's visible task due dates (API key required) |

Additional API endpoints for projects, tasks, notes, and users will be available as the implementation progresses.

## Contributing

Contributions are welcome! Please open issues or pull requests on [GitHub](https://github.com/devopsplaybook-io/planner).
