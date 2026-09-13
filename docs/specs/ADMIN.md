# Admin

The admin section centralizes application-wide configuration. It is organized as one tab per configuration type.

- [x] The admin section is accessible only to users with the admin role and presents one tab per configuration type.
- [x] Users tab: user management (create users, change roles, delete users, manage API keys).

## Projects tab

Projects are created and managed by admins in the admin section (see [PROJECTS.md](PROJECTS.md)).

- [x] The admin section has a "Projects" tab where projects are created and managed.
- [x] The tab order is: Users, Projects, Statuses.
- [x] The selected tab is reflected in the URL (query parameter) and is kept when the page is refreshed or reached again through browser navigation.
- [x] Project management covers: create, edit name and description, visibility and user access, status selection, delete.
- [x] Creating, updating and deleting projects through the API requires the admin role; reading projects stays available to all authenticated users (project filters).

## Statuses tab

Statuses are defined, managed and ordered globally in the admin section. Projects do not create statuses; they select which statuses from the catalog they use (see [PROJECTS.md](PROJECTS.md)).

- [x] The admin section has a "Statuses" tab where the global status catalog is managed.
- [x] The status catalog is a single, cross-project, ordered list of status names.
- [x] Only admins can edit the status catalog; the catalog itself is readable by all authenticated users.
- [x] The catalog is saved on the server and reflected in the UI (Tasks kanban, project status selection).
- [x] "Done" is mandatory: it is always part of the catalog and always the last status. It cannot be removed or reordered.
- [x] Statuses can be added, removed and reordered (drag and drop).
- [x] A status that is still used by at least one project cannot be removed from the catalog.
- [x] On a fresh installation the catalog is seeded with: To Do, In Progress, Done.
- [x] Every status has a color: color is mandatory and newly added statuses are gray by default.
- [x] The admin chooses a status color from a simplified preset-swatch picker (main colors, a few shades per color).
- [x] The exact hex color code of each status is stored server-side.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-13_
