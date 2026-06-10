# BUILD
FROM node:26-alpine as builder

WORKDIR /opt/src

RUN apk add --no-cache bash git python3 perl alpine-sdk

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

RUN apk add --no-cache gzip

COPY --from=builder /opt/src/planner-server/node_modules /opt/app/planner/node_modules
COPY --from=builder /opt/src/planner-server/dist /opt/app/planner/dist
COPY --from=builder /opt/src/planner-web/.output/public /opt/app/planner/web
COPY planner-server/config.json /opt/app/planner/config.json
COPY planner-server/sql /opt/app/planner/sql
COPY package.json /opt/app/planner/package.json

WORKDIR /opt/app/planner

CMD [ "dist/App.js" ]