#!/bin/bash
set -euo pipefail

SERVICE_DIR="$( cd "$( dirname "$0" )" && pwd )"
cd "${SERVICE_DIR}"

if [ ! -d bin ]; then
    mkdir -p bin
    cd bin
    file=traefik_v2.9.6_linux_amd64.tar.gz
    wget -O "${file}" "https://github.com/traefik/traefik/releases/download/v2.9.6/${file}"
    printf '%s  %s\n' "9aabb29a10ac051161fe286cdaa5c336073f08f2298fb994dc4f0a5328e21f2f" "${file}" | sha256sum -c -
    tar -xzf "${file}"
    cd ..
fi

cd "${SERVICE_DIR}"
./bin/traefik \
    --entryPoints.web.address=:9008 \
    --providers.file.watch=true \
    --providers.file.filename=traefik-rules.yml \
    --entrypoints.dashboard.address=:9091 \
    --api=true \
    --api.dashboard=true
