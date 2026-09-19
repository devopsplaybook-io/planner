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

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-19_
