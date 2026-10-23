# Task Templates

Task templates are reusable task definitions: a template holds the same content as a task (without status and due date) and can create task instances on demand or automatically on a cron schedule. They replace the per-task recurrence mechanism, which was removed in 0.70.0 (see [TASKS.md](TASKS.md)).

Any user can define templates; the choice of project is limited by the user's permissions.

## Template attributes

| Attribute    | Description                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------- |
| [x] Title    | A short name for the template                                                                     |
| [x] Description | A detailed description of the task the template creates                                        |
| [x] Checklist | A list of items with initial done states, copied into every instance (reset to the template's states) |
| [x] Comments | Flat comments on the template (discussion about the template, not copied into instances)          |
| [x] Assignees | Zero, one, or more users assigned to every created instance                                      |
| [x] Priority | Importance level of the created tasks                                                             |
| [x] Labels   | Zero, one, or multiple labels copied into every instance                                          |
| [x] Attachments | Files attached to the template; their files are copied into every instance                     |
| [x] Project  | The project the template belongs to (exactly one) and in which instances are created              |

## Automation

The **Automation** section is specific to templates (tasks do not have it):

| Setting | Description |
| ------- | ----------- |
| [x] Schedule | A cron expression (validated server-side with node-cron, e.g. `0 0 * * *`); when empty, the template is manual and only creates instances on demand. Cron fires in the server timezone (the container's `TZ`, default UTC): "00:00" means server-local midnight. The UI shows a human-readable label ("Every day at 00:00", "Every Mon, Fri at 00:00", "On day 15 of the month at 00:00") and falls back to the raw expression for unknown shapes |
| [x] Skip if previous instance not done | When enabled and the previous instance still exists in a status other than Done, the scheduled tick creates nothing; when the previous instance was deleted, a new one is created |
| [x] Add the date to the title | When enabled, every created instance's title gets a " YYYY.MN.DD" suffix (zero-padded creation date in the server timezone, e.g. "Report 2026.10.17") |
| [x] Initial status of instances | When set, created instances start in this status instead of the project's first status; the value is validated against the template's project statuses (server-side) and the UI offers the selected project's statuses plus a "Project default" empty option. The UI resets the selection to "Project default" when switching to a project that does not have the selected status, and updating a template (e.g. moving it to another project) clears a stored status the target project does not have |
| [x] Serialized scheduling | Refreshes and scheduled ticks of one template are serialized: a refresh cannot re-register a schedule from a stale read after a newer edit, and two overlapping ticks cannot create two instances; the skip-if-previous-not-done rule is unchanged |

## Management of Templates

[x] Templates are managed in the Settings **Task Templates** tab, available to every user (see [USER_INTERFACE.md](USER_INTERFACE.md)); the tab lists the templates of the projects the user can see, alphabetically by title within each project, grouped per project with one group header per project following the update feed's day-header format (the header shows the full project display path). Each card follows the update-feed entry layout — the title on its own line, then the automation chip (schedule label or "Manual"), the chip with the configured initial status when set, the meta counts and the label tags on the subsequent lines; the card carries no project name (the group header does) and no action buttons, and keeps the shared item-card design language (priority accent stripe, icon). Clicking a card opens the template dialog in view mode; the dialog follows the standardized detail-dialog header (icon-only Edit, Save and Cancel buttons, an advanced (…) menu, a close button).

[x] The list offers a project filter (applying to the project's whole subtree, like the other views) and a case-insensitive search over title and description.

[x] Create: the "New template" button opens the dialog in create mode — a form dialog without the advanced menu — offering the project selector (restricted to projects the user may update), title, description, priority, assignees, labels, checklist and the Automation section; the new card appears immediately after creation.

[x] View & update: the template dialog shows the template read-only (markdown description, meta grid, automation block, read-only checklist and the task-style attachment and comment sections); the header pencil opens Edit mode with the same form fields as creation and saving returns to view mode. Editing a template replaces its content, assignees, labels, checklist and automation; the project can be changed to any project the user may update (changing the project clears a configured initial status the target project does not have); changing the automation re-registers the cron job.

[x] Create task: the template dialog's advanced (…) menu offers a "Create task instance" action (hidden below the Update permission on the template's project) that creates one instance immediately and confirms with the created task's title in an inline status message; the instance is a regular task.

[x] Delete: the same advanced (…) menu offers "Delete template" when the user holds the All permission on the template's project; deleting (with confirmation) removes it, its comments, attachments, labels, assignees, run history and stops its cron job; deleting a project deletes its templates the same way (see [PROJECTS.md](PROJECTS.md)).

[x] No browser dialogs in template flows: errors surface as an inline dismissible banner and the delete uses the custom confirmation dialog instead of `alert()`/`confirm()`.

[x] Attachments: templates support the same attachment lifecycle as tasks (upload, download through the authenticated blob mechanism, delete); audio attachments play inline. An upload larger than the configured `ATTACHMENT_MAX_SIZE` answers 413, removes the partial file and records no attachment; a file exactly at the limit is accepted.

[x] Labels and assignees: template labels follow the task label rules (trimmed, non-empty, at most 100 characters, de-duplicated, 400 otherwise) on create and update; assignee ids must reference existing users and an unknown user answers 400 before anything is written.

[x] Comments: templates support the same comment lifecycle as tasks (markdown rendering, edit, delete); the write rules are the template's project permission rules (see Visibility below).

## Instance contents

[x] An instance carries over the template's title (optionally suffixed with the creation date), description, priority, labels, assignees and checklist (with the template's initial done states); it starts in the template's configured initial status when valid, else the project's first status (or "To Do" when the catalog has no statuses) with no due date.

[x] Template attachment files are copied into the instance (each instance owns its copy, so deleting one never affects the other); template comments are not copied.

[x] Every instance creation (scheduled or manual) is recorded in the template's run history with the created task id; the run's status reflects the task's current status (used by the skip rule); run history survives the deletion of the instance task.

[x] Scheduled ticks skip templates whose project is missing or archived; a failed tick never crashes the scheduler.

## Visibility

- [x] Templates inherit the visibility of their project (see [PROJECTS.md](PROJECTS.md)): non-admin users can only list and see templates from public projects or restricted projects they are a member of; admins see all templates; a template the user cannot see answers 404 like a missing template.
- [x] Creating or updating a template (including comments, assignees, labels, checklist, attachments and automation) requires the Update permission on its project; deleting a template requires the All permission; commenting requires the Comment permission, with comment edit/delete restricted to the comment's author and admins; admins are unaffected.
- [x] A write below the user's permission level answers 403 with an error naming the required level; invisible projects still answer 404 and archived projects reject template writes with 400 &mdash; reading and visibility behavior are unchanged.
- [x] The project selector in the create/edit dialog only offers projects the user may update, so the UI never offers a choice the server would reject.

## API

- [x] `GET /api/task-templates` lists templates newest first (visibility-scoped for non-admins); optional composable query parameters: `projectId`, `projectIds` (comma-separated subtree), `q` (case-insensitive substring over title and description), `limit` (default 1000, maximum 1000; a larger, non-positive or non-integer value answers 400) and `offset` (default 0, non-negative integer).
- [x] `POST /api/task-templates`, `GET/PUT/DELETE /api/task-templates/:id` manage templates with the permission rules above.
- [x] `POST /api/task-templates/:id/create-instance` creates one task instance and returns it (201).
- [x] `POST /api/task-templates/:id/comments`, `PUT/DELETE /api/task-templates/:id/comments/:commentId` manage template comments.
- [x] `POST /api/task-templates/:id/attachments`, `GET/DELETE /api/task-templates/:id/attachments/:attachmentId` manage template attachments (uploads stored under the server attachments directory, like task attachments).

## Migration from recurring tasks

[x] On first startup after the upgrade, tasks that still carry a recurrence rule are converted once into task templates in the same project (title with any " [cancelled]" suffix stripped, description, checklist, priority, labels, assignees; comments and attachments stay on the source task); the task keeps its history and dependencies and its recurrence field is cleared.

[x] The legacy rule maps to a cron when it can be expressed exactly (daily, weekly with or without weekday set, monthly by day-of-month, interval 1 — firing at midnight in the server timezone); intervals greater than 1 or unsupported shapes become manual templates (empty schedule); the day-of-month rule clamps to days cron can express.

[x] The conversion seeds the template's run history from the source task only when it is not Done, so "skip if previous not done" starts from the right state; the source task's completion state is preserved.

[x] The migration is transactional per task, isolated (one failing task does not block the others), runs before the scheduler starts, and when no recurring tasks remain it drops the legacy column and records its completion so later startups are no-ops.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-10-23_
