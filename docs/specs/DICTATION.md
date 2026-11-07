# Dictation

## Overview

Planner offers advanced voice dictation: the user dictates from a global mic button, the audio is recorded in the browser and transcribed by a speech-to-text engine, an LLM polishes the transcript, and a second LLM call proposes follow-up actions (create tasks or notes). The user reviews everything before anything is created ("the LLM proposes, the user disposes"). Processing is asynchronous with progressive results and stage timings, and the server supports two STT engines: any OpenAI-compatible endpoint (`STT_MODE=external`) or a bundled whisper.cpp engine (`STT_MODE=embedded`).

Accuracy and trust features sit on top of that pipeline: a per-user and per-project custom vocabulary biases both STT engines, embedded jobs expose per-segment confidence so the review can highlight uncertain words, the review offers a word-level raw-versus-polished comparison with explicit actions, an optional target output language can translate the polished text, and the UI states exactly what is retained.

## Functional Requirements

### Server

- [x] Dictation can be enabled or disabled via configuration (disabled by default).
- [x] Speech-to-text uses any OpenAI-compatible transcription endpoint, configured with a base URL, an API key and a model name.
- [x] `POST /api/dictation` accepts an authenticated multipart audio upload:
  - [x] Only audio MIME types are accepted; the body is streamed and aborted as soon as it exceeds the configured upload limit, so an oversized upload is rejected with `413` (`DICTATION_MAX_UPLOAD_MB`) without buffering it in memory.
  - [x] When dictation is disabled or STT is not configured, the endpoint answers 404 (`Dictation Not Available`) instead of accepting a job that could never be processed.
  - [x] The endpoint is rate-limited per user (hourly voice quota shared with voice-comment transcriptions).
  - [x] It returns 202 with a job id and processes the dictation in the background; only one job may run at a time per user.
  - [x] An optional `source` field distinguishes the origin of the job: `dictation` (the full dialog, default) or `inline` (a text-surface microphone). Unknown values fall back to `dictation`; the source is persisted with the job and exported only as a telemetry attribute.
  - [x] An optional `projectId` field scopes the dictation to a visible project: it selects the project vocabulary and is validated with the usual project visibility rules (`404` deletes the temporary audio when the project is missing or invisible).
  - [x] An optional `targetLanguage` field sets the output language of the polish stage: absent → the caller's stored preference; `""`, `none` or `off` → translation explicitly off (overriding the stored preference); an unknown language → `400`.
  - [x] The single-flight rule is shared by dialog and inline jobs, so starting a second dictation answers 409 with the running job id instead of transcribing two recordings at once.
  - [x] The audio is deleted immediately after transcription — no audio is ever persisted or logged.
- [x] Custom vocabulary biases transcription (see below); project terms come first, then personal terms, and are composed into a prompt that is passed to the STT engine for both dialog and inline jobs.
- [x] Embedded jobs expose per-segment confidence (see below); the job view reports it alongside the transcript without changing the plain text for older clients.
- [x] The background pipeline runs three stages progressively:
  - [x] Stage A: transcription of the recorded audio by the configured STT engine. The raw transcript becomes available as soon as it exists.
  - [x] Stage B: the transcript is polished by the LLM (punctuation, casing, wording, light markdown), keeping the original language and meaning. The polished text replaces the raw text when it arrives.
  - [x] Stage C: a second LLM call proposes follow-up actions, strictly schema-validated against action schema v2 and clamped to at most 10 actions. Actions become available without blocking the raw/polished text.
  - [x] Action schema v2 supports `create_task`, `create_note`, `update_task`, `append_to_task`, `append_to_note`, `add_comment`, `add_checklist_items` and `instantiate_template`; `create_multiple` is flattened into individual actions, and `update_task`/`append_to_*` carry an explicit target. Proposals never include deletion or archiving.
  - [x] `max_tokens` for the polish and action calls scales with the transcript length instead of using a small fixed constant, so long recordings are not truncated.
- [x] Dictation jobs are persisted in the database (`dictation_jobs` table, SQLite and PostgreSQL migrations) with their status, stage, result, availability flags, timings and a monotonically increasing revision.
  - [x] Job state survives a restart: a job interrupted by a restart is reported as an `INTERRUPTED` error after startup instead of hanging forever; the audio was deleted before the restart.
  - [x] A per-user in-flight job is recovered from the database, so duplicate uploads still answer 409 with the existing job id.
  - [x] Expired jobs are purged after their TTL by the periodic maintenance job.
- [x] `GET /api/dictation/:jobId` returns the job view (`status`, `stage`, `engine`, `language`, `targetLanguage`, `revision`, `result` — including optional `segments` —, `availability`, `timings`, `engineState`, `error`); each user can only see their own jobs.
  - [x] `?wait=1&since=<revision>` long-polls up to 25 s server-side and returns as soon as a newer revision exists (or the timeout elapses), so the client receives progressive updates without a 1.5 s polling burst.
  - [x] Unknown or expired jobs answer 404 with a machine-readable error, which the web client maps to "this dictation expired".
- [x] `GET /api/dictation/jobs?limit=&source=` lists the user's recent jobs (default 20) for the "recent dictations" panel, optionally filtered by source (`dictation`, `voice_comment` or `inline`).
- [x] Failures are graceful: an STT failure is surfaced to the client for retry; a polish or actions LLM failure falls back to the raw transcript and skips action proposals; a recording with no detectable speech after trimming is reported as `NO_SPEECH`.
- [x] The dictation language can be set per request (`auto` by default, meaning engine-side detection; explicit languages are forwarded to the STT engine); the accepted language list comes from `DICTATION_LANGUAGES`.
- [x] Per-stage timings (`queueMs`, `sttMs`, `polishMs`, `actionsMs`, `totalMs`, `audioDurationMs`) are stored with the job and exported as OpenTelemetry span attributes and metrics; transcript, audio and prompt content are never exported or logged.

### Server — Custom vocabulary, confidence and translation

- [x] A `dictation_vocabulary` table (migration `init-0027.sql`, SQLite and PostgreSQL) stores terms per user and optionally per project, with a case-insensitive unique constraint per scope (stored normalized term) and cascade cleanup when the user or project is deleted.
- [x] Authenticated CRUD API scoped to the caller:
  - [x] `GET /api/dictation/vocabulary` lists the caller's terms (`id`, `term`, `projectId`, `dateCreated`).
  - [x] `POST /api/dictation/vocabulary` adds a term: `400` for empty/invalid input or when `DICTATION_VOCABULARY_MAX` (default 200) is reached, `404` for a missing/invisible project, `409` for a case-insensitive duplicate in the same scope.
  - [x] `PUT /api/dictation/vocabulary` replaces one scope from a plain-text list: trims, drops empty lines and dedupes, answers `400` when the user total would exceed the stored limit.
  - [x] `DELETE /api/dictation/vocabulary/:id` answers `204`, or `404` when the term is not owned by the caller.
- [x] Prompt composition takes project terms first, then personal terms, dedupes case-insensitively, strips newlines/control characters and caps the result at `DICTATION_HOTWORDS_MAX` (default 50) terms and a hard character limit.
- [x] The composed prompt biases both engines: whisper.cpp receives it through `--prompt`, external OpenAI-compatible endpoints receive it as the `prompt` form field; when an external endpoint rejects `prompt` (`400`/`422`) the transcription is retried once without it, so vocabulary can never break a previously working endpoint.
- [x] Vocabulary terms, prompts and transcripts are never logged or exported; only aggregate counters (`hotwords.count`, `segments.count`, `low_confidence.count`) reach telemetry.
- [x] Embedded STT requests full JSON from `whisper-cli` (`-ojf -of <base>`) and derives optional `segments: [{ text, fromMs, toMs, confidence }]` by averaging usable token probabilities (clamped to 0..1, `null` when no usable token), capped in count; a missing or malformed JSON file yields `segments: null` and never fails the job, while the plain stdout transcript is unchanged for existing clients.
- [x] External jobs report `segments: null`; the review degrades gracefully without confidence.
- [x] `GET/PUT /api/dictation/preferences` store the optional target output language in `users.dictationTargetLanguage` (a preference change does not bump `tokenVersion`), validating it against `DICTATION_LANGUAGES`.
- [x] The polish prompt preserves proper nouns, product names and technical terms exactly, keeps every part of mixed-language input in its original language, and only adds translation instructions when a target language differs from the source.

### Server — Structured action proposals, apply/undo and read-only ask

- [x] `POST /api/dictation/:jobId/actions/preview` resolves every proposed action against the caller's data and returns one preview per action: `status` (`resolved`, `ambiguous` or `unresolved`), the resolved target, ambiguity `candidates` (projects, tasks, notes, templates), a field-level `diff` for updates, and a human-readable `error`. Resolution re-checks project visibility and write permissions server-side; proposals are never applied during preview.
- [x] `POST /api/dictation/:jobId/actions/apply` applies a user selection (`index` plus optional `title`, `description`, `projectId`, `status`, `targetId`) with a client `requestId`. Only allowlisted override fields are merged; unknown fields are ignored and selections are deduped/capped at `MAX_ACTIONS`.
  - [x] Apply is idempotent per `(jobId, requestId, actionIndex)`: a retried request returns the stored outcome instead of applying twice (`dictation_job_actions` table, migration `init-0028.sql`, SQLite and PostgreSQL).
  - [x] Each action applies independently and reports `applied`, `failed` or `skipped`, so one failure does not roll back the others. The apply snapshots (`beforeJson`) are stored for undo and never exposed through the API.
  - [x] Undo (`POST /api/dictation/:jobId/actions/undo`) reverts the caller's applied actions newest-first, skips already-undone rows and reports per-action results; an action whose target changed after apply is reported as failed rather than partially reverted.
- [x] `POST /api/dictation/ask` answers a read-only question (max 500 characters, optional project scope). Deterministic intents (`due_today`, `due_this_week`, `project_summary`, `recent_dictations`) are computed from visible tasks, projects and the caller's dictations; the answer lists linked items and a `truncated` flag.
  - [x] An optional LLM rephrase runs with a strict timeout and strict JSON validation; any failure falls back to the deterministic answer. Ask never writes data and never proposes actions.
  - [x] Asking is advertised through `/api/status/config` (`ask: true`); when disabled or unsupported the endpoint answers 404.
- [x] Per-user custom command phrases (`dictation_phrases` table, migration `init-0028.sql`) map one spoken prefix to exactly one project XOR template, with optional labels; a normalized form backs case/whitespace-insensitive uniqueness per user.
  - [x] `GET/POST/PUT/DELETE /api/dictation/phrases` manage the caller's phrases: `400` for invalid input, `404` for a missing/invisible project or template, `409` for a duplicate normalized phrase and `400` when `DICTATION_PHRASES_MAX` (default 50) is reached.
  - [x] Matching is deterministic and runs before the LLM: the longest normalized phrase matching at a word boundary wins, and the remainder of the dictation becomes the task title/description or template instance input. Phrase text and matched content are never logged or exported.
- [x] `/api/status/config` advertises the capability set for older/newer clients: `actionSchema: 2`, `applyActions: true`, `ask: true` and `phrasesMax`. Absent capabilities make the web client use the legacy client-side creation flow.

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
- [x] Voice-comment transcriptions are biased by the task project's vocabulary plus the caller's personal terms; they never translate (the spoken language is kept) so comments stay in the language they were recorded in.

### Web

- [x] A global dictation button in the navigation opens the dictation dialog (hidden when the feature is disabled, disabled with a tooltip when STT is not configured or the app is offline, or while the engine is preparing).
- [x] The dialog records the user's voice in the browser (MediaRecorder, elapsed timer, visible recording state, auto-stop at the maximum duration); reaching the maximum duration stops the recording and submits the captured audio exactly like a manual stop (never discarded), and the recorder is stopped before the microphone is released so the end of the audio is not truncated.
- [x] The recording limit, upload limit, default language and language list come from `GET /api/status/config` instead of hardcoded values; the web build keeps safe defaults when the endpoint is unreachable.
- [x] The dialog shows progressive processing stages and opens the review as soon as the raw transcript is available: the raw text can be reviewed and edited while the polish and action stages finish.
  - [x] The review textarea is only patched by the polished text while the user has not edited it; after an edit, an explicit "Use polished text" action applies the polished version instead of overwriting the edit.
  - [x] Action proposals are appended once they become available, without discarding edits made to the text or to existing cards.
  - [x] Stage timings are summarized in the review ("Transcribed in X s · Improved in Y s · Actions in Z s").
- [x] The review step shows the polished text (editable) and the raw transcript (collapsible), plus action proposal cards (include checkbox, editable title and text).
  - [x] A text-source badge tells which stage produced the current text (`Polished`, `Raw transcript`, `Edited by you`), plus a `Translated to <language>` badge when the job used a target language.
  - [x] When the job exposes low-confidence segments, the review lists at most 20 words below the configured threshold (`DICTATION_CONFIDENCE_THRESHOLD`, default 0.6) with their confidence percentage; clicking one opens a prefilled correction input whose `Apply` replaces the first case-insensitive occurrence in the current text (and marks it edited), while `Add to vocabulary` stores the correction in the personal vocabulary. A not-found correction shows an inline notice instead of failing.
  - [x] "Compare with raw transcript" renders a word-level diff between the raw transcript and the current review text (`<del>`/`<ins>`, side-by-side fallback above 800 tokens), next to explicit `Use polished text` and `Revert to raw` actions. A revert or any edit is never overwritten by a late polish patch.
  - [x] External-engine jobs that carry no confidence show a one-line "Word confidence is not available with the external engine" note, without errors.
- [x] The optional target language is selected in Settings and in the dialog-adjacent configuration, persisted through the server preference (with a local fallback), and applies to dialog and inline dictations; when unset the original language is preserved.
- [x] Settings manages the custom vocabulary: a scope selector (Personal plus visible active projects), term chips with deletion, an add input capped by `DICTATION_VOCABULARY_MAX`, plain-text import ("one term per line", replaces the selected scope), client-side `.txt` export and inline errors/limits.
- [x] Retention is explicit in the UI: the dialog's recording mode says "Audio is deleted right after transcription" and the review repeats it; the comment composer says voice-comment audio is kept as a task attachment that can be deleted.
- [x] Task proposal cards offer a project selector (active projects only, shared project selection component) and a status selector listing the selected project's statuses; changing the project resets an incompatible status to the target project's first status; note proposals and "Save as note" keep using the default project.
- [x] When the server advertises `applyActions`, the review renders the structured previews instead of the legacy cards: one card per proposed action shows its type, resolution badge (`Ready`, `Needs a choice`, `Cannot apply`), target, field-level diff and optional inline error. Resolved actions are selected by default; ambiguous actions become selectable once the user picks one of the proposed matches (project, task, note or template) or overrides the project.
- [x] Cards let the user edit the title/description and override the project and status before applying; overrides are sent with the selection and re-validated server-side. Applying sends one request id, shows per-card results (`Applied`, `Failed`, `Skipped`) and never auto-applies anything the user did not select.
- [x] After an apply, the review offers "Undo applied actions" for the latest batch (newest-first) and a "Done" action; a retry of the same request id is idempotent. When the capability is absent, the legacy client-side creation flow is unchanged.
- [x] When the server advertises `ask`, the review has an Ask tab: a read-only question box with optional project scope, inline dictation for the question, loading/error states and an answer with linked items plus a "Computed from your data" / "Rephrased by AI" source line and a truncation hint. The tab is hidden when the capability is absent.
- [x] Settings manages custom command phrases: a list with project/template targets and labels, an add form (project or template target, optional comma-separated labels) capped by `phrasesMax`, deletion and inline errors; the editor explains that a phrase applies deterministically before the AI.
- [x] On confirm, the client applies the selected structured actions server-side, or—when the server does not advertise `applyActions`—creates the confirmed tasks and note via the existing authenticated APIs; proposals are never executed automatically by the server.
- [x] Failures when creating the selected items or saving the review text as a note are shown in an inline dismissible banner in the dialog (never a browser `alert()`).
- [x] A "recent dictations" list opens a previous job in the dialog, so an interrupted review can be found again after a reload.
- [x] The dictation language setting (settings page and the dialog selector) is populated from the server configuration and persisted locally.
- [x] Microphone permission denial is reported with a clear message; recording stops cleanly on Escape.
- [x] A dictation with no usable speech is reported as "no speech detected" with a retry hint instead of an empty review.
- [x] The web client long-polls the job endpoint (30 s client timeout, `wait=1&since=<revision>`) and falls back to short polling when the long poll fails, instead of a fixed 1.5 s burst.
- [x] `GET /api/status/config` advertises `dictation.inlineJobs: true` when the server supports inline jobs; older servers leave it absent and the web client keeps every inline microphone hidden.

### Inline dictation

- [x] A reusable inline dictation control (composable + button component) sits next to every text field where free text is entered: task create (title, description, every checklist item), task edit (title, description), note create (title, content), note edit (title, content), task template create/edit (title, description) and the comment composer textarea.
- [x] The control records with the same recorder and limits as the dialog, submits the audio to `POST /api/dictation` with `source=inline`, and long-polls its own job without touching the dialog's job state. Hosts that belong to a project pass its id, so project vocabulary biases the transcription; the comment composer has no project id and relies on personal terms (voice comments use the task project server-side).
- [x] Inline dictations use the persisted target output language: the host can explicitly turn translation off, while the default follows the stored preference.
- [x] The raw transcript is inserted as soon as it arrives, at the caret captured when recording started (replacing the active selection). The polished text replaces that exact range only while the field still holds the untouched insertion; after any user edit the control offers "Use improved text" instead of overwriting the edit.
- [x] Insertion uses `document.execCommand("insertText")` when available so a single native undo restores the field to its state before dictation; the `setRangeText` fallback and the polish patch still fire input events so form state and `v-model` stay in sync. A single separator space is added only when the caret sits between two non-whitespace characters.
- [x] Deterministic client-side formatting turns spoken commands into layout without an LLM round-trip: "new line", "new paragraph", "bullet"/"bullet point", "comma", "period", "question mark" and "scratch that" (removing the last dictated segment).
- [x] Explicit stop and cancel; cancelling discards the recording and no job is submitted. Auto-stop at the maximum duration submits the captured audio exactly like a manual stop.
- [x] While recording, Enter never submits the surrounding form and Escape cancels; a Ctrl/Cmd+Alt+D shortcut starts or stops dictation when the field is focused, and touch pointers support hold-to-talk (release stops). The control exposes `aria-label`/`aria-pressed`, a polite live status (elapsed time, transcribing, transcript ready) and an `alert` error region.
- [x] Failures stay inline next to the field: microphone permission, unsupported browser/offline, no speech detected, expired job and the 409 "a dictation is already running" case, each dismissible without losing the field content.
- [x] The dictation language selector uses the configured languages and persists the choice in `dictation-language`, shared with the dialog.
- [x] Leaving or hiding the field while a job runs never steals the caret: the transcript is kept and offered through an explicit "Insert transcript" action when the user returns to the control. A running inline job can be promoted to the full dictation dialog ("Review in dictation") without submitting a duplicate upload.
- [x] Inline dictation is hidden when dictation is disabled, STT is not configured, the browser cannot record, the server does not advertise inline jobs, or the host field is in a disabled/busy state.
- [x] Inline jobs are exported with `source=inline` in telemetry; transcript and audio content are never logged or exported.

### Voice comments on tasks

- [x] The task comment composer offers a record-voice button when dictation is enabled, STT is configured and the server advertises inline jobs (shared availability logic with the inline control); recording state with elapsed time, stop and cancel, auto-stop at the maximum duration (which submits the recording), and microphone errors surfaced inline. Cancelling discards the audio, settles any stop already in flight and leaves no pending stop behind; stopping and cancelling are idempotent.
- [x] The composer offers the configured dictation languages and sends the selected language with the recording.
- [x] A finished recording uploads through the authenticated task attachment API with the selected language and `?transcribe=0`, so the audio stays a regular task attachment without starting a second transcription job; the same audio is submitted to the inline dictation API (`source=inline`). The progressive transcript (raw, then polished while untouched) is inserted into the composer textarea, where the user can review and edit it; sending posts exactly one normal comment, with the usual activity-feed entry and assignee notification.
- [x] An attachment upload failure is shown inline and never drops the transcript; a dictation failure (permission, no speech, expired job, 409) is surfaced inline as for any inline field. Promoting the running job to the dictation dialog does not upload a duplicate.
- [x] Existing audio attachments (uploaded with background transcription) keep their transcription status shown in the task dialog and the Retry action.
- [x] The task dialog polls the transcription statuses every 3 s only while a transcription is processing and the dialog is open, and stops when the dialog closes or the task changes.
- [x] Retry failures are surfaced inline (409 "already running", 429 hourly limit, 503 STT unavailable) without failing the dialog.
- [x] Audio attachments play through an inline audio player in the task dialog and the server serves audio files inline with proper audio content types.
- [x] Without dictation enabled or STT configured, nothing changes: no record button in the composer and no background transcription.
- [x] Voice comments apply to tasks only; notes keep their existing comment and attachment behavior.

### Operations

- [x] Dictation and voice-comment work is instrumented with OpenTelemetry spans and metrics (decode, STT, polish, actions, queue and total durations, job outcome, threads, model, engine); no audio/transcript/prompt content is exported.
- [x] Structured preview/apply/undo, ask and custom phrases emit counters and spans with metadata only (action type, status, intent, counts); transcript, question, answer and phrase content are never logged or exported.
- [x] A repeatable benchmark harness (`planner-server/src/dictation/bench/BenchStt.ts`, `npm run bench:stt`) measures RTF, p50/p95 latency, peak RSS and optional WER for the production flags; results and model selection are documented in [`docs/dictation-benchmark.md`](../dictation-benchmark.md).
- [x] The reference deployment runs the embedded engine with 2 CPU / 2 GiB limits (250m / 512Mi requests), sized from the benchmark.
- [ ] Lazy action proposals (deferring stage C until the review is opened) are deferred: progressive raw → polished → actions delivery already keeps actions off the critical path.

## Implementation Status

`[x]` = Done &ensp; `[~]` = Partial &ensp; `[ ]` = Not Started &ensp; | &ensp; Last spec review: 2026-11-07
