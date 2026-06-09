# Technologies

## Server Side

- **Runtime**: Node.js
- **Framework**: Fastify (HTTP API)
- **Database**: SQLite (default), with optional PostgreSQL support
- **Language**: TypeScript
- **Build**: tsc (TypeScript compiler)
- **Dev mode**: ts-node-dev (hot-reload)
- **Tests**: Jest with ts-jest
- **Linting**: ESLint with typescript-eslint

### Libraries

- [@devopsplaybook.io/common-utils](https://github.com/devopsplaybook-io/common-utils)
  - Common utility functions used across devopsplaybook projects
- [@devopsplaybook.io/otel-utils-fastify](https://github.com/devopsplaybook-io/otel-utils-fastify)
  - OpenTelemetry integration for Fastify

## Web Side

- **Framework**: Nuxt (SPA mode, SSR disabled)
- **Language**: Vue 3 / TypeScript
- **State management**: Pinia
- **UI**: @picocss/pico, bootstrap-icons
- **PWA**: @vite-pwa/nuxt
- **HTTP client**: Axios
