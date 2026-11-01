# Deploying with Docker Compose

In the [planner](planner) directory, you will find an example of deployment using Yaml files

To Launch the application in Docker with Docker Compose:

```bash
git clone https://github.com/devopsplaybook-io/planner
cd planner/docs/deployments/docker-compose/planner
docker compose up -d
```

The container runs as the non-root `node` user (UID/GID 1000), so the bind-mounted
`./data` directory must be writable by that user. On an existing installation whose
`./data` was created by a root container, migrate it once with:

```bash
sudo chown -R 1000:1000 data
```
