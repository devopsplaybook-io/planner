# Dictation

## Overview

Planner offers advanced voice dictation: the user dictates from a global mic button, the audio is recorded in the browser and transcribed by a speech-to-text engine, an LLM polishes the transcript, and a second LLM call proposes follow-up actions (create tasks or notes). The user reviews everything before anything is created ("the LLM proposes, the user disposes"). Processing is asynchronous with progressive results and stage timings, and the server supports two STT engines: any OpenAI-compatible endpoint (`STT_MODE=external`) or a bundled whisper.cpp engine (`STT_MODE=embedded`).

## Functional Requirements

### Server

- [x] Dictation can be enabled or disabled via configuration (disabled by default).
- [x] Speech-to-text uses any OpenAI-compatible transcription endpoint, configured with a base URL, an API key and a model name.
- [x] `POST /api/dictation` accepts an authenticated multipart audio upload:
  - [x] Only audio MIME types are accepted; the body is streamed and aborted as soon as it exceeds the configured upload limit, so an oversized upload is rejected with `413` (`DICTATION_MAX_UPLOAD_MB`) without buffering it in memory.
  - [x] When dictation is disabled or STT is not configured, the endpoint answers 404 (`Dictation Not Available`) instead of accepting a job that could never be processed.
  - [x] The endpoint is rate-limited per user (hourly voice quota shared with voice-comment transcriptions).
  - [x] It returns 202 with a job id and processes the dictation in the background; only one job may run at a time per user.
  - [x] The audio is deleted immediately after transcription — no audio is ever persisted or logged.
- [x] The background pipeline runs three stages progressively:
  - [x] Stage A: transcription of the recorded audio by the configured STT engine. The raw transcript becomes available as soon as it exists.
  - [x] Stage B: the transcript is polished by the LLM (punctuation, casing, wording, light markdown), keeping the original language and meaning. The polished text replaces the raw text when it arrives.
  - [x] Stage C: a second LLM call proposes follow-up actions (`create_task` or `create_note`), strictly schema-validated and clamped to at most 5 actions. Actions become available without blocking the raw/polished text.
  - [x] `max_tokens` for the polish and action calls scales with the transcript length instead of using a small fixed constant, so long recordings are not truncated.
- [x] Dictation jobs are persisted in the database (`dictation_jobs` table, SQLite and PostgreSQL migrations) with their status, stage, result, availability flags, timings and a monotonically increasing revision.
  - [x] Job state survives a restart: a job interrupted by a restart is reported as an `INTERRUPTED` error after startup instead of hanging forever; the audio was deleted before the restart.
  - [x] A per-user in-flight job is recovered from the database, so duplicate uploads still answer 409 with the existing job id.
  - [x] Expired jobs are purged after their TTL by the periodic maintenance job.
- [x] `GET /api/dictation/:jobId` returns the job view (`status`, `stage`, `engine`, `language`, `revision`, `result`, `availability`, `timings`, `engineState`, `error`); each user can only see their own jobs.
  - [x] `?wait=1&since=<revision>` long-polls up to 25 s server-side and returns as soon as a newer revision exists (or the timeout elapses), so the client receives progressive updates without a 1.5 s polling burst.
  - [x] Unknown or expired jobs answer 404 with a machine-readable error, which the web client maps to "this dictation expired".
- [x] `GET /api/dictation/jobs?limit=&source=` lists the user's recent jobs (default 20) for the "recent dictations" panel, optionally filtered by source (`dictation` or `voice_comment`).
- [x] Failures are graceful: an STT failure is surfaced to the client for retry; a polish or actions LLM failure falls back to the raw transcript and skips action proposals; a recording with no detectable speech after trimming is reported as `NO_SPEECH`.
- [x] The dictation language can be set per request (`auto` by default, meaning engine-side detection; explicit languages are forwarded to the STT engine); the accepted language list comes from `DICTATION_LANGUAGES`.
- [x] Per-stage timings (`queueMs`, `sttMs`, `polishMs`, `actionsMs`, `totalMs`, `audioDurationMs`) are stored with the job and exported as OpenTelemetry span attributes and metrics; transcript, audio and prompt content are never exported or logged.

### Server — Embedded STT mode

- [x] Speech-to-text can alternatively run embedded in the planner service itself (`STT_MODE=embedded`) with a bundled whisper.cpp engine; the default mode stays `external` and existing deployments behave identically until they opt in.
- [x] In embedded mode the engine does not stay resident between dictations: a short-lived `whisper-cli` process runs only while a dictation is being transcribed and exits right after.
- [x] The embedded model (`STT_EMBEDDED_MODEL`, `ggml-base` by default) is pre-downloaded asynchronously at startup (`.part` file then rename, retried with backoff); the HTTP server starts immediately and the model download never blocks readiness.
  - [x] While a download is running the engine reports a `preparing` state through `GET /api/status/config` and the dictation job view; the web UI shows "Preparing speech engine…" instead of failing.
  - [x] Leftover `.part` files from an interrupted download are removed at startup; a corrupted model can be deleted to trigger a fresh download.
  - [x] The status endpoint also reports the selected model and the estimated RTF so the web UI can show an ETA.
- [x] Embedded transcriptions run one at a time; the upload is decoded to 16 kHz mono PCM and—when `STT_EMBEDDED_TRIM_SILENCE` is enabled (default)—leading and trailing silence is removed before transcription. A recording whose trimmed audio is shorter than 300 ms is reported as "no speech detected" instead of being sent to the engine.
- [x] The whisper-cli thread count follows the effective cgroup CPU limit (`STT_EMBEDDED_THREADS`, capped at 4) instead of a hardcoded value; the effective CPU count and thread count are logged at startup.
- [x] In embedded mode, STT is considered configured when the embedded model is set; the web UI's dictation availability logic keeps working without changes.
- [x] The embedded model name, audio content and transcripts are never logged.

### Server — Voice-comment transcriptions

- [x] When an audio attachment is uploaded to a task and dictation is enabled with STT configured, the server queues a background transcription (dictation STT + polish stages, no action proposals).
- [x] `GET /api/tasks/:taskId/voice-transcriptions` returns the latest status per audio attachment (`status`: `processing`/`done`/`error`/`skipped`, `stage`, `error`, timestamps), so the task dialog can show progress after a reload.
- [x] `POST /api/tasks/:taskId/attachments/:attachmentId/transcribe` retries a failed or skipped transcription (`202`), returning `409` when one is already in flight, `429` when the hourly voice quota is exhausted and `503` when dictation/STT is not configured.
- [x] The transcript is posted as a task comment attributed to the uploading user and referencing the voice message file name; a failed transcription never fails the upload and never deletes the audio.
- [x] Transcripts are corrected by editing the generated comment: there is no separate "edit transcript" API.

### Web

- [x] A global dictation button in the navigation opens the dictation dialog (hidden when the feature is disabled, disabled with a tooltip when STT is not configured or the app is offline, or while the engine is preparing).
- [x] The dialog records the user's voice in the browser (MediaRecorder, elapsed timer, visible recording state, auto-stop at the maximum duration); reaching the maximum duration stops the recording and submits the captured audio exactly like a manual stop (never discarded), and the recorder is stopped before the microphone is released so the end of the audio is not truncated.
- [x] The recording limit, upload limit, default language and language list come from `GET /api/status/config` instead of hardcoded values; the web build keeps safe defaults when the endpoint is unreachable.
- [x] The dialog shows progressive processing stages and opens the review as soon as the raw transcript is available: the raw text can be reviewed and edited while the polish and action stages finish.
  - [x] The review textarea is only patched by the polished text while the user has not edited it; after an edit, an explicit "Use polished text" action applies the polished version instead of overwriting the edit.
  - [x] Action proposals are appended once they become available, without discarding edits made to the text or to existing cards.
  - [x] Stage timings are summarized in the review ("Transcribed in X s · Improved in Y s · Actions in Z s").
- [x] The review step shows the polished text (editable) and the raw transcript (collapsible), plus action proposal cards (include checkbox, editable title and text).
- [x] Task proposal cards offer a project selector (active projects only, shared project selection component) and a status selector listing the selected project's statuses; changing the project resets an incompatible status to the target project's first status; note proposals and "Save as note" keep using the default project.
- [x] On confirm, the client creates the confirmed tasks and note via the existing authenticated APIs; proposals are never executed automatically by the server.
- [x] Failures when creating the selected items or saving the review text as a note are shown in an inline dismissible banner in the dialog (never a browser `alert()`).
- [x] A "recent dictations" list opens a previous job in the dialog, so an interrupted review can be found again after a reload.
- [x] The dictation language setting (settings page and the dialog selector) is populated from the server configuration and persisted locally.
- [x] Microphone permission denial is reported with a clear message; recording stops cleanly on Escape.
- [x] A dictation with no usable speech is reported as "no speech detected" with a retry hint instead of an empty review.
- [x] The web client long-polls the job endpoint (30 s client timeout, `wait=1&since=<revision>`) and falls back to short polling when the long poll fails, instead of a fixed 1.5 s burst.

### Voice comments on tasks

- [x] The task comment composer offers a record-voice button when dictation is enabled and STT is configured (shared availability logic with the dictation dialog); recording state with elapsed time, stop and cancel, auto-stop at the maximum duration (which uploads the recording), and microphone errors surfaced inline. Cancelling discards the audio, settles any stop already in flight and leaves no pending stop behind; stopping and cancelling are idempotent.
- [x] The composer offers the configured dictation languages and sends the selected language with the recording.
- [x] A finished recording uploads through the authenticated task attachment API with the selected language; the audio file itself is kept as a regular task attachment (the voice message the user keeps).
- [x] Each audio attachment in the task dialog shows its transcription status (Transcribing…/Finishing transcript…/Transcript ready/Transcription failed/Transcription skipped) and a Retry action for failed or skipped jobs.
- [x] The task dialog polls the transcription statuses every 3 s only while a transcription is processing and the dialog is open, and stops when the dialog closes or the task changes.
- [x] Retry failures are surfaced inline (409 "already running", 429 hourly limit, 503 STT unavailable) without failing the dialog.
- [x] Audio attachments play through an inline audio player in the task dialog and the server serves audio files inline with proper audio content types.
- [x] Without dictation enabled or STT configured, nothing changes: no record button in the composer and no background transcription.
- [x] Voice comments apply to tasks only; notes keep their existing comment and attachment behavior.

### Operations

- [x] Dictation and voice-comment work is instrumented with OpenTelemetry spans and metrics (decode, STT, polish, actions, queue and total durations, job outcome, threads, model, engine); no audio/transcript/prompt content is exported.
- [x] A repeatable benchmark harness (`planner-server/src/dictation/bench/BenchStt.ts`, `npm run bench:stt`) measures RTF, p50/p95 latency, peak RSS and optional WER for the production flags; results and model selection are documented in [`docs/dictation-benchmark.md`](../dictation-benchmark.md).
- [x] The reference deployment runs the embedded engine with 2 CPU / 2 GiB limits (250m / 512Mi requests), sized from the benchmark.
- [ ] Lazy action proposals (deferring stage C until the review is opened) are deferred: progressive raw → polished → actions delivery already keeps actions off the critical path.

## Implementation Status

`[x]` = Done &ensp; `[~]` = Partial &ensp; `[ ]` = Not Started &ensp; | &ensp; Last spec review: 2026-11-07
