# Planner - Agent Instructions

## Specifications

The specifications are defined in [docs/specs/](docs/specs/). Always consult them first before implementing any feature.

Once specifications are implemented, document the implementation in [docs/specs/implemented/](docs/specs/implemented/) by creating or updating a markdown file describing what was built and any deviations from the original spec.

When new development is requested, compare the difference between the specs and the implemented files to determine what needs to be done.

## Project Structure

```
planner/
  planner-proxy/       # Traefik reverse proxy (routing, dev only)
  planner-server/      # Fastify API server (TypeScript)
    src/               # TypeScript source
    config.json        # Server configuration
  planner-web/         # Nuxt SPA frontend
  docs/
    dev/               # Development scripts
    deployments/       # Deployment examples
    specs/             # Application specifications
```

## Coding Conventions

### Server (`planner-server/`)

- **Language**: TypeScript
- **Framework**: Fastify
- **Database**: SQLite via `better-sqlite3` (with optional PostgreSQL support)
- **Libraries**: `@devopsplaybook.io/common-utils`, `@devopsplaybook.io/otel-utils-fastify`
- **Build**: `tsc` (compiles `src/` to `dist/`)
- **Dev mode**: `ts-node-dev` (hot-reload)
- **Tests**: Jest with `ts-jest`, files named `*.spec.ts` alongside source
- **Linting**: ESLint with `typescript-eslint`
- **Config**: Loaded from `config.json`, overridable via environment variables
- Follow the patterns established in similar projects (quality-dashboard, otel-light)

### Web (`planner-web/`)

- **Framework**: Nuxt 4 (SSR disabled, SPA mode)
- **State management**: Pinia stores in `stores/` directory
- **UI library**: `@picocss/pico` for base styling, `bootstrap-icons` for icons
- **PWA**: Enabled via `@vite-pwa/nuxt`, manifest configured in `nuxt.config.ts`
- **API calls**: Axios for HTTP requests to the backend API
- **Generating**: `nuxt generate` produces static output in `.output/public/`

### Proxy (`planner-proxy/`)

- **Traefik v2.9.6** for local development reverse proxy
- Routes: web UI on port 3000, API on port 8080, proxy listens on port 9999
- Only used in development; production uses the all-in-one container

### Docker

- Multi-stage build: builder stage compiles server + generates web, runtime stage uses `node:24-alpine`
- Single container serves both API and static web files
- Entrypoint replaces placeholder `APPLICATION_TITLE` in PWA manifest at startup

## Implementation Order (Recommended)

1. **Database layer** - Models and SQL schema (Projects, Tasks, Notes, Users)
2. **Authentication** - User registration, login, JWT middleware
3. **Projects API** - CRUD routes for projects
4. **Tasks API** - CRUD routes for tasks with all features
5. **Notes API** - CRUD routes for notes
6. **Web pages** - Corresponding Nuxt pages and components
7. **Views** - Next view, Calendar view, Kanban board

## Post-Change Validation

After any implementation, always:

1. Run the affected project's checks before considering the task done:
   - **Server update**: Run `npm run test`, `npm run build`, and `npm run lint` in `planner-server/`. Also update unit tests: remove unused tests and add new coverage for new code.
   - **Web update**: Run `npm run build` (or `npm run generate`) in `planner-web/`
2. Verify the implementation against the relevant spec file
3. Update the corresponding file in `docs/specs/implemented/`
