#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ "${1:-}" == changelog ]]; then
  shift
  exec node "$script_dir/changelog.ts" "$@"
fi
exec node "$script_dir/tag-release.ts" "$@"
