# Planner

**Planner** is a task and project management application designed for individuals and small teams. It provides an intuitive interface for managing tasks, notes, and projects with support for multiple views, user collaboration, and custom workflows.

## Features

- **Project Management** - Create and manage multiple projects with custom statuses
- **Task Tracking** - Tasks with title, description, checklists, comments, attachments, due dates, priorities, and labels
- **Note Taking** - Notes with title, description, comments, attachments, and labels
- **Multiple Views** - Next (overdue/upcoming), Calendar view, and Kanban board
- **User Management** - First user automatically set as admin, additional users can be added
- **PWA Support** - Installable progressive web application for mobile and desktop
- **Responsive Design** - Optimized for all screen sizes with auto-collapsing navigation on mobile

## Specification

- Fastify API server with SQLite database (configurable for PostgreSQL)
- Nuxt SPA frontend with server-side rendering disabled
- PWA enabled for offline-capable installable application
- Responsive design with left-side menu navigation
- All-in-one container deployment

## Quick Start

### Docker

Run Planner in Docker:

```bash
mkdir -p data
docker run --name planner -p 8080:8080 -v "$(pwd)/data:/data" -d devopsplaybookio/planner
```

- Docker image: `devopsplaybookio/planner`
- Exposes port: `8080`
- Data volume: `/data`

### Kubernetes

Deploy Planner on Kubernetes:

```bash
git clone https://github.com/devopsplaybook-io/planner
cd planner/docs/deployments/kubernetes/planner
kubectl kustomize . | kubectl apply -f -
```

> **Note:** To expose the service externally, use an Ingress or a NodePort service.

## More Deployment Examples

See [`docs/deployments`](docs/deployments) for additional deployment options.

## Configuration

Configuration can be provided via a JSON configuration file (e.g., using a ConfigMap) or environment variables.

| Parameter          | Description                            | Default | Availability                        |
| ------------------ | -------------------------------------- | ------- | ----------------------------------- |
| APPLICATION_TITLE  | Application title                      | Planner | Config file or environment variable |
| API_PORT           | API server port                        | 8080    | Config file or environment variable |
| CORS_POLICY_ORIGIN | CORS origin policy                     |         | Config file or environment variable |
| JWT_KEY            | JWT signing key                        | dev     | Config file or environment variable |
| DATABASE_TYPE      | Database type (`sqlite` or `postgres`) | sqlite  | Config file or environment variable |
| DATA_DIR           | Data directory                         | /data   | Config file or environment variable |

## Development

To start development on Planner:

```bash
git clone https://github.com/devopsplaybook-io/planner
cd planner
./docs/dev/run-dev-env.sh
```

This will install dependencies for all sub-projects (planner-proxy, planner-server, planner-web) and start them using PM2.

## Project Structure

```
planner/
  planner-proxy/       # Traefik reverse proxy
  planner-server/      # Fastify API server
    src/               # TypeScript source
    config.json        # Server configuration
  planner-web/         # Nuxt SPA frontend
  docs/
    dev/               # Development scripts
    deployments/       # Deployment examples (Docker, Kubernetes, Docker Compose)
    specs/             # Application specifications
```

## API

Planner exposes a RESTful API under the `/api/` prefix:

| Endpoint        | Description           |
| --------------- | --------------------- |
| GET /api/status | Health check endpoint |

Additional API endpoints for projects, tasks, notes, and users will be available as the implementation progresses.

## Contributing

Contributions are welcome! Please open issues or pull requests on [GitHub](https://github.com/devopsplaybook-io/planner).
