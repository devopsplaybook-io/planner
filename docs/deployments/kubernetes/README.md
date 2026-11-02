# Deploying with Kubernetes.

In the [planner](planner) directory, you will find an example of deployment using Yaml files (with Kustomize)

To Launch the application in Kubenetes:

```bash
git clone https://github.com/devopsplaybook-io/planner
cd planner/docs/deployments/kubernetes/planner
kubectl kustomize . | kubectl apply -f -
```

The container runs as the non-root `node` user (UID/GID 1000). The example
gives the pod `fsGroup: 1000` so the `/data` persistent volume is writable by
that user; if you use your own volume definition, make sure it is writable by
UID/GID 1000.

The `data-volume-ownership` init container chowns `/data` to UID/GID 1000 before
the server starts. It is required when the volume already holds data written by
an image that ran as root (planner before 0.95.0, or a root restore container):
`fsGroup` only applies to volumes that support ownership management and never
repairs existing files on a `hostPath` or `local-path` volume. Keep that init
container in your own manifests for the same reason — the server refuses to
start, with an explicit message, when it cannot write to `DATA_DIR`.
