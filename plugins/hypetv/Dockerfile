# HypeTv, its own service (docker-compose.prod.yml): built from the repo root, since the page uses sdk/.
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY sdk ./sdk
COPY plugins/hypetv/package.json plugins/hypetv/bun.lock ./plugins/hypetv/
WORKDIR /app/plugins/hypetv
RUN bun install --frozen-lockfile
COPY plugins/hypetv ./
RUN bun run build

# The server has no dependencies of its own: only the page's build and the server's sources ship.
FROM oven/bun:1.4-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3002
COPY plugins/hypetv/server ./server
COPY --from=build /app/plugins/hypetv/dist ./dist
EXPOSE 3002
CMD ["bun", "server/index.ts"]
