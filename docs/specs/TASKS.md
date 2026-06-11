# Tasks

Tasks are the core unit of work. Each task belongs to exactly one project and has the following attributes:

| Attribute       | Description                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [x] Title       | A short name for the task                                                                                                   |
| [x] Description | A detailed description of the task                                                                                          |
| [x] Checklist   | A list of items that can be marked as done or not done. This checklist is displayed as a list of checkboxes within the task |
| [x] Comments    | Threaded comments on the task                                                                                               |
| [x] Assignees   | Zero, one, or more users assigned to the task                                                                               |
| [x] Status      | One of the project's defined statuses                                                                                       |
| [x] Attachments | Files attached to the task                                                                                                  |
| [x] Due date    | The date by which the task should be completed                                                                              |
| [x] Priority    | Importance level of the task                                                                                                |
| [x] Labels      | Zero, one, or multiple labels for categorization                                                                            |
| [x] Project     | The project the task belongs to (exactly one)                                                                               |

## Management of Tasks

[x] Update: when a task is clicked, the task is displayed and the user can edit the task.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-06-10_
