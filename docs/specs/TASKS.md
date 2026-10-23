# Tasks

Tasks are the core unit of work. Each task belongs to exactly one project and has the following attributes:

| Attribute       | Description                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [x] Title       | A short name for the task                                                                                                   |
| [x] Description | A detailed description of the task                                                                                          |
| [x] Checklist   | A list of items that can be marked as done or not done, and removed. This checklist is displayed as a list of checkboxes within the task |
| [x] Comments    | Flat comments on the task, with markdown rendering, edit and delete                                                         |
| [x] Assignees   | Zero, one, or more users assigned to the task                                                                               |
| [x] Status      | One of the statuses selected by the project (from the global catalog, see [ADMIN.md](ADMIN.md))                             |
| [x] Attachments | Files attached to the task                                                                                                  |
| [x] Due date    | The date by which the task should be completed                                                                              |
| [x] Priority    | Importance level of the task                                                                                                |
| [x] Labels      | Zero, one, or multiple labels for categorization                                                                            |
| [x] Dependencies| Zero, one, or multiple other tasks this task depends on                                                                     |
| [x] Project     | The project the task belongs to (exactly one)                                                                               |

Tasks that used to repeat are now created from task templates (see [TASK_TEMPLATES.md](TASK_TEMPLATES.md)); the per-task recurrence mechanism was removed in 0.70.0.

## Management of Tasks

[x] Create: after creating a task, the task dialog opens on the new object; when no status is provided, the task starts in the project's first status (covers projects whose catalog does not include "To Do").

[x] Update: when a task is clicked, the task is displayed and the user can edit the task.

[x] Labels: labels are free-form strings set at creation and in the task dialog edit mode via the chip editor with autocomplete from existing labels (machine-managed `agent:` and `model:` labels are not suggested there, but remain selectable in the dashboard and notes filters); the editor saves through the labels replace API (`POST /api/tasks/:id/labels`, see Task Label API below).

[x] Advanced menu: the task dialog offers an advanced menu with Clone, Improve and Delete; delete is no longer a standalone button.

[x] Clone: cloning a task creates a copy with all its info, including attachments and checklist, but not comments; the copy starts in the first status of the project and its dialog opens.

[x] Improve: the LLM rewords the task title and description (fast mode, no reasoning) into the edit form for review; the action is only offered when the LLM settings are configured.

[x] Project change: when a task is opened in edit mode, the project can be changed; the target project must be visible to the user; when the current status is not used by the target project, it resets to the target project's first status.

[x] Archived projects (see [PROJECTS.md](PROJECTS.md)) are read-only: tasks in them cannot be created, cloned or updated (including comments, assignees, labels, attachments) and tasks cannot be moved into them; deleting a task is still allowed.

[x] Cancel: the task dialog advanced menu offers Cancel; cancelling moves the task to Done and appends " [cancelled]" to its title; the action is confirmed before applying; it is not offered for Done tasks or tasks in archived projects.

[x] Dependencies: a task can declare zero or multiple dependencies on other tasks (references, not copies); the list is set at creation with task ids and fully replaceable afterwards; each entry exposes the dependency's current title and status alongside its id; dependencies may cross projects (any task visible to the user, in any status including Done); a task cannot depend on itself; deleting either task removes the link; Planner itself does not enforce any flow from dependencies (informational only — consumers like the LLM agent decide what "all dependencies Done" means).

[x] Assignees: assignee ids given at creation and through the assignees API are trimmed, de-duplicated and must reference an existing user; an unknown user answers 400 and the write persists nothing. A task create (with its assignees, labels and dependencies) is transactional: a failing child row leaves no task behind.

[x] Attachments: an upload larger than the configured `ATTACHMENT_MAX_SIZE` answers 413, removes the partial file and records no attachment; a file exactly at the limit is accepted. Successful uploads keep answering 201.

## Task Dialog UX

[x] Comment display: comment headers show relative timestamps with the full date as tooltip and an "(edited)" marker for edited comments; comment actions are visible on touch devices; the per-comment Show more/less disclosure exposes its state with `aria-expanded`; overflowing comments also get an icon-only expand/collapse toggle in the comment actions (chevron up/down, `aria-expanded`/`aria-controls`, kept in sync with the bottom disclosure, which stays); rendered markdown links open in a new tab with `rel="noopener noreferrer"`.

[x] Comment editor: the add and edit comment forms offer a Write/Preview toggle (Preview renders through the same sanitized markdown pipeline as displayed comments), an auto-growing textarea and Ctrl/Cmd+Enter submit; an unsent draft is kept per task/comment in localStorage (distinct add and edit namespaces, restored when reopening, cleared on send, save, cancel or discard).

[x] Comment permalinks: every comment has an anchor and a copy-link action; a `?taskId=…&commentId=…` URL opens the task dialog with the Comments section expanded, scrolled to and briefly highlighting the comment; the parameter is stripped when the dialog closes and unknown ids are ignored; plain `?taskId=` links behave as before.

[x] Long comment threads: with more than 20 comments, only the latest 20 are rendered behind a one-way "Show N earlier comments" expander (deep links force the full thread).

[x] Checklist: items can be deleted (no confirmation, they are trivially re-addable) and the section summary shows a done/total progress bar next to the count badge.

[x] Status and due date: a color chip next to the status select reflects the status color of the global catalog; overdue and due-today due dates are visually emphasized (based on local time, never for Done tasks).

[x] No browser dialogs in task dialog flows: errors surface as an inline dismissible banner and destructive actions use the custom confirmation dialogs instead of `alert()`/`confirm()`.

[x] Section state: the Checklist, Attachments and Comments sections remember their collapsed/expanded state per dialog type in localStorage (graceful degrade to content-based defaults when storage is unavailable).

[x] Dependency removal: in edit mode each dependency row offers a remove button consistent with the checklist delete affordance (revealed on hover and keyboard focus on desktop, always visible on touch, no confirmation); removal applies on save through the same dependency-list replace call.

[x] Dependency links: in display mode each dependency row is a clickable control that opens the dependency task in the same dialog (URL ?taskId= switch, comment permalink param dropped); edit-mode rows stay non-clickable so the unsaved edit form is never discarded; a dependency the user cannot see shows the existing not-available state.


[x] Voice comments: when dictation is enabled and STT is configured (see [DICTATION.md](DICTATION.md)), the add-comment composer offers a record-voice button with a visible recording state (elapsed time, stop/cancel, auto-stop at the maximum duration, inline microphone errors); the finished recording uploads through the regular authenticated attachment API (named `voice-message-…` with the recording's extension) and the audio stays as the attachment; a background transcription posts the polished transcript as a comment without user action. Voice recording is offered on the add-comment composer only — the edit composer, notes and deployments without the feature are unchanged.

[x] Audio attachments: audio files (voice message recordings and other audio attachments) play through an inline player in the task dialog attachments section next to the regular download link; the authenticated blob mechanism keeps the JWT out of attachment URLs.

[x] PDF attachments: PDF files open in a fullscreen inline PDF viewer from the task dialog attachments section (click to open; click-outside or the close button to dismiss) through the same generic viewer mechanism as images and audio; the authenticated blob mechanism keeps the JWT out of attachment URLs. The pages render fit to the viewer width on canvas through the bundled pdf.js renderer and scroll vertically (the browser's built-in viewer cannot render PDFs inside iframes on mobile Chromium); a download button in the viewer downloads the file under its original name.

## Visibility

- [x] Tasks inherit the visibility of their project (see [PROJECTS.md](PROJECTS.md)): non-admin users can only list and see tasks from public projects or restricted projects they are a member of; admins see all tasks.
- [x] A task the user cannot see answers 404 on the task API, like a missing task.
- [x] Creating a task requires the target project to be visible to the user; updating, deleting and interacting with a task (comments, assignees, labels, attachments) requires the task to be visible to the user; changing the project requires the target project to be visible to the user.
- [x] Writes beyond reading also require the user's project permission level (see [PROJECTS.md](PROJECTS.md)): View users get 403 on every write; Comment users can create comments and edit/delete only their own; Update users can create and update tasks including comments, assignees, labels, dependencies, attachments, checklist, status moves and project changes (the target project still must be visible); All users can additionally delete, clone and cancel tasks; admins are unaffected.
- [x] A write below the user's permission level answers 403 with an error naming the required level; invisible projects still answer 404 and archived projects still reject edits with 400 &mdash; reading and visibility behavior are unchanged.

## Task List API

[x] `GET /api/tasks` lists tasks newest first, with all of the task's data (the by-id endpoint `GET /api/tasks/:id` always returns the full shape). Optional query parameters, all composable:
- `projectId` — restrict to one project; `projectIds` — comma-separated subtree restriction.
- `q` — case-insensitive substring matched against title and description.
- `doneSince` — ISO 8601 timestamp; keeps non-Done tasks and Done tasks updated since the cutoff.
- `assigneeUserId` — only tasks assigned to this user, in all statuses.
- `labels` — comma-separated label names; only tasks carrying every listed label are returned.
- `limit` / `offset` — pagination: `limit` defaults to 1000 and is capped at 1000 (larger, non-positive or non-integer values answer 400); `offset` defaults to 0 and must be a non-negative integer.
- [x] `fields` — sparse fieldsets: comma-separated allowlist of top-level task keys (`id`, `projectId`, `title`, `description`, `status`, `priority`, `dueDate`, `checklist`, `assignees`, `comments`, `attachments`, `labels`, `dependencies`, `dateCreated`, `dateUpdated`); unrequested keys are omitted from the response (not sent empty), unknown names are ignored silently, and an absent or `*` value returns the full shape; unrequested child collections (comments, attachments, labels, assignees, dependencies) are not queried server-side.

## Task Label API

- [x] Label names are free-form strings validated on every write (task create, `POST`, `PATCH`): each name is trimmed, must be non-empty and at most 100 characters, and duplicates are dropped preserving the first occurrence; invalid input answers 400. Matching is case-sensitive (the stored case is preserved, `Agent:` and `agent:` are distinct labels).
- [x] `task_labels` enforces one row per `(taskId, name)` through a unique index, so concurrent or duplicate writes cannot create duplicate labels; the migration deduplicates pre-existing rows first.
- [x] `POST /api/tasks/:id/labels` with `{ labels: string[] }` replaces the whole label list in one transaction (used by the UI chip editor) and records a "Labels updated" activity entry. The response is `201 {}`.
- [x] `PATCH /api/tasks/:id/labels` with `{ add?: string[], remove?: string[], quiet?: boolean }` mutates labels atomically in one transaction without touching the other labels and answers `200 { labels, changed }` (the resulting full list). Adds are applied before removes, so a name listed in both ends up removed. The operation is idempotent: when no row is inserted or deleted (`changed: false`) the task is not touched and no activity entry is recorded.
- [x] Both label writes require the task to be visible (404 otherwise) and the project `update` permission (403 otherwise), like the other task sub-resources.
- [x] Quiet mode (`quiet: true`, same permission) skips the "Labels updated" activity entry and the assignee push notification but still touches `dateUpdated` when the label set changes. It is meant for machine-managed labels (the LLM agent's transient `agent:running` state and `model:<model>` provenance) so automation does not flood the update feed or notify assignees.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-10-23_
