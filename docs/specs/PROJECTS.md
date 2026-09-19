# Projects

Projects are the top-level organizational unit.

- [x] There is one default project, but multiple projects can be added.
- [x] Projects are created and managed by admins in Admin &rarr; Projects (see [ADMIN.md](ADMIN.md)); the Projects page is not part of the global navigation and the projects API rejects create/update/delete for non-admin users.
- [x] The project dialog opens in display mode: it shows the project name, description and a read-only summary (visibility, status count, active/archived state); nothing can be changed until an admin switches it to Edit mode.
- [x] All project changes (name, description, visibility and user access, status selection, Active/Archived switch) are made in the dialog's Edit mode and saved together with one Save; Cancel discards all edits and returns to display mode.
- [x] If the save is rejected (e.g. archiving while tasks are not Done, status rules), the error is shown inline and the dialog stays in Edit mode with the entered values.
- [x] Delete: the project dialog offers an advanced menu with Delete (admins only, not for the default project); delete is no longer a standalone button.

## Visibility

- [x] Projects are visible to all users or restricted to specific users.
- [x] Visibility (public/restricted, including the user access list) is changed in the project dialog's Edit mode and saved together with the other changes &mdash; it is not saved immediately on change.
- [x] Non-admin users see only the public projects and the restricted projects they are a member of; admins see all projects (Admin &rarr; Projects and the API).
- [x] A restricted project the user cannot see answers 404 on the project details API, like a missing project.
- [x] The visibility rule is enforced on every API that serves project content (tasks, notes, views/dashboard, recommendations) &mdash; see the specs of those features.

## Statuses

Statuses are defined and ordered globally by admins in the admin section (see [ADMIN.md](ADMIN.md)). The default catalog is:

- [x] To Do
- [x] In Progress
- [x] Done

- [x] Projects do not define statuses; they select which statuses from the global catalog they use.
  - [x] Status selection happens in the project dialog's Edit mode and is saved together with the other changes (no separate save button for statuses).
  - [x] When editing, the user can select the statuses from the catalog (no free-text status creation and no per-project ordering).
  - [x] "Done" is mandatory for all projects and cannot be un-selected.
  - [x] A project must use at least 2 statuses.
  - [x] The project's statuses are stored in the global catalog order.

## Archive

Projects are active or archived. The status is switched by the admin in the project dialog's Edit mode and saved together with the other changes (see [ADMIN.md](ADMIN.md)).

- [x] A project cannot be marked as archived while 1 or more of its tasks is not Done; the API rejects the switch with an explicit error.
- [x] Un-archiving (setting a project back to Active) is always allowed.
- [x] While a project is archived, the project itself cannot be updated &mdash; in Edit mode every field is disabled except the Active/Archived switch, and only the un-archive is saved.
- [x] While a project is archived, tasks in it cannot be created, cloned or updated (including comments, assignees, labels, attachments and project changes into or out of it); the same applies to notes. Deleting a task or note is still allowed.
- [x] Archived projects disappear from the project selection boxes (dashboard, tasks, calendar, notes, task/note create and project change); the selection boxes come from a shared component.
- [x] Archived projects still appear at the end of the list in the admin projects tab (and the API orders them last).
- [x] The History page still allows selecting archived projects, marked as "(archived)".
- [x] The task list, dashboard and search still show tasks that belong to archived projects when they match the filter (30-day Done window or search).

## Hierarchy (sub-projects)

Projects form a hierarchy through their names: a name containing `/` nests the project under the project(s) named by its parent path (e.g. `Home/Parents` is a sub-project of `Home`, and `Home/Parents/Finance` under `Home/Parents`). The hierarchy is purely organizational &mdash; no new entity, no schema change &mdash; and is unbounded in depth. Epics / intermediate groupings are expressed as projects of their own that hold their own tasks and roll up their sub-projects' content in the filters.

- [x] The hierarchy is derived from the project names, using `/` as the separator; there is no parent reference stored on a project.
- [x] The subtree of a project is the project itself plus every project whose name starts with the project's name followed by `/` (true path-prefix match: `Homework` is not under `Home`).
- [x] Selecting a project in any list filter (dashboard and its search, tasks/kanban, calendar, notes, history) shows that project's tasks and notes plus those of its whole subtree; "All projects" keeps showing everything; single-project filtering (e.g. opening a project's own list) keeps working.
- [x] The persisted project filter (localStorage) keeps referencing the project by id, so renames &mdash; including cascading renames of sub-projects &mdash; cannot break saved filters; task and note rows also reference projects by id.
- [x] Per-project visibility stays independent of the hierarchy: a restricted sub-project under a public parent stays restricted, and the server-side visibility enforcement (on tasks, notes, dashboard, recommendations) is unchanged; subtree filtering only ever narrows, never widens, what the user can see.
- [x] A project whose parent path does not exist as a project (e.g. after the parent was deleted or renamed without a cascade) still renders &mdash; at the root of the tree &mdash; with an orphan warning in the project selection and in the admin projects list.
- [x] Names are normalized when saving a new project or renaming: split on `/`, trim each segment, drop empty segments, rejoin (e.g. `"  Home / Parents  "` is stored as `Home/Parents`, `"Home//Children"` as `Home/Children`). The display form joins the segments with `" / "`; storage stays canonical.
- [x] Duplicate names are rejected on create and rename: the normalized name must be unique case-insensitively (e.g. `Home` and `home` cannot coexist). Project management is admin-only, so the validation in the admin surfaces covers all project mutations.
- [x] Renaming a project that has sub-projects prompts to rewrite the names of all descendants (each keeps its own last segment); the rename is blocked with an actionable message (e.g. "Unarchive School first") when any affected sub-project is archived &mdash; archived projects reject edits, so a cascade that skips them silently would leave the tree inconsistent.
- [x] Deleting a project that still has sub-projects is blocked ("delete or move the sub-projects first").
- [x] When saving visibility (including the user access list) or status-selection changes in the project dialog of a project that has sub-projects, the admin is asked "Apply to all sub-projects?"; on confirm, only the changed parts are propagated to each sub-project with ordinary update calls, and partial failures are surfaced (e.g. "7 of 8 sub-projects updated: School is archived"). Archiving itself is not propagated.
- [x] Release note: project names that already contain `/` become a hierarchy from the release day &mdash; admins should review existing project names before upgrading.
  - [NEEDS CLARIFICATION: pre-existing case-insensitive duplicate names (e.g. `Home` and `home`) are not resolved by the new validation, which only guards new saves &mdash; should the release note ask admins to dedupe them manually, or should they be accepted as separate roots?]
- [x] Whether the default project should be barred from being renamed into a sub-project path (e.g. `X/Default`) is not decided.
  - [NEEDS CLARIFICATION: the current assumption is no special-casing &mdash; the default project can live anywhere in the tree.]

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-19_
