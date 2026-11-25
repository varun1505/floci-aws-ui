# Build the app, then serve it with the small Node server that also proxies /aws to floci.
# The build output is plain JavaScript, so build once on the builder's own platform.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 FLOCI_ENDPOINT=http://floci:4566
COPY --from=build /app/dist ./dist
COPY server.mjs terminal.mjs package.json ./
EXPOSE 8080
# Floci Console Contract v1. floci reads these when it starts this image as its console.
# https://floci.io/floci/ui/console-contract/
# No port label: floci sets PORT and this server listens there.
LABEL io.floci.console.contract="1" \
      io.floci.console.name="floci-aws-ui" \
      io.floci.console.clouds="aws" \
      io.floci.console.url="https://github.com/varun1505/floci-aws-ui"
USER node
CMD ["node", "server.mjs"]
