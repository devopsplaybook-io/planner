# Implemented - Project Structure

## What has been implemented

### Root Project Setup

- Root `package.json` with scripts (`dev`, `dependencies`)
- `.gitignore`, `.Dockerignore`
- `env-dev.js` (development environment template)
- `ecosystem.config.js` (PM2 configuration for proxy, server, web)
- `entrypoint.sh` (container entrypoint)
- `README.md` with documentation

### Proxy (`planner-proxy/`)

- Traefik v2.9.6 reverse proxy setup
- `traefik-rules.yml` routing: web (port 3000), API (port 8080)
- `start.sh` with auto-download of traefik binary

### Server (`planner-server/`)

- TypeScript + Fastify project setup
- `tsconfig.json`, `eslint.config.mjs`, `jest.config.js`
- `config.json` for server configuration
- `Config.ts` - configuration management (file + env vars)
- `App.ts` - Fastify server with:
  - Compression, CORS
  - DB initialization + SQL migration runner on startup
  - Auth initialization (JWT)
  - All API routes registered (Users, Projects, Tasks, Notes)
  - SPA fallback for client-side routing
  - `/api/status` health check endpoint
  - Static file serving for web assets

### Web (`planner-web/`)

- Nuxt 4 SPA project setup
- PWA support with `@vite-pwa/nuxt`
- Pinia state management
- `app.vue` with responsive layout, dialogs, animations
- `nuxt.config.ts` with PWA manifest, viewport config

### Docker

- Multi-stage Dockerfile (node:24-alpine)
- Builds server (TypeScript) and web (nuxt generate)
- Single container deployment

### Deployments

- Docker Compose example
- Kubernetes manifests (namespace, PVC, deployment, service, configmap, kustomization)

### Development Environment

- `run-dev-env.sh` - installs dependencies, starts PM2
- `run-dev-dependencies-rebuild.sh` - rebuilds all dependencies
- `docker-build-images.sh` - multi-arch Docker image build

## What was implemented in this pass

### Server

- `DbUtils.ts` - Database utility (SQLite via better-sqlite3, PostgreSQL via pg)
- SQL migration scripts (6 files for SQLite + 6 files for PostgreSQL)
- Model classes (User, UserSession, Project, Task, Note, plus sub-types)
- `UserPassword.ts` - bcrypt password hashing
- `Auth.ts` - JWT authentication with admin/authenticated middleware
- `UsersData.ts` + `UsersRoutes.ts` - Users API (CRUD, login, password change, admin management)
- `ProjectsData.ts` + `ProjectsRoutes.ts` - Projects API (CRUD, custom statuses with mandatory "Done")
- `TasksData.ts` + `TasksRoutes.ts` - Tasks API (CRUD, checklist, comments, assignees, labels, due dates, priorities)
- `NotesData.ts` + `NotesRoutes.ts` - Notes API (CRUD, comments, labels)
- `App.ts` updated with DB init, migrations, auth init, all route registrations

### Web

- `utils/api.ts` - Axios instance with auth token interceptor and 403 redirect
- `stores/auth.ts` - Pinia auth store (login, register, logout, session verification)
- `stores/projects.ts` - Pinia projects store
- `stores/tasks.ts` - Pinia tasks store
- `stores/notes.ts` - Pinia notes store
- `components/Navigation.vue` - Responsive side menu (auto-collapse on mobile)
- `pages/login.vue` - Login/Register form
- `pages/index.vue` - Dashboard/Next view (overdue, upcoming, high priority tasks)
- `pages/projects.vue` - Project list with create dialog
- `pages/projects/[id].vue` - Project detail with tasks list
- `pages/tasks.vue` - Kanban board view with drag-and-drop status changes
- `pages/tasks/[id].vue` - Task detail (checklist, comments, metadata)
- `pages/notes.vue` - Note list with create dialog
- `pages/notes/[id].vue` - Note detail with comments
- `pages/calendar.vue` - Calendar view showing tasks by due date
- `pages/admin.vue` - Admin panel (user management, role changes)

### GitHub Workflows

- `.github/workflows/ci.yml` - CI on push/PR to main: server build+lint+test, web build
- `.github/workflows/docker.yml` - Docker build & push on push to main or v\* tags

### Remaining (not yet implemented)

- Task/Note attachments (file upload/download)
- Views API endpoint for aggregated dashboard data
- Unit tests for new server code
- ESLint configuration for web project
- Drag-and-drop rescheduling on calendar view
