#!/usr/bin/env bash
# Updates a production deployment, backing up the database first. See docs/backups.md.
#
#   ./update.sh [--skip-backup] [git pull arguments]
#
# Works from a checkout, where the app is rebuilt from source after `git pull`, and from a
# deployment directory with only a Compose file and its .env, where a newer image is pulled.
# Copy this file and backup.sh next to the Compose file for the latter.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

skip_backup=false
if [[ "${1:-}" == "--skip-backup" ]]; then
    skip_backup=true
    shift
fi

compose_dir=""
for dir in "${CATCH_COMPOSE_DIR:-}" "$script_dir" "$script_dir/.."; do
    [[ -n "$dir" ]] || continue
    for file in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
        if [[ -z "$compose_dir" && -f "$dir/$file" ]]; then
            compose_dir=$(cd "$dir" && pwd)
        fi
    done
done
if [[ -z "$compose_dir" ]]; then
    echo "No Compose file beside this script or above it. Set CATCH_COMPOSE_DIR." >&2
    exit 1
fi
export CATCH_COMPOSE_DIR=$compose_dir
cd "$compose_dir"

if $skip_backup; then
    echo "Skipping the backup."
elif [[ -z "$(docker compose ps -a -q app 2>/dev/null)" ]]; then
    echo "Catch has not run here yet, so there is nothing to back up."
else
    # Made by the version that wrote the data, before anything is replaced. If it fails the
    # update stops here, with Catch still running as it was. Attachments are left out: an
    # update changes the database, not the files.
    echo "Backing up the database..."
    "$script_dir/backup.sh" create --kind update --no-attachments
fi

if [[ -f Dockerfile && -d apps/server ]]; then
    echo
    echo "Pulling the source..."
    git pull "$@"
fi

# A checkout that neither builds its source nor names an image would start whatever
# `stable` is, which can be older than the source just pulled and than the database.
if [[ -f Dockerfile && -d apps/server ]] \
    && [[ -z "${COMPOSE_FILE:-}${CATCH_IMAGE:-}" ]] \
    && ! grep -qsE '^(COMPOSE_FILE|CATCH_IMAGE)=' .env; then
    cat >&2 <<'MESSAGE'

This checkout no longer builds Catch by default: docker-compose.yml runs the published
image. Choose one in .env, then run this again:

  COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml   # keep building this source
  CATCH_IMAGE=ghcr.io/iiloni/catch:stable                    # run the published image
MESSAGE
    exit 1
fi

echo
echo "Pulling images..."
docker compose pull --ignore-buildable

echo
echo "Starting Catch..."
docker compose up -d --build --wait --remove-orphans

echo "Catch is up to date."
