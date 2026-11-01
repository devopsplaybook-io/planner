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
