# syntax=docker/dockerfile:1.7
# Bookworm's FFmpeg has no fix for CVE-2026-70632. Build the patched upstream release
# for both target architectures, retaining local video decoding and WebP posters only.
FROM debian:bookworm-slim AS ffmpeg-build
ARG FFMPEG_VERSION=9.0.2
ARG FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
ARG FFMPEG_BUILD_JOBS=2
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates curl \
        libdav1d-dev libwebp-dev nasm pkg-config xz-utils \
    && curl -fsSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" -o /tmp/ffmpeg.tar.xz \
    && echo "${FFMPEG_SHA256}  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
    && mkdir /tmp/ffmpeg \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg --strip-components=1 \
    && cd /tmp/ffmpeg \
    && ./configure --prefix=/opt/ffmpeg --disable-autodetect --disable-network \
        --disable-devices --disable-hwaccels --disable-doc --disable-debug \
        --disable-ffplay --disable-ffprobe --disable-encoders --enable-encoder=libwebp \
        --disable-muxers --enable-muxer=image2 --disable-protocols --enable-protocol=file \
        --disable-demuxers --enable-demuxer=mov,matroska,avi,mpegps,mpegts,flv,ogg \
        --enable-libdav1d --enable-libwebp \
    && make -j"${FFMPEG_BUILD_JOBS}" \
    && make install

# What the server shells out to: FFmpeg for video posters, and the Postgres client tools
# for server backups (ADR 0012). pg_dump refuses a server newer than itself, so
# POSTGRES_MAJOR follows the postgres image in docker-compose.yml.
FROM node:24-bookworm-slim AS runtime
ARG POSTGRES_MAJOR=17
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates curl libdav1d6 libwebp7 libwebpmux3 \
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
COPY --from=ffmpeg-build /opt/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg

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

# The image holds the server and the web app only: the public site (apps/site, ADR 0020)
# is neither installed nor built here.
FROM base AS build
ARG CATCH_CHANNEL=dev
COPY . .
# The full install above validates workspace patches. The server-only deploy below excludes
# the web app, so allow its SQLite patch to be unused during that narrowed install.
RUN --mount=type=cache,id=catch-pnpm-store,target=/pnpm-store \
    export PNPM_CONFIG_STORE_DIR=/pnpm-store \
    && pnpm install --frozen-lockfile --filter '@catch/server...' --filter '@catch/web...' \
    && pnpm --filter @catch/web build \
    && pnpm --filter @catch/server build \
    && printf '\nallowUnusedPatches: true\n' >> pnpm-workspace.yaml \
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
# Fail the image build if optional peers bring development tooling back into deployment.
RUN node --input-type=module -e 'import { readdirSync } from "node:fs"; \
    const tools = readdirSync("node_modules/.pnpm").filter((name) => /^(?:@esbuild\+|@vitest\+|esbuild@|vite@|vitest@|next@|drizzle-kit@)/.test(name)); \
    if (tools.length) throw new Error(`Development tools in production: ${tools.join(", ")}`);'
# Startup and backups run Node directly; package managers are not needed at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /data/attachments /data/backups \
    && chown node:node /data/attachments /data/backups
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.mjs && node dist/index.mjs"]
