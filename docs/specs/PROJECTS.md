# Projects

Projects are the top-level organizational unit.

- [x] There is one default project, but multiple projects can be added.
- [x] Projects are created and managed by admins in Admin &rarr; Projects (see [ADMIN.md](ADMIN.md)); the Projects page is not part of the global navigation and the projects API rejects create/update/delete for non-admin users.

## Visibility

- [x] Projects are visible to all users or restricted to specific users.
- [x] Non-admin users see only the public projects and the restricted projects they are a member of; admins see all projects (Admin &rarr; Projects and the API).
- [x] A restricted project the user cannot see answers 404 on the project details API, like a missing project.
- [x] The visibility rule is enforced on every API that serves project content (tasks, notes, views/dashboard, recommendations) &mdash; see the specs of those features.

## Statuses

Statuses are defined and ordered globally by admins in the admin section (see [ADMIN.md](ADMIN.md)). The default catalog is:

- [x] To Do
- [x] In Progress
- [x] Done

- [x] Projects do not define statuses; they select which statuses from the global catalog they use.
  - [x] When the project is edited, the user can select the statuses from the catalog (no free-text status creation and no per-project ordering).
  - [x] "Done" is mandatory for all projects and cannot be un-selected.
  - [x] A project must use at least 2 statuses.
  - [x] The project's statuses are stored in the global catalog order.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-13_
