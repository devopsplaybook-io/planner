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
| [x] Project     | The project the task belongs to (exactly one)                                                                               |

## Management of Tasks

[x] Create: after creating a task, the task dialog opens on the new object.

[x] Update: when a task is clicked, the task is displayed and the user can edit the task.

[x] Advanced menu: the task dialog offers an advanced menu with Clone, Improve and Delete; delete is no longer a standalone button.

[x] Clone: cloning a task creates a copy with all its info, including attachments and checklist, but not comments; the copy starts in the first status of the project and its dialog opens.

[x] Improve: the LLM rewords the task title and description (fast mode, no reasoning) into the edit form for review; the action is only offered when the LLM settings are configured.

[x] Project change: when a task is opened in edit mode, the project can be changed; the target project must be visible to the user; when the current status is not used by the target project, it resets to the target project's first status.

[x] Archived projects (see [PROJECTS.md](PROJECTS.md)) are read-only: tasks in them cannot be created, cloned or updated (including comments, assignees, labels, attachments) and tasks cannot be moved into them; deleting a task is still allowed.

[x] Cancel: the task dialog advanced menu offers Cancel; cancelling moves the task to Done and appends " [cancelled]" to its title; the action is confirmed before applying; it is not offered for Done tasks or tasks in archived projects.

## Task Dialog UX

[x] Comment display: comment headers show relative timestamps with the full date as tooltip and an "(edited)" marker for edited comments; comment actions are visible on touch devices; the per-comment Show more/less disclosure exposes its state with `aria-expanded`; rendered markdown links open in a new tab with `rel="noopener noreferrer"`.

[x] Comment editor: the add and edit comment forms offer a Write/Preview toggle (Preview renders through the same sanitized markdown pipeline as displayed comments), an auto-growing textarea and Ctrl/Cmd+Enter submit; an unsent draft is kept per task/comment in localStorage (distinct add and edit namespaces, restored when reopening, cleared on send, save, cancel or discard).

[x] Comment permalinks: every comment has an anchor and a copy-link action; a `?taskId=…&commentId=…` URL opens the task dialog with the Comments section expanded, scrolled to and briefly highlighting the comment; the parameter is stripped when the dialog closes and unknown ids are ignored; plain `?taskId=` links behave as before.

[x] Long comment threads: with more than 20 comments, only the latest 20 are rendered behind a one-way "Show N earlier comments" expander (deep links force the full thread).

[x] Checklist: items can be deleted (no confirmation, they are trivially re-addable) and the section summary shows a done/total progress bar next to the count badge.

[x] Status and due date: a color chip next to the status select reflects the status color of the global catalog; overdue and due-today due dates are visually emphasized (based on local time, never for Done tasks).

[x] No browser dialogs in task dialog flows: errors surface as an inline dismissible banner and destructive actions use the custom confirmation dialogs instead of `alert()`/`confirm()`.

[x] Section state: the Checklist, Attachments and Comments sections remember their collapsed/expanded state per dialog type in localStorage (graceful degrade to content-based defaults when storage is unavailable).

## Visibility

- [x] Tasks inherit the visibility of their project (see [PROJECTS.md](PROJECTS.md)): non-admin users can only list and see tasks from public projects or restricted projects they are a member of; admins see all tasks.
- [x] A task the user cannot see answers 404 on the task API, like a missing task.
- [x] Creating a task requires the target project to be visible to the user; updating, deleting and interacting with a task (comments, assignees, labels, attachments) requires the task to be visible to the user; changing the project requires the target project to be visible to the user.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-20_
