# Technologies

## Server Side

- [x] **Runtime**: Node.js
- [x] **Framework**: Fastify (HTTP API)
- [x] **Database**: SQLite (default), with optional PostgreSQL support
- [x] **Language**: TypeScript
- [x] **Build**: tsc (TypeScript compiler)
- [x] **Dev mode**: ts-node-dev (hot-reload)
- [x] **Tests**: Jest with ts-jest
- [x] **Linting**: ESLint with typescript-eslint

### Libraries

- [x] [@devopsplaybook.io/common-utils](https://github.com/devopsplaybook-io/common-utils)
  - Common utility functions used across devopsplaybook projects
- [x] [@devopsplaybook.io/otel-utils-fastify](https://github.com/devopsplaybook-io/otel-utils-fastify)
  - OpenTelemetry integration for Fastify

### Attachments

- [x] Notes and Tasks can contain attachments
- [x] There is a maximum size for attachments, configured in megabytes in the configuration file (default: 10 MB)
- [x] The actual attachment blob is stored on disk and not in the DB. The DB only contains the required metadata

## Web Side

- [x] **Framework**: Nuxt (SPA mode, SSR disabled)
- [x] **Language**: Vue 3 / TypeScript
- [x] **State management**: Pinia
- [x] **UI**: @picocss/pico, bootstrap-icons
- [x] **PWA**: @vite-pwa/nuxt
- [x] **HTTP client**: Axios
- [x] **Design Language**: CSS custom properties for spacing, radius, transitions, and standardized component classes (.card, .section-header, .actions)
- [x] **Preferred Theme**: Light/dark theme toggle with system preference detection; choice saved to localStorage
- [x] **CSS Variables**: Standardized CSS custom properties (--space-_, --radius-_, --transition-\*) defined in assets/css/main.css

### Attachments

- [x] Attachments can be downloaded from Tasks and Notes
- [x] Only users with permission to view the Note or Task can download the attachment
- [x] If the attachment is a picture, it is displayed in the UI. The max width should be the width of the viewport

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-06-11_
