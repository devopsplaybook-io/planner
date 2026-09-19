# Admin

The admin section centralizes application-wide configuration. It is organized as one tab per configuration type.

- [x] The admin section is accessible only to users with the admin role and presents one tab per configuration type.
- [x] Users tab: user management (create users, change roles, delete users, manage API keys).

## Projects tab

Projects are created and managed by admins in the admin section (see [PROJECTS.md](PROJECTS.md)).

- [x] The admin section has a "Projects" tab where projects are created and managed.
- [x] The tab order is: Users, Projects, Statuses.
- [x] The selected tab is reflected in the URL (query parameter) and is kept when the page is refreshed or reached again through browser navigation.
- [x] Project management covers: create, edit (name and description, visibility and user access, status selection, Active/Archived switch &mdash; all edited in the project dialog's Edit mode and saved with one Save), delete.
- [x] Projects are listed with active projects first and archived projects at the end of the list.
- [x] The project dialog offers a Status switch (Active / Archived); a project cannot be archived while it has tasks that are not Done, and while archived the project cannot be edited except switching it back to Active (see [PROJECTS.md](PROJECTS.md)).
- [x] Creating, updating and deleting projects through the API requires the admin role; reading projects stays available to all authenticated users (project filters).

### Projects hierarchy (see [PROJECTS.md](PROJECTS.md))

- [x] The projects tab lists projects as an indented tree: sub-projects appear nested under their parent path (indentation from the name segments), archived projects remain at the end of the list, and orphaned projects (missing parent path) render at the root with a warning.
- [x] The create dialog and the project name edit normalize the entered name as specified in [PROJECTS.md](PROJECTS.md) and show a live "will be saved as &hellip;" preview; a duplicate normalized name (case-insensitive) is rejected before submitting.
- [x] When saving visibility or status-selection changes for a project that has sub-projects, the dialog asks "Apply to all sub-projects?"; on confirm the changed parts are propagated to each sub-project and partial failures are surfaced (e.g. "7 of 8 sub-projects updated: School is archived").
- [x] Renaming a project that has sub-projects offers the rename cascade to its descendants and is blocked while any affected sub-project is archived (see [PROJECTS.md](PROJECTS.md)).
- [x] Deleting a project is blocked while it still has sub-projects (see [PROJECTS.md](PROJECTS.md)).

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

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-19_
