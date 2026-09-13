# Views

Tasks can be displayed and organized across multiple views.
Each view provides a different perspective on the same task data.

## Available Views

### Dashboard View

- [x] The dashboard shows all the open tasks and the last 5 completed tasks
- [x] The tasks in the dashboard are grouped in sections and the sections are shown in the following order:
  - [x] The overdue tasks
  - [x] The upcoming tasks (due in the next 1 month)
  - [x] Tasks without dates, ordered by priority
  - [x] The last 5 tasks marked as done
- [x] The dashboard can be filtered by project or labels. By default all projects are displayed
- [x] Task status labels on the dashboard use the color configured for the status in the admin Statuses tab

### Calendar View

- [x] Displays tasks on a calendar based on their due dates.
- [x] Allows drag-and-drop to reschedule tasks.
- [x] Each task is displayed with the color configured for its status in the admin Statuses tab.

### Kanban View

- [x] Organizes tasks into columns based on their status.
- [x] Allows drag-and-drop to move tasks between statuses.
- [x] Columns correspond to the project's defined statuses.
- [x] Status labels (column headers and task status badges) use the color configured for the status in the admin Statuses tab.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-13_
