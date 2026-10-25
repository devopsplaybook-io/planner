# User Interface

The web interface is a **Progressive Web Application (PWA)**.
It is installable on mobile and desktop devices and works offline.

## Characteristics

- [x] **Responsive**: Adapts to all screen sizes from mobile to desktop
- [x] **PWA**: Installable with offline support, configured via @vite-pwa/nuxt

## Navigation

- [x] There is a **left side menu** to switch between views
- [x] On mobile, the menu auto-collapses to save screen space
- [x] The menu provides access to: Tasks, Notes, Calendar, Kanban, Update Feed, and Settings (projects are managed by admins in the Settings admin tabs, see [ADMIN.md](ADMIN.md))
- [x] A global dictation button opens the shared dictation dialog when the dictation feature is enabled (see [DICTATION.md](DICTATION.md))
- [x] On mobile, the menu's buttons (dictation and the command-palette search) get the same comfortable touch-target padding as the menu links, so taps near the icon always land on the button
- [x] The Settings entry in the menu uses a gear icon, consistent with the other navigation icons
- [x] Offline support (PWA configured with service worker, cache strategies)

### Command Palette

- [x] The command palette opens with Ctrl/Cmd+K from every page (the shortcut works while focus is in an input) and from a Search button in the menu for touch access; the button shows the Ctrl K / ⌘K shortcut hint, hidden on mobile
- [x] Typing searches tasks and notes server-side (case-insensitive substring over title and description, visibility-safe); results are grouped into Tasks and Notes and ranked by fuzzy title match; selecting a result opens its detail dialog over the current page
- [x] With an empty query the palette offers quick actions: new task, new note, and go to view (Dashboard, Tasks, Calendar, Notes, Update Feed, Settings)
- [x] Keyboard-first interaction: arrow keys move the selection with wrapping, Enter activates the selection, Escape closes the palette; the palette lists the shortcuts in its footer
- [x] The palette reuses the standard application dialog layout (a centered modal dialog with the shared header/body/footer structure and a close button) and stays responsive on mobile; the dashboard search was removed in favour of the global palette

### Settings tabs

- [x] Settings is a single page with permission-aware tabs: the **Profile** tab comes first and is the default for every user and holds all per-user settings (Appearance, Dictation, Notifications, Account, API Key); the **Task Templates** tab follows it for every user (see [TASK_TEMPLATES.md](TASK_TEMPLATES.md)); the **Users**, **Projects**, **Statuses** and **Cleanup** admin tabs are appended for admins only (see [ADMIN.md](ADMIN.md))
- [x] Non-admin users never see the admin tabs; the server-side admin authorization on the admin APIs is unchanged
- [x] The selected tab is reflected in the URL (`?tab=`) and restored on refresh and browser navigation; a deep link to an unknown or unauthorized tab (e.g. a non-admin opening `/settings?tab=users`) falls back to the Profile tab
- [x] The former standalone `/admin` page redirects to `/settings` preserving the query parameters, so existing bookmarks and PWA-cached deep links keep working
- [x] All settings tabs share a single full-width page layout: the header, tab bar and content are aligned identically for every tab (the legacy centered profile-only layout was removed)
- [x] On narrow screens the tab bar scrolls horizontally (tabs never wrap to two lines) while the page content itself never scrolls sideways

### Project Selection

- [x] The user interface saves the selected project in the local storage and automatically keep this project selected. It should remember this across the entire UI for all task view: Tasks, Calender, Tasks
- [x] The shared project selection component renders the projects as a searchable, collapsible tree: sub-projects are indented under their parent, each nested entry shows its last name segment with the full path (e.g. Home / Parents) as secondary text and tooltip — a root entry's label already is its full path, so it shows no repeated secondary text — and the search matches any segment of the path; orphaned projects are shown at the root with a warning marker. The popover stays inside the viewport (its right edge aligns with the trigger near the screen edge) and its inline search input is borderless; while open it stays anchored to its trigger, repositioning when the surrounding layout shifts (e.g. a dialog entrance animation or content loaded after a dialog opens); selecting a project or pressing Escape closes the popover, including when the component is embedded in a form label
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
    - [x] Projects are managed by admins in the Settings admin tabs; the settings URL reflects the selected tab and the displayed project (e.g. /settings?tab=projects&projectId=...)
    - [x] Task comment permalinks extend the task URL with a comment id (e.g. /?taskId=…&commentId=…): opening it shows the task dialog with the Comments section expanded, scrolled to and briefly highlighting that comment; the parameter is stripped when the dialog closes and unknown comment ids are ignored
  - [x] The detail dialogs share a standardized header: icon-only Edit (pencil), Save (check) and Cancel (undo arrow) buttons that appear/disappear together when switching between display and Edit mode, an advanced (…) menu for destructive/rare actions, and a close button
  - [x] Form dialogs follow the same button placement: the primary Save/Create and Cancel actions sit in the dialog header next to the close button (e.g. the task and note create dialogs and the create mode of the task template dialog), not in a footer below the form
  - [x] The Settings Task Templates tab lists templates alphabetically by title, grouped per project with feed-style group headers (like the update feed's day headers); each card follows the update-feed entry layout — title on its own line, then the automation chip, the initial-status chip, the meta counts and the label tags on the subsequent lines — with the shared item-card design language (priority accent stripe, icon); the card carries no project name since the group header does; clicking a card opens the template detail dialog, whose advanced (…) menu holds the create-instance and delete actions (see [TASK_TEMPLATES.md](TASK_TEMPLATES.md))
- [x] All markdown rendered in the app (task/note/project descriptions, comments, dashboard AI recommendations) goes through the shared sanitized rendering composable: output is filtered through a DOMPurify allow-list (safe tags and attributes, http/https/mailto URLs only, no event handlers); rendered markdown links open in a new tab with `rel="noopener noreferrer"`
- [x] The task and note dialog comment forms offer a Write/Preview toggle (Preview renders through the same sanitized pipeline), an auto-growing textarea and Ctrl/Cmd+Enter submit; unsent drafts persist per task/note (and per edited comment) in localStorage under the shared "planner." key prefix and degrade gracefully when storage is unavailable
- [x] Collapsible detail-dialog sections (task: Checklist/Attachments/Comments; note: Attachments/Comments) remember their collapsed/expanded state per dialog type in localStorage, with graceful degrade to content-based defaults
- [x] Task and note dialog flows (create and detail dialogs) use the custom confirmation dialogs and an inline dismissible error banner instead of browser `alert()`/`confirm()`
- [x] A shared multi-user selection component (auto-complete box with removable chips) is used for task assignees and project user access, replacing per-user checkbox lists; for project user access it offers an optional compact permission select per chip (All / Update tasks / Comment / View, defaulting to All) next to the remove button
- [x] A shared label chip editor (free-form label chips with remove buttons, autocomplete from existing labels with usage counts, keyboard navigation with ArrowUp/ArrowDown/Enter/Escape and Backspace to remove the last chip) is used for task create/edit, note edit and the dashboard/notes label filters
- [x] When a Task, Note or Project detail dialog is closed, the view behind it refreshes its data in place: the list is not unmounted and the user's scroll position is preserved (the full loading indicator is only shown on initial load)
- [x] Each main list page (Dashboard, Tasks board, Calendar, Update Feed and Notes) regularly refreshes the list it displays, once a minute and again when the tab becomes visible again after being hidden for at least that interval: the refresh is silent (no loading indicator, the list is not unmounted, the scroll position is preserved), always applies the current filters (the project filter is re-read at refresh time), skips ticks while the tab is hidden and while a refresh is still in flight, and never loses data on a failed refresh
- [x] Long markdown descriptions in the Task, Note and Project detail dialogs collapse to a capped height with a fade at the cut and a "Show more/less" disclosure exposing `aria-expanded`: the full text is shown when expanded, the disclosure only appears when the content actually overflows the cap (a short description is never faded or truncated), and Edit mode always shows the complete description; the disclosure keeps its quiet text-button appearance on hover and focus (no filled background)
- [x] The shared fullscreen attachment viewer (images and PDFs) has its own browser history entry while open: the browser Back button closes the viewer instead of the detail dialog behind it, closing the viewer through the UI consumes that entry, and closing or switching the detail dialog always dismisses the viewer so it never resurfaces above another task or note

### Tasks

- [x] A component must be created to represent a task. This component should display consistently all the main properties and actions on a task. This component must be used in all views
  - [x] A Task Card: summary card displayed in all views
  - [x] A Task Detail: a dialog that displays the full task once the card is clicked
- [x] On the Tasks board, for non-Done statuses all tasks are shown
- [x] On the Tasks board, the Done column shows only tasks whose last update is within the past 30 days (other views, such as Calendar and Project detail, keep showing all done tasks)

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-10-25_
