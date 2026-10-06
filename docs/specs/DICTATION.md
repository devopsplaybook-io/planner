# Dictation

## Overview

Planner offers advanced voice dictation: the user dictates from a global mic button, the audio is recorded in the browser and transcribed by a speech-to-text engine, an LLM polishes the transcript, and a second LLM call proposes follow-up actions (create tasks or notes). The user reviews everything before anything is created ("the LLM proposes, the user disposes"). Processing is asynchronous with progressive stages in the dialog, and the server is engine-agnostic: it proxies any OpenAI-compatible STT endpoint.

## Functional Requirements

### Server

- [x] Dictation can be enabled or disabled via configuration (disabled by default).
- [x] Speech-to-text uses any OpenAI-compatible transcription endpoint, configured with a base URL, an API key and a model name.
- [x] `POST /api/dictation` accepts an authenticated multipart audio upload:
  - [x] Only audio MIME types are accepted and oversized uploads are rejected.
  - [x] The endpoint is rate-limited per user.
  - [x] It returns 202 with a job id and processes the dictation in the background; only one job may run at a time per user.
  - [x] The audio is deleted immediately after transcription — no audio is ever persisted or logged.
- [x] The background pipeline runs three stages:
  - [x] Stage A: transcription of the recorded audio by the configured STT engine.
  - [x] Stage B: the transcript is polished by the LLM (punctuation, casing, wording, light markdown), keeping the original language and meaning.
  - [x] Stage C: a second LLM call proposes follow-up actions (`create_task` or `create_note`), strictly schema-validated and clamped to at most 5 actions.
- [x] `GET /api/dictation/:jobId` returns the job status, current stage and result for polling; each user can only see their own jobs and jobs live in memory with a limited time-to-live.
- [x] Failures are graceful: an STT failure is surfaced to the client for retry; a polish or actions LLM failure falls back to the raw transcript and skips action proposals.
- [x] The dictation language can be set per request (`auto` by default, meaning engine-side detection; explicit languages are forwarded to the STT engine).
- [x] Transcript and audio content are never logged.

### Server — Embedded STT mode

- [x] Speech-to-text can alternatively run embedded in the planner service itself (`STT_MODE=embedded`) with a bundled whisper.cpp engine; the default mode stays `external` and existing deployments behave identically until they opt in.
- [x] In embedded mode the engine does not run by default: nothing engine-related is resident between dictations, a short-lived transcription process runs only while a dictation is being transcribed and shuts down right after.
- [x] The embedded model (`STT_EMBEDDED_MODEL`, `ggml-base` by default) is downloaded once on first use into the persistent data directory and reused afterwards; a corrupted model file can be deleted to trigger a fresh download.
- [x] Embedded transcriptions run one at a time; the uploaded audio is decoded to the engine's expected format before transcription and the decoded file is deleted immediately after.
- [x] In embedded mode, STT is considered configured when the embedded model is set; the web UI's dictation availability logic keeps working without changes.
- [x] The embedded model name and audio content are never logged.

### Web

- [x] A global dictation button in the navigation opens the dictation dialog (hidden when the feature is disabled, disabled with a tooltip when STT is not configured or the app is offline).
- [x] The dialog records the user's voice in the browser (MediaRecorder, elapsed timer, visible recording state, auto-stop at the maximum duration).
- [x] The dialog shows progressive processing stages (transcribing, improving text, finding actions) and resumes polling when closed and reopened mid-processing.
- [x] The review step shows the polished text (editable) and the raw transcript (collapsible), plus action proposal cards (include checkbox, editable title and text).
- [x] Task proposal cards offer a project selector (active projects only, shared project selection component) and a status selector listing the selected project's statuses; changing the project resets an incompatible status to the target project's first status; note proposals and "Save as note" keep using the default project.
- [x] On confirm, the client creates the confirmed tasks and note via the existing authenticated APIs; proposals are never executed automatically by the server.
- [x] A dictation language setting is available in the settings page when the feature is enabled.
- [x] Microphone permission denial is reported with a clear message; recording stops cleanly on Escape.

## Implementation Status

`[x]` = Done &ensp; `[~]` = Partial &ensp; `[ ]` = Not Started &ensp; | &ensp; Last spec review: 2026-10-06
