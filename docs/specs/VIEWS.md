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
- [x] Selecting a project in the dashboard filter includes the project's whole subtree (see [PROJECTS.md](PROJECTS.md)); the search applies the same subtree filter
- [x] The task cards and the task detail dialog show the project's full path (e.g. Home / Parents) instead of the bare name; long paths keep the existing ellipsis truncation with the full text on hover
- [x] The dashboard has a search input that filters tasks dynamically while typing (debounced); the focus highlight applies to the surrounding search box, not to the inner input
- [x] The search covers all tasks, including tasks marked as done
- [x] Search results respect the current project filter and are shown while the search term is active
- [x] Task status labels on the dashboard use the color configured for the status in the admin Statuses tab
- [x] Each task card shows the project name next to the status badge on a single line; when both are too long to fit together they are truncated with an ellipsis (full text on hover)
- [x] The dashboard only includes tasks from projects visible to the current user (see [PROJECTS.md](PROJECTS.md)); admins see all tasks
- [x] Each dashboard section's task-list container has a max-height of 90% of the parent container and scrolls with an internal vertical scrollbar when the tasks exceed it; the cards keep their natural height — the list scrolls instead of being compressed; on mobile (viewport ≤ 767px) the task-list container is capped at 70vh

### History View

- [x] The History page is reachable from a link at the very bottom of the dashboard (no side-menu entry)
- [x] The History page shows a vertical timeline of tasks where each task is displayed as a bar spanning from its creation date to its end (Done tasks end at their last update; open tasks extend to now)
- [x] Each bar shows the task title and its assignees, and uses the color configured for the task status in the admin Statuses tab
- [x] The timeline can be filtered by project; the filter is applied client-side
- [x] Selecting a project in the history filter includes the project's whole subtree (see [PROJECTS.md](PROJECTS.md))
- [x] The top 10 assignees of the filtered tasks are shown at the top of the page
- [x] The timeline rows are sorted from oldest to newest (by creation date)
- [x] The Gantt area scrolls horizontally (the label column stays fixed) while the page itself never scrolls sideways
- [x] The Gantt width depends on the timeline span: each month of the domain gets a minimum horizontal width, so short spans fill the available width and long spans become scrollable
- [x] The task-name column has the same width for every row and never exceeds 30% of the timeline's width; long titles and assignee lists are truncated with an ellipsis
- [x] The History page is computed client-side from the existing tasks API (no server-side changes); a loading indicator is shown while fetching

### Calendar View

- [x] Displays tasks on a calendar based on their due dates.
- [x] Allows drag-and-drop to reschedule tasks.
- [x] Each task is displayed with the color configured for its status in the admin Statuses tab.
- [x] Selecting a project in the calendar filter includes the project's whole subtree (see [PROJECTS.md](PROJECTS.md)).

### Kanban View

- [x] Organizes tasks into columns based on their status.
- [x] Allows drag-and-drop to move tasks between statuses.
- [x] Columns correspond to the project's defined statuses.
- [x] Selecting a project in the kanban filter includes the project's whole subtree (see [PROJECTS.md](PROJECTS.md)); when a project with sub-projects is selected, the columns are the union of the statuses used by the subtree's projects, in the global catalog order, followed by any statuses still present on the tasks that the catalog and the projects do not cover (dangling-status safety net).
- [x] Status labels (column headers and task status badges) use the color configured for the status in the admin Statuses tab.
- [x] Each task card shows the project name next to the status badge on a single line; when both are too long to fit together they are truncated with an ellipsis (full text on hover).
- [x] Each kanban column has a max-height of 90% of the board height; the task list inside the column scrolls with an internal vertical scrollbar while the column header stays visible; on mobile (viewport ≤ 767px) the column minimum height is increased to 300px
- [x] Tasks in each column are ordered by last update date, newest first (the most recently updated task appears at the top of its column).

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-20_
