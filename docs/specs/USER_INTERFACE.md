# User Interface

The web interface is a **Progressive Web Application (PWA)**.
It is installable on mobile and desktop devices and works offline.

## Characteristics

- [x] **Responsive**: Adapts to all screen sizes from mobile to desktop
- [x] **PWA**: Installable with offline support, configured via @vite-pwa/nuxt

## Navigation

- [x] There is a **left side menu** to switch between views
- [x] On mobile, the menu auto-collapses to save screen space
- [x] The menu provides access to: Tasks, Notes, Calendar, Kanban, and Settings (projects are managed by admins in the admin section, see [ADMIN.md](ADMIN.md))
- [x] Offline support (PWA configured with service worker, cache strategies)

### Project Selection

- [x] The user interface saves the selected project in the local storage and automatically keep this project selected. It should remember this across the entire UI for all task view: Tasks, Calender, Tasks
- [x] The shared project selection component renders the projects as a searchable, collapsible tree: sub-projects are indented under their parent, each nested entry shows its last name segment with the full path (e.g. Home / Parents) as secondary text and tooltip — a root entry's label already is its full path, so it shows no repeated secondary text — and the search matches any segment of the path; orphaned projects are shown at the root with a warning marker. The popover stays inside the viewport (its right edge aligns with the trigger near the screen edge) and its inline search input is borderless; selecting a project or pressing Escape closes the popover, including when the component is embedded in a form label
- [x] The tree supports keyboard navigation: arrow keys move through the entries, Enter selects, Escape closes.
- [x] Selecting a project in a list filter applies the filter to the project's whole subtree (see [PROJECTS.md](PROJECTS.md)); entity forms (task/note create and detail dialogs) keep selecting exactly one project.

## Components

### Shared

- [x] Tasks, Projects and Notes must have a consistent way to be displayed and edited. While they may be represented by different components, their look and feel must be similar.
  - [x] When listing, they are represented as a card with the key information
  - [x] Clicking on a card will display the detail. Some basic information can be updated there
  - [x] When the detail is closed, the user is sent back to the previous page. If the previous page is not in the application, the user is sent to the page most related to the object
  - [x] From the detail a full edit mode can be triggered with more editing features
  - [x] When a Task, Note or Project is displayed, the URL reflects the object that is displayed and this URL can be shared and reused later or for other users to open the same object
    - [x] Projects are managed by admins in the admin section; the admin URL reflects the selected tab and the displayed project (e.g. /admin?tab=projects&projectId=...)
    - [x] Task comment permalinks extend the task URL with a comment id (e.g. /?taskId=…&commentId=…): opening it shows the task dialog with the Comments section expanded, scrolled to and briefly highlighting that comment; the parameter is stripped when the dialog closes and unknown comment ids are ignored
  - [x] The detail dialogs share a standardized header: icon-only Edit (pencil), Save (check) and Cancel (undo arrow) buttons that appear/disappear together when switching between display and Edit mode, an advanced (…) menu for destructive/rare actions, and a close button
- [x] All markdown rendered in the app (task/note/project descriptions, comments, dashboard AI recommendations) goes through the shared sanitized rendering composable: output is filtered through a DOMPurify allow-list (safe tags and attributes, http/https/mailto URLs only, no event handlers); rendered markdown links open in a new tab with `rel="noopener noreferrer"`
- [x] The task and note dialog comment forms offer a Write/Preview toggle (Preview renders through the same sanitized pipeline), an auto-growing textarea and Ctrl/Cmd+Enter submit; unsent drafts persist per task/note (and per edited comment) in localStorage under the shared "planner." key prefix and degrade gracefully when storage is unavailable
- [x] Collapsible detail-dialog sections (task: Checklist/Attachments/Comments; note: Attachments/Comments) remember their collapsed/expanded state per dialog type in localStorage, with graceful degrade to content-based defaults
- [x] Task dialog flows use the custom confirmation dialogs and an inline dismissible error banner instead of browser `alert()`/`confirm()`
- [x] A shared multi-user selection component (auto-complete box with removable chips) is used for task assignees and project user access, replacing per-user checkbox lists
- [x] When a Task, Note or Project detail dialog is closed, the view behind it refreshes its data in place: the list is not unmounted and the user's scroll position is preserved (the full loading indicator is only shown on initial load)
- [x] Long markdown descriptions in the Task, Note and Project detail dialogs collapse to a capped height with a fade at the cut and a "Show more/less" disclosure exposing `aria-expanded`: the full text is shown when expanded, the disclosure only appears when the content actually overflows the cap (a short description is never faded or truncated), and Edit mode always shows the complete description; the disclosure keeps its quiet text-button appearance on hover and focus (no filled background)

### Tasks

- [x] A component must be created to represent a task. This component should display consistently all the main properties and actions on a task. This component must be used in all views
  - [x] A Task Card: summary card displayed in all views
  - [x] A Task Detail: a dialog that displays the full task once the card is clicked
- [x] On the Tasks board, for non-Done statuses all tasks are shown
- [x] On the Tasks board, the Done column shows only tasks whose last update is within the past 30 days (other views, such as Calendar and Project detail, keep showing all done tasks)

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-20_
