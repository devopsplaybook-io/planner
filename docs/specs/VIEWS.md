# Views

Tasks can be displayed and organized across multiple views.
Each view provides a different perspective on the same task data.

## Available Views

### Dashboard View

- [x] The dashboard shows all the open tasks and the recently completed tasks
- [x] The tasks in the dashboard are grouped in sections and the sections are shown in the following order:
  - [x] The overdue tasks
  - [x] The upcoming tasks (due in the next 1 month)
  - [x] Tasks without dates, ordered by priority
  - [x] The tasks marked as Done within the past 30 days (same window as the Kanban board)
- [x] The dashboard can be filtered by project or labels. By default all projects are displayed
- [x] Task status labels on the dashboard use the color configured for the status in the admin Statuses tab
- [x] The dashboard only includes tasks from projects visible to the current user (see [PROJECTS.md](PROJECTS.md)); admins see all tasks
- [x] Each dashboard section gets an internal vertical scrollbar when its task list is taller than the device height; the cards keep their natural height — the list scrolls instead of being compressed

### History View

- [x] The History page is reachable from a link at the very bottom of the dashboard (no side-menu entry)
- [x] The History page shows a vertical timeline of tasks where each task is displayed as a bar spanning from its creation date to its end (Done tasks end at their last update; open tasks extend to now)
- [x] Each bar shows the task title and its assignees, and uses the color configured for the task status in the admin Statuses tab
- [x] The timeline can be filtered by project; the filter is applied client-side
- [x] The top 10 assignees of the filtered tasks are shown at the top of the page
- [x] The timeline rows are sorted from oldest to newest (by creation date)
- [x] The Gantt area scrolls horizontally (the label column stays fixed) while the page itself never scrolls sideways
- [x] The Gantt width depends on the timeline span: each month of the domain gets a minimum horizontal width, so short spans fill the available width and long spans become scrollable
- [x] The History page is computed client-side from the existing tasks API (no server-side changes); a loading indicator is shown while fetching

### Calendar View

- [x] Displays tasks on a calendar based on their due dates.
- [x] Allows drag-and-drop to reschedule tasks.
- [x] Each task is displayed with the color configured for its status in the admin Statuses tab.

### Kanban View

- [x] Organizes tasks into columns based on their status.
- [x] Allows drag-and-drop to move tasks between statuses.
- [x] Columns correspond to the project's defined statuses.
- [x] Status labels (column headers and task status badges) use the color configured for the status in the admin Statuses tab.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-15_
