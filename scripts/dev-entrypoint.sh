#!/bin/sh
# Development container entrypoint: bring the database up to date, seed it,
# then run the API and Vite with hot reload.
set -eu
pnpm db:migrate
pnpm db:seed
exec pnpm dev
