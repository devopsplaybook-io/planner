# BUILD
FROM node:26-alpine as builder

WORKDIR /opt/src

RUN apk add --no-cache bash git python3 perl alpine-sdk cmake

# Embedded speech-to-text engine (whisper.cpp): compiled once at image build
# time, spawned per transcription by planner-server at runtime
ARG WHISPER_CPP_VERSION=v1.9.5
RUN git clone --depth 1 --branch ${WHISPER_CPP_VERSION} \
      https://github.com/ggml-org/whisper.cpp /opt/src/whisper.cpp \
 && cmake -S /opt/src/whisper.cpp -B /opt/src/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
 && cmake --build /opt/src/whisper.cpp/build --target whisper-cli -j"$(nproc)"

COPY planner-server planner-server

RUN cd planner-server && \
    npm ci && \
    npm run build

COPY planner-web planner-web

RUN cd planner-web && \
    npm ci && \
    npm run generate

# RUN
FROM node:26-alpine

# ffmpeg decodes the dictation uploads to 16 kHz WAV for whisper-cli;
# zip/unzip cover archive maintenance on the /data volume (gunzip comes with gzip);
# tzdata resolves the TZ environment variable (IANA name, default UTC) so the
# server timezone drives the day boundaries — without it Alpine silently
# ignores TZ and everything evaluates in UTC
RUN apk add --no-cache gzip ffmpeg zip unzip tzdata

ENV TZ=UTC

COPY --from=builder --chown=node:node /opt/src/planner-server/node_modules /opt/app/planner/node_modules
COPY --from=builder --chown=node:node /opt/src/planner-server/dist /opt/app/planner/dist
COPY --from=builder --chown=node:node /opt/src/planner-web/.output/public /opt/app/planner/web
COPY --from=builder --chown=node:node /opt/src/whisper.cpp/build/bin/whisper-cli /opt/app/planner/bin/whisper-cli
COPY --chown=node:node planner-server/config.json /opt/app/planner/config.json
COPY --chown=node:node planner-server/sql /opt/app/planner/sql
COPY --chown=node:node package.json /opt/app/planner/package.json

# The persistent data volume must be writable by the unprivileged runtime
# user (UID/GID 1000, the `node` user shipped by the base image)
RUN mkdir -p /data && chown node:node /data

USER node

WORKDIR /opt/app/planner

CMD [ "dist/App.js" ]