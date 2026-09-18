# Development

In order to start development on planner execute the following:

```bash
git clone https://github.com/devopsplaybook-io/planner
cd planner
./docs/dev/run-dev-env.sh
```

## Development proxy routing

In development, the Traefik reverse proxy in `planner-proxy/` (started by
`run-dev-env.sh`) listens on port **9008** and routes requests as follows:

| Path           | Service         | Port |
|----------------|-----------------|------|
| `/api/` prefix | planner-server  | 8080 |
| everything else | planner-web    | 3000 |

The rules are defined in `planner-proxy/traefik-rules.yml` and are evaluated
in the order they are written (most specific first): the API router is written
before the catch-all web router, and each router carries an explicit
`priority` that encodes this written order. Do not rely on Traefik's default
priority (rule length), which is unrelated to the order in the file.

The proxy is only used in development — the production all-in-one container
serves the API and static web itself. Traefik watches the rules file
(`providers.file.watch=true`), so edits take effect without a restart.
