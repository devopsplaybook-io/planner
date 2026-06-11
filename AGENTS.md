# Planner - Agent Instructions

## Specifications

### Spec files are the source of truth

Specifications are defined in [docs/specs/](docs/specs/). Each spec file embeds its own implementation status using inline markers:

- `[x]` = Implemented
- `[~]` = Partially implemented
- `[ ]` = Not yet implemented

When starting any development task, read all spec files first. Items marked `[ ]` are what needs to be built. Items marked `[x]` are already done.

### How to update status when implementing

When you implement a spec item:

1. Change `[ ]` to `[x]` (or `[~]` for partial)
2. Update the "Last spec review" date in the footer to the current date

### How the user signals spec changes

When the user edits a spec file (adds, removes, or modifies requirements), they leave new or changed items as `[ ]`. The agents see these markers and implement them automatically.

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
    specs/             # Application specifications (with inline [x]/[ ] status markers)
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
- **Layout preference**: **CSS Grid is strongly preferred over Flexbox** for UI layout. Use `display: grid` with `grid-template-columns`, `grid-template-areas`, etc. for page layouts, card arrangements, form sections, and any multi-column/multi-row composition. Reserve `display: flex` for simple one-dimensional alignments (e.g., centering content, inline button rows, single-axis item lists with `align-items`/`justify-content`).
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

## CI/CD

GitHub Actions workflows are defined in `.github/workflows/`, reusing shared workflows from `devopsplaybook-io/common-utils`:

- **`main-build.yml`**: On push to `main`. Runs `npm run build`, `npm run lint`, `npm run test` on `planner-server`, then builds & pushes multi-arch Docker image to Docker Hub.
- **`pr-check.yml`**: On PR to `main`. Runs `npm run build`, `npm run lint`, `npm run test` on `planner-server`, then builds & pushes a `beta` Docker image.
- **`npm-upgrade.yml`**: Weekly schedule (Mon 6:00). Runs `npx npm-check-updates -u` on all npm services and creates an upgrade PR.

Secrets required in GitHub repository:

- `DOCKER_HUB_USERNAME` - Docker Hub username
- `DOCKER_HUB_ACCESS_TOKEN` - Docker Hub access token
- `QUALITY_DASHBOARD_URL` - Quality Dashboard URL (optional)
- `QUALITY_DASHBOARD_TOKEN` - Quality Dashboard token (optional)

## Post-Change Validation

After any implementation, always:

1. Run the affected project's checks before considering the task done:
   - **Server update**: Run `npm run test`, `npm run build`, and `npm run lint` in `planner-server/`. Also update unit tests: remove unused tests and add new coverage for new code.
   - **Web update**: Run `npm run build` (or `npm run generate`) in `planner-web/`
2. Verify the implementation against the relevant spec file
3. Update the status markers in the corresponding spec file (`[ ]` -> `[x]` or `[~]`) and bump the "Last spec review" date
