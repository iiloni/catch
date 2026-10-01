#!/usr/bin/env bash
# Runs this worktree's isolated development stack. See WORKTREES.md.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
env_file=${CATCH_WORKTREE_ENV:-"$repo_root/.env.worktree"}
export CATCH_UID=${CATCH_UID:-$(id -u)}
export CATCH_GID=${CATCH_GID:-$(id -g)}

if [[ ! -f "$env_file" ]]; then
    "$repo_root/scripts/worktree.sh" init
fi

# The primary checkout's .env holds optional shared settings (API keys and the
# like). Each worktree's generated values take precedence over it.
primary=$(git -C "$repo_root" worktree list --porcelain | sed -n 's/^worktree //p' | head -n 1)
export CATCH_PRIMARY_ENV=${CATCH_PRIMARY_ENV:-"$primary/.env"}
export CATCH_ENV_FILE=$env_file

compose=(
    docker compose
    --project-directory "$repo_root"
    --env-file "$env_file"
    -f "$repo_root/docker-compose.yml"
    -f "$repo_root/docker-compose.dev.yml"
)

env_value() {
    awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$env_file"
}

app_url() {
    echo "http://$(env_value CATCH_PUBLIC_HOST):$(env_value CATCH_PORT)"
}

show_url() {
    echo "Catch: $(app_url)"
    echo "  also http://localhost:$(env_value CATCH_PORT)"
}

confirm() {
    local answer
    read -r -p "$1 [y/N] " answer
    [[ "$answer" == "y" || "$answer" == "Y" ]]
}

has_yes_flag() {
    local argument
    for argument in "$@"; do
        [[ "$argument" == "-y" || "$argument" == "--yes" ]] && return 0
    done
    return 1
}

# Named volumes start out root-owned; hand them to the host user, then install
# as that user so nothing in the bind-mounted checkout ends up owned by root.
install_dependencies() {
    docker volume create catch-pnpm-store >/dev/null
    "${compose[@]}" run --rm --no-deps -u root app sh -c '
        chown "$1:$2" /workspace/node_modules /workspace/apps/*/node_modules \
            /workspace/packages/*/node_modules /pnpm-store /pnpm-cache
    ' sh "$CATCH_UID" "$CATCH_GID"
    "${compose[@]}" run --rm --no-deps app pnpm install --frozen-lockfile
}

# Docker creates missing volume mount points inside the bind mount as root,
# which would block a host `pnpm install`. Create them as the host user first.
ensure_mount_points() {
    local dir
    for dir in "$repo_root" "$repo_root"/apps/* "$repo_root"/packages/*; do
        [[ -f "$dir/package.json" ]] && mkdir -p "$dir/node_modules"
    done
    return 0
}

fix_permissions() {
    "${compose[@]}" run --rm --no-deps -u root -v "$repo_root:/cleanup" app sh -c '
        find /cleanup -path /cleanup/.git -prune -o ! -user "$1" -exec chown "$1:$2" {} +
    ' sh "$CATCH_UID" "$CATCH_GID"
}

ensure_mount_points

command=${1:-help}
[[ $# -eq 0 ]] || shift

case "$command" in
    up)
        "${compose[@]}" build app
        if [[ -n "$(find "$repo_root" -path "$repo_root/.git" -prune -o ! -user "$CATCH_UID" -print -quit)" ]]; then
            fix_permissions
        fi
        install_dependencies
        "${compose[@]}" up -d --wait --remove-orphans "$@"
        show_url
        ;;
    install)
        install_dependencies
        ;;
    down)
        "${compose[@]}" down --remove-orphans "$@"
        ;;
    restart)
        "${compose[@]}" restart "$@"
        ;;
    logs)
        "${compose[@]}" logs -f "$@"
        ;;
    logs-once)
        "${compose[@]}" logs "$@"
        ;;
    ps)
        "${compose[@]}" ps "$@"
        ;;
    url)
        show_url
        ;;
    config)
        "${compose[@]}" config "$@"
        ;;
    migrate)
        "${compose[@]}" exec -T app pnpm db:migrate
        ;;
    generate)
        "${compose[@]}" exec -T app pnpm db:generate "$@"
        ;;
    seed)
        "${compose[@]}" exec -T -e "CATCH_SEED_PROFILE=${1:-demo}" app pnpm db:seed
        ;;
    check)
        "${compose[@]}" exec -T app pnpm check
        ;;
    test)
        "${compose[@]}" exec -T app pnpm test "$@"
        ;;
    build)
        "${compose[@]}" exec -T -e "CATCH_CHANNEL=${1:-dev}" app pnpm build
        ;;
    e2e)
        # Playwright runs on the host (it needs a browser) against this stack.
        # All worktrees share the Git common directory, so only one suite runs
        # on this machine at a time. Keep the lock until Playwright exits.
        command -v flock >/dev/null || { echo "flock is required for e2e runs." >&2; exit 1; }
        common_dir=$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir)
        exec 9>"$common_dir/catch-e2e.lock"
        if ! flock -n 9; then
            echo "Another Catch e2e run is active; waiting for it to finish..."
            flock 9
        fi
        E2E_BASE_URL="http://localhost:$(env_value CATCH_PORT)" \
            pnpm --dir "$repo_root" exec playwright test "$@"
        ;;
    android)
        # Installs the Catch Dev app, whose WebView loads this stack's Vite server, so
        # web changes hot-reload on the phone. Runs on the host (adb, JDK, SDK).
        command -v adb >/dev/null || { echo "adb not found; install Android platform-tools." >&2; exit 1; }
        if ! adb devices | awk 'NR > 1 && $2 == "device" { found = 1 } END { exit !found }'; then
            echo "No Android device connected. Plug in over USB or run 'adb connect <ip>:<port>'." >&2
            exit 1
        fi
        "$repo_root/scripts/dev.sh" up
        port=$(env_value CATCH_PORT)
        host=$(env_value CATCH_PUBLIC_HOST)
        forward=()
        if [[ "${1:-}" == "--usb" ]]; then
            # Reach the dev server through adb instead of Tailscale.
            shift
            host=localhost
            forward=(--forwardPorts "$port:$port")
        fi
        [[ -d "$repo_root/node_modules" ]] || pnpm --dir "$repo_root" install
        # Always the dev app, whatever the caller's environment says: a debug-signed build under
        # a released id makes the installer uninstall that app, along with its unsynced notes.
        export CATCH_CHANNEL=dev
        # cap sync copies the web build into the APK. Live reload ignores it, so any build will do.
        [[ -f "$repo_root/apps/web/dist/index.html" ]] || pnpm --dir "$repo_root/apps/web" build
        echo "Live reload from http://$host:$port. Keep this running; Ctrl+C restores the Capacitor config."
        pnpm --dir "$repo_root/apps/web" exec cap run android \
            --live-reload --host "$host" --port "$port" "${forward[@]}" "$@" --flavor dev
        ;;
    shell)
        "${compose[@]}" exec app bash
        ;;
    psql)
        "${compose[@]}" exec postgres psql -U catch -d catch "$@"
        ;;
    fix-permissions)
        # Git cannot remove a worktree containing files the host user does not own.
        fix_permissions
        ;;
    reset|destroy)
        if ! has_yes_flag "$@" && ! confirm "Delete all Docker volumes for $(env_value COMPOSE_PROJECT_NAME)?"; then
            echo "Cancelled."
            exit 1
        fi
        "${compose[@]}" down -v --remove-orphans
        if [[ "$command" == "reset" ]]; then
            "$0" up
        fi
        ;;
    help|-h|--help)
        cat <<'USAGE'
Usage: ./scripts/dev.sh <command>

  up                  Build, install dependencies and start this worktree's stack
  down                Stop the stack, keeping its database
  restart [service]   Restart all services or one (app, postgres, electric)
  logs [service]      Follow logs
  logs-once [service] Print current logs without following
  ps                  Show this worktree's containers
  url                 Print this worktree's URL
  config              Render the effective Compose configuration
  install             Reinstall dependencies after lockfile changes
  migrate             Apply committed migrations
  generate            Generate a migration from the Drizzle schema
  seed [demo|basic]   Re-run idempotent seeding
  check               Lint, typecheck, unit tests and build (in the container)
  test [args]         Unit tests (in the container)
  build [channel]     Build all packages (in the container; dev by default, or stable, preview)
  e2e [args]          Playwright tests from the host (one suite across worktrees)
  android [--usb]     Start the stack and install the live-reload Catch Dev app on Android
                      (--usb reaches the dev server via adb instead of Tailscale)
  shell               Open a shell in the app container
  psql [args]         Open psql against this worktree's database
  fix-permissions     Return ownership of generated files to the host user
  reset [-y]          Delete this worktree's volumes and start fresh
  destroy [-y]        Stop the stack and delete its volumes
USAGE
        ;;
    *)
        echo "Unknown command: $command" >&2
        echo "Run ./scripts/dev.sh help for available commands." >&2
        exit 2
        ;;
esac
