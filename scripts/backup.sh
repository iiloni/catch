#!/usr/bin/env bash
# Server backups for a production deployment, run on its host. See docs/backups.md.
#
# Works from a checkout (this file in scripts/) and from a deployment directory that holds
# only a Compose file and its .env: copy this file next to the Compose file. Development
# stacks use ./scripts/dev.sh backup instead.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
started_in=$PWD

usage() {
    cat <<'USAGE'
Usage: backup.sh <command>

  create [--no-attachments]   Back up the database and attachments while Catch runs
  list                        List the backups on the server
  inspect <backup>            Check a backup's files against their checksums
  export <backup> [file]      Copy a backup out of the server's volume
  import <file>               Add a backup made elsewhere to the server's list
  restore <backup|file> [-y]  Stop Catch, replace its data with a backup, start it again
  prune --kind K --keep N     Remove all but the newest N backups of one kind

<backup> is a name from 'list'. Set CATCH_COMPOSE_DIR when the Compose file is elsewhere.
USAGE
}

compose_dir() {
    local dir file
    for dir in "${CATCH_COMPOSE_DIR:-}" "$script_dir" "$script_dir/.."; do
        [[ -n "$dir" ]] || continue
        for file in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
            if [[ -f "$dir/$file" ]]; then
                (cd "$dir" && pwd)
                return 0
            fi
        done
    done
    echo "No Compose file beside this script or above it. Set CATCH_COMPOSE_DIR." >&2
    return 1
}

# Paths the caller gave are relative to where they ran the script, not to the Compose file.
absolute() {
    if [[ "$1" == /* ]]; then echo "$1"; else echo "$started_in/$1"; fi
}

app_running() {
    [[ -n "$(docker compose ps --status running -q app 2>/dev/null)" ]]
}

# In the running server's container when there is one. Otherwise in a container of its own,
# which starts Postgres if it is down: a server that is stopped can still be backed up.
in_app() {
    if app_running; then
        docker compose exec -T app "$@"
    else
        docker compose run --rm -T app "$@"
    fi
}

cli() {
    in_app node dist/backups/cli.mjs "$@"
}

require_cli() {
    if ! in_app test -f dist/backups/cli.mjs; then
        cat >&2 <<'MESSAGE'
This Catch image has no backup tool: it is older than server backups. Update to a version
that has them (./update.sh --skip-backup), after dumping the database yourself:

  docker compose exec -T postgres pg_dump -U catch -Fc catch > catch.dump
MESSAGE
        exit 1
    fi
}

confirm() {
    local answer
    read -r -p "$1 [y/N] " answer
    [[ "$answer" == "y" || "$answer" == "Y" ]]
}

command=${1:-help}
[[ $# -eq 0 ]] || shift

case "$command" in
    help|-h|--help)
        usage
        exit 0
        ;;
esac

cd "$(compose_dir)"

case "$command" in
    create|list|inspect|prune)
        require_cli
        cli "$command" "$@"
        ;;
    export)
        name=${1:?Usage: backup.sh export <backup> [file]}
        target=$(absolute "${2:-$name}")
        if [[ -e "$target" ]]; then
            echo "$target already exists." >&2
            exit 1
        fi
        require_cli
        # Everyone's notes are in it: keep it to this user.
        (umask 077 && cli export "$name" > "$target.part")
        mv "$target.part" "$target"
        echo "Saved $target"
        ;;
    import)
        file=$(absolute "${1:?Usage: backup.sh import <file>}")
        require_cli
        cli import - < "$file"
        ;;
    restore)
        target=${1:?Usage: backup.sh restore <backup|file> [-y]}
        shift
        yes=false
        for option in "$@"; do
            case "$option" in
                -y|--yes) yes=true ;;
                *) echo "Unknown restore option: $option" >&2; exit 2 ;;
            esac
        done
        require_cli
        name=$target
        if [[ -f "$(absolute "$target")" ]]; then
            # A file on the host joins the server's list first; its name is the first word.
            name=$(cli import - < "$(absolute "$target")" | awk 'NR == 1 { print $1 }')
        fi
        cli inspect "$name"
        if ! $yes && ! confirm "Stop Catch and replace every note, account and session with this backup?"; then
            echo "Cancelled."
            exit 1
        fi
        # Nothing may write to the database while its tables are replaced.
        docker compose stop app
        if docker compose run --rm -T app node dist/backups/cli.mjs restore "$name" --yes; then
            docker compose up -d --wait
            echo "Catch is running with the restored data. Devices re-sync on their own."
        else
            echo "The restore failed. Starting Catch as it was." >&2
            docker compose up -d --wait || true
            exit 1
        fi
        ;;
    *)
        echo "Unknown command: $command" >&2
        usage >&2
        exit 2
        ;;
esac
