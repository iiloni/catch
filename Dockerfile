# syntax=docker/dockerfile:1.7
FROM node:24-slim AS base
WORKDIR /workspace
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" \
    && rm package.json

# Used by scripts/dev.sh: the checkout is bind-mounted and dependencies live in volumes.
FROM base AS development
ENV NODE_ENV=development
RUN mkdir -p /pnpm-store && chown node:node /pnpm-store /workspace
CMD ["sh", "scripts/dev-entrypoint.sh"]

FROM base AS build
COPY . .
RUN --mount=type=cache,id=catch-pnpm-store,target=/pnpm-store \
    export PNPM_CONFIG_STORE_DIR=/pnpm-store \
    && pnpm install --frozen-lockfile \
    && pnpm --filter @catch/web build \
    && pnpm --filter @catch/server build \
    && pnpm --filter @catch/server deploy --prod --legacy /out

FROM node:24-slim AS production
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /workspace/apps/server/dist ./dist
COPY --from=build /workspace/apps/server/drizzle ./drizzle
COPY --from=build /workspace/apps/web/dist ./web
RUN mkdir -p /data/attachments && chown node:node /data/attachments
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.mjs && node dist/index.mjs"]
