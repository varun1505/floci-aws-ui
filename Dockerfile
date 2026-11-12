# Build the app, then serve it with the small Node server that also proxies /aws to floci.
FROM node:22-alpine AS build
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
COPY server.mjs ./
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
