# syntax=docker/dockerfile:1.7
# What the server shells out to: FFmpeg for video posters, and the Postgres client tools
# for server backups (ADR 0012). pg_dump refuses a server newer than itself, so
# POSTGRES_MAJOR follows the postgres image in docker-compose.yml.
FROM node:24-slim AS runtime
ARG POSTGRES_MAJOR=17
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        -o /usr/share/keyrings/postgresql.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends "postgresql-client-${POSTGRES_MAJOR}" \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

FROM runtime AS base
WORKDIR /workspace
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" \
    && rm package.json

# Used by scripts/dev.sh: the checkout is bind-mounted and dependencies live in volumes.
# Do not create the volume mount points here: Docker resets an empty volume's owner to
# the image directory's on every mount, undoing the chown to the host user in dev.sh.
FROM base AS development
ENV NODE_ENV=development
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && chown node:node /workspace
CMD ["sh", "scripts/dev-entrypoint.sh"]

FROM base AS build
ARG CATCH_CHANNEL=dev
COPY . .
RUN --mount=type=cache,id=catch-pnpm-store,target=/pnpm-store \
    export PNPM_CONFIG_STORE_DIR=/pnpm-store \
    && pnpm install --frozen-lockfile \
    && pnpm --filter @catch/web build \
    && pnpm --filter @catch/server build \
    && pnpm --filter @catch/server deploy --prod --legacy /out

FROM runtime AS production
WORKDIR /app
# Recorded in backups, to tell which release made one.
ARG CATCH_VERSION=
ARG CATCH_CHANNEL=dev
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle \
    CATCH_VERSION=${CATCH_VERSION} \
    CATCH_CHANNEL=${CATCH_CHANNEL}
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /workspace/apps/server/dist ./dist
COPY --from=build /workspace/apps/server/drizzle ./drizzle
COPY --from=build /workspace/apps/web/dist ./web
RUN mkdir -p /data/attachments /data/backups && chown node:node /data/attachments /data/backups
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.mjs && node dist/index.mjs"]
