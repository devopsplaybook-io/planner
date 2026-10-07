# BUILD
FROM node:26-alpine as builder

WORKDIR /opt/src

RUN apk add --no-cache bash git python3 perl alpine-sdk cmake

# Embedded speech-to-text engine (whisper.cpp): compiled once at image build
# time, spawned per transcription by planner-server at runtime
ARG WHISPER_CPP_VERSION=v1.9.4
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
# zip/unzip cover archive maintenance on the /data volume (gunzip comes with gzip)
RUN apk add --no-cache gzip ffmpeg zip unzip

COPY --from=builder /opt/src/planner-server/node_modules /opt/app/planner/node_modules
COPY --from=builder /opt/src/planner-server/dist /opt/app/planner/dist
COPY --from=builder /opt/src/planner-web/.output/public /opt/app/planner/web
COPY --from=builder /opt/src/whisper.cpp/build/bin/whisper-cli /opt/app/planner/bin/whisper-cli
COPY planner-server/config.json /opt/app/planner/config.json
COPY planner-server/sql /opt/app/planner/sql
COPY package.json /opt/app/planner/package.json

WORKDIR /opt/app/planner

CMD [ "dist/App.js" ]