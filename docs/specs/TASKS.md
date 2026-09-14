# Tasks

Tasks are the core unit of work. Each task belongs to exactly one project and has the following attributes:

| Attribute       | Description                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [x] Title       | A short name for the task                                                                                                   |
| [x] Description | A detailed description of the task                                                                                          |
| [x] Checklist   | A list of items that can be marked as done or not done. This checklist is displayed as a list of checkboxes within the task |
| [x] Comments    | Threaded comments on the task                                                                                               |
| [x] Assignees   | Zero, one, or more users assigned to the task                                                                               |
| [x] Status      | One of the statuses selected by the project (from the global catalog, see [ADMIN.md](ADMIN.md))                             |
| [x] Attachments | Files attached to the task                                                                                                  |
| [x] Due date    | The date by which the task should be completed                                                                              |
| [x] Priority    | Importance level of the task                                                                                                |
| [x] Labels      | Zero, one, or multiple labels for categorization                                                                            |
| [x] Project     | The project the task belongs to (exactly one)                                                                               |

## Management of Tasks

[x] Update: when a task is clicked, the task is displayed and the user can edit the task.

[x] Advanced menu: the task dialog offers an advanced menu with Clone, Improve and Delete; delete is no longer a standalone button.

[x] Clone: cloning a task creates a copy with all its info, including attachments and checklist, but not comments; the copy starts in the first status of the project and its dialog opens.

[x] Improve: the LLM rewords the task title and description (fast mode, no reasoning) into the edit form for review; the action is only offered when the LLM settings are configured.

## Visibility

- [x] Tasks inherit the visibility of their project (see [PROJECTS.md](PROJECTS.md)): non-admin users can only list and see tasks from public projects or restricted projects they are a member of; admins see all tasks.
- [x] A task the user cannot see answers 404 on the task API, like a missing task.
- [x] Creating a task requires the target project to be visible to the user; updating, deleting and interacting with a task (comments, assignees, labels, attachments) requires the task to be visible to the user.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-14_
