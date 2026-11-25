#!/usr/bin/env bash
# Stops lingering host processes bound to a Catch Git worktree (for example
# `cap run android --live-reload` started by `./scripts/dev.sh android`).
# Sourced by scripts/dev.sh and scripts/worktree.sh; may also be run directly:
#   ./scripts/worktree-processes.sh stop <worktree-path>

WORKTREE_ANDROID_PIDFILE='.dev-android.pid'

worktree_android_pidfile() {
    printf '%s/%s\n' "${1%/}" "$WORKTREE_ANDROID_PIDFILE"
}

_worktree_proc_read_stat() {
    local pid=$1 stat_line rest
    [[ "$pid" =~ ^[0-9]+$ ]] && ((pid > 1)) || return 1
    if [[ -r "/proc/$pid/stat" ]]; then
        stat_line=$(<"/proc/$pid/stat") 2>/dev/null || return 1
        rest=${stat_line##*') '}
        read -r _wt_stat_state _wt_stat_ppid _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _wt_stat_starttime _ <<< "$rest"
        return 0
    fi
    if command -v ps >/dev/null 2>&1; then
        local ps_out
        ps_out=$(ps -o stat=,ppid= -p "$pid" 2>/dev/null) || return 1
        read -r _wt_stat_state _wt_stat_ppid <<< "$ps_out"
        [[ -n "$_wt_stat_state" && "$_wt_stat_ppid" =~ ^[0-9]+$ ]] || return 1
        _wt_stat_starttime=''
        return 0
    fi
    return 1
}

_worktree_proc_is_alive() {
    local pid=$1
    [[ "$pid" =~ ^[0-9]+$ ]] && ((pid > 1)) || return 1
    if [[ -d /proc ]]; then
        _worktree_proc_read_stat "$pid" || return 1
        [[ "$_wt_stat_state" != Z* && "$_wt_stat_state" != X* ]]
        return
    fi
    kill -0 "$pid" 2>/dev/null
}

write_worktree_android_pidfile() {
    local worktree_root=$1 pid=${2:-$$} pidfile
    pidfile=$(worktree_android_pidfile "$worktree_root")
    if _worktree_proc_read_stat "$pid" && [[ -n "${_wt_stat_starttime:-}" ]]; then
        printf '%s %s\n' "$pid" "$_wt_stat_starttime" > "$pidfile"
    else
        printf '%s\n' "$pid" > "$pidfile"
    fi
}

remove_worktree_android_pidfile() {
    local worktree_root=$1 expected_pid=${2:-} pidfile recorded_pid
    pidfile=$(worktree_android_pidfile "$worktree_root")
    [[ -f "$pidfile" ]] || return 0
    if [[ -z "$expected_pid" ]]; then
        rm -f "$pidfile"
        return 0
    fi
    read -r recorded_pid _ < "$pidfile" 2>/dev/null || recorded_pid=''
    if [[ "$recorded_pid" == "$expected_pid" ]]; then
        rm -f "$pidfile"
    fi
}

_worktree_canonical_path() {
    local raw=$1 resolved
    [[ -n "$raw" ]] || return 1
    if [[ -d "$raw" ]]; then
        resolved=$(cd "$raw" 2>/dev/null && pwd -P) || return 1
    else
        resolved=${raw%/}
    fi
    [[ -n "$resolved" && "$resolved" != "/" ]] || return 1
    printf '%s\n' "$resolved"
}

_worktree_path_within() {
    local candidate=$1 root=$2
    [[ -n "$candidate" && -n "$root" ]] || return 1
    candidate=${candidate%/}
    [[ "$candidate" == "$root" || "$candidate" == "$root/"* ]]
}

_worktree_matches_root() {
    local candidate=$1 target=$2 raw_target=$3
    _worktree_path_within "$candidate" "$target" && return 0
    [[ -n "$raw_target" && "$raw_target" != "$target" ]] \
        && _worktree_path_within "$candidate" "$raw_target"
}

_worktree_is_excluded_tool_name() {
    local name=${1##*/}
    name=${name#-}
    case "$name" in
        t3-code|electron|antigravity|antigravity-acp|claude|codex|opencode|gemini|aider|cursor|code|zed|nvim|vim|vi|hx|emacs|tmux|screen|sshd|tsserver|typescript-language-server|biome)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Decides whether a single process (already checked not to be self/ancestor) is a
# Catch worktree-bound host process rather than an unrelated shell, editor or agent.
_worktree_is_dev_process() {
    local target=$1 raw_target=$2 cwd=$3
    shift 3
    local -a argv=("$@")
    ((${#argv[@]} > 0)) || return 1

    local cmd0=${argv[0]} cmd0_base=${argv[0]##*/}
    cmd0_base=${cmd0_base#-}
    _worktree_is_excluded_tool_name "$cmd0_base" && return 1

    # Quick pre-filter: only inspect cwd/args for processes that could possibly be
    # a Catch worktree script, package manager, Capacitor CLI or JS/TS dev runner.
    local eligible=false
    case "$cmd0_base" in
        bash|sh|dash|env|node|nodejs|pnpm|npm|npx|cap|capacitor|playwright|vite|vitest|next|tsx)
            eligible=true
            ;;
        *)
            if _worktree_matches_root "$cmd0" "$target" "$raw_target"; then
                eligible=true
            fi
            ;;
    esac
    $eligible || return 1

    local cwd_in_wt=false argv_in_wt=false arg val resolved
    if [[ -n "$cwd" ]] && _worktree_matches_root "$cwd" "$target" "$raw_target"; then
        cwd_in_wt=true
    fi

    for arg in "${argv[@]}"; do
        if _worktree_matches_root "$arg" "$target" "$raw_target"; then
            argv_in_wt=true
            break
        fi
        if [[ "$arg" == *=* ]]; then
            val=${arg#*=}
            if _worktree_matches_root "$val" "$target" "$raw_target"; then
                argv_in_wt=true
                break
            fi
        fi
    done

    $cwd_in_wt || $argv_in_wt || return 1

    # Reject language servers and known agent/editor scripts invoked through node/env.
    local i prev=''
    for ((i = 1; i < ${#argv[@]}; i++)); do
        arg=${argv[$i]}
        case "$arg" in
            lsp-proxy|*/lsp-proxy|tsserver|*/tsserver|typescript-language-server|*/typescript-language-server)
                return 1
                ;;
        esac
        if [[ "$cmd0_base" == node || "$cmd0_base" == nodejs || "$cmd0_base" == env ]]; then
            if [[ "$arg" != -* && "$prev" != -e && "$prev" != --eval && "$prev" != -p && "$prev" != --print ]]; then
                _worktree_is_excluded_tool_name "$arg" && return 1
                break
            fi
        fi
        prev=$arg
    done

    # Helper to test a path token (also resolving safe relative paths when cwd is inside the worktree).
    local is_script_in_wt=false is_node_modules_in_wt=false is_node_file_in_wt=false
    local is_pkg_manager=false is_dev_runner=false
    case "$cmd0_base" in
        pnpm|npm|npx) is_pkg_manager=true ;;
        cap|capacitor|playwright|vite|vitest|next) is_dev_runner=true ;;
    esac

    prev=''
    for ((i = 0; i < ${#argv[@]}; i++)); do
        arg=${argv[$i]}
        # Never treat `-c <command>` shell code strings as script paths.
        if [[ "$prev" == -c && ( "$cmd0_base" == sh || "$cmd0_base" == bash || "$cmd0_base" == dash ) ]]; then
            prev=$arg
            continue
        fi
        resolved=$arg
        if $cwd_in_wt && [[ "$arg" != /* && "$arg" != -* && "$arg" != *".."* ]]; then
            if [[ "$arg" == */* ]]; then
                resolved="${cwd%/}/${arg#./}"
            elif [[ $i -ge 1 && -f "${cwd%/}/$arg" ]]; then
                resolved="${cwd%/}/$arg"
            fi
        fi

        # 1. Script inside <worktree>/scripts/
        if [[ "$resolved" == "$target/scripts/"* || ( -n "$raw_target" && "$resolved" == "$raw_target/scripts/"* ) ]]; then
            is_script_in_wt=true
        fi

        # 2. Binary/script inside <worktree>/(apps/*|packages/*)?/node_modules/
        if _worktree_matches_root "$resolved" "$target" "$raw_target"; then
            case "$resolved" in
                */node_modules/*)
                    is_node_modules_in_wt=true
                    ;;
            esac
            # 5. JS/TS file directly under the worktree executed by node/tsx (not a directory flag value).
            if [[ $i -ge 1 && ( "$cmd0_base" == node || "$cmd0_base" == nodejs || "$cmd0_base" == tsx ) ]]; then
                case "$prev" in
                    --dir|--cwd|--workspace|--project|--root|-C) ;;
                    *)
                        case "$resolved" in
                            *.js|*.mjs|*.cjs|*.ts|*.mts|*.cts)
                                is_node_file_in_wt=true
                                ;;
                        esac
                        ;;
                esac
            fi
        fi

        # 3. Package manager launched via node/env
        if [[ $i -ge 1 ]]; then
            case "$arg" in
                pnpm|*/pnpm|*/pnpm.cjs|*/pnpm.mjs|npm|*/npm-cli.js|npx|*/npx-cli.js)
                    is_pkg_manager=true
                    ;;
                */.bin/cap|*/.bin/capacitor|*/.bin/playwright|*/.bin/vite|*/.bin/vitest|*/.bin/next|*@capacitor/cli*|*@capacitor+cli*|*/capacitor/bin/*|*/apps/site/scripts/screenshots.ts)
                    is_dev_runner=true
                    ;;
                cap|*/cap|capacitor|*/capacitor)
                    if [[ $((i + 2)) -lt ${#argv[@]} && "${argv[$((i + 1))]}" == "run" && "${argv[$((i + 2))]}" == "android" ]]; then
                        is_dev_runner=true
                    elif [[ "$cmd0_base" == node || "$cmd0_base" == nodejs || "$cmd0_base" == env ]]; then
                        is_dev_runner=true
                    fi
                    ;;
                playwright|*/playwright|vite|*/vite|vitest|*/vitest|next|*/next)
                    if [[ "$cmd0_base" == node || "$cmd0_base" == nodejs || "$cmd0_base" == env ]]; then
                        is_dev_runner=true
                    fi
                    ;;
            esac
        fi
        prev=$arg
    done

    $is_script_in_wt || $is_node_modules_in_wt || $is_pkg_manager || $is_dev_runner || $is_node_file_in_wt
}

_worktree_wait_for_exit() {
    local max_ds=$1
    shift
    local -a pids=("$@")
    local elapsed=0 pid alive
    while ((elapsed < max_ds)); do
        alive=false
        for pid in "${pids[@]}"; do
            if _worktree_proc_is_alive "$pid"; then
                alive=true
                break
            fi
        done
        $alive || return 0
        sleep 0.1
        elapsed=$((elapsed + 1))
    done
    return 1
}

stop_worktree_host_processes() {
    local raw_target=${1:-} target
    target=$(_worktree_canonical_path "$raw_target") || return 0
    raw_target=${raw_target%/}

    local sigint_wait_ds=${CATCH_STOP_SIGINT_WAIT_DS:-50}
    local sigterm_wait_ds=${CATCH_STOP_SIGTERM_WAIT_DS:-20}
    local sigkill_wait_ds=${CATCH_STOP_SIGKILL_WAIT_DS:-10}

    # Strictly exclude self, subshell pid and every ancestor up to PID 1.
    local -A excluded=()
    local p start_p
    for start_p in "$$" "${BASHPID:-$$}" "$PPID"; do
        p=$start_p
        while [[ "$p" =~ ^[0-9]+$ ]] && ((p > 1)); do
            [[ -n "${excluded[$p]:-}" ]] && break
            excluded[$p]=1
            _worktree_proc_read_stat "$p" || break
            [[ "$_wt_stat_ppid" =~ ^[0-9]+$ && "$_wt_stat_ppid" != "$p" ]] || break
            p=$_wt_stat_ppid
        done
    done

    local -A matched=()
    local -A children_by_ppid=()
    local pidfile pidfile_pid='' pidfile_start='' has_pidfile=false
    pidfile=$(worktree_android_pidfile "$target")
    if [[ -f "$pidfile" ]]; then
        has_pidfile=true
        read -r pidfile_pid pidfile_start _ < "$pidfile" 2>/dev/null || { pidfile_pid=''; pidfile_start=''; }
        if [[ "$pidfile_pid" =~ ^[0-9]+$ ]] && ((pidfile_pid > 1)) && [[ -z "${excluded[$pidfile_pid]:-}" ]]; then
            if [[ ! -d /proc || -O "/proc/$pidfile_pid" ]] && _worktree_proc_is_alive "$pidfile_pid"; then
                if [[ -z "$pidfile_start" || -z "${_wt_stat_starttime:-}" || "$_wt_stat_starttime" == "$pidfile_start" ]]; then
                    matched[$pidfile_pid]=1
                fi
            fi
        fi
    fi

    if [[ -d /proc ]]; then
        local proc_dir pid cwd
        local -a argv=()
        for proc_dir in /proc/[0-9]*; do
            pid=${proc_dir#/proc/}
            [[ "$pid" =~ ^[0-9]+$ ]] && ((pid > 1)) || continue
            [[ -O "$proc_dir" ]] || continue
            [[ -z "${excluded[$pid]:-}" ]] || continue
            _worktree_proc_read_stat "$pid" || continue
            [[ "$_wt_stat_state" != Z* && "$_wt_stat_state" != X* ]] || continue
            children_by_ppid[$_wt_stat_ppid]+=" $pid"

            argv=()
            mapfile -d '' -t argv < "$proc_dir/cmdline" 2>/dev/null || continue
            ((${#argv[@]} > 0)) || continue

            # Only pay for readlink(cwd) when argv[0] could match a dev process.
            local cmd0_base=${argv[0]##*/}
            cmd0_base=${cmd0_base#-}
            case "$cmd0_base" in
                bash|sh|dash|env|node|nodejs|pnpm|npm|npx|cap|capacitor|playwright|vite|vitest|next|tsx)
                    cwd=$(readlink "$proc_dir/cwd" 2>/dev/null || true)
                    ;;
                *)
                    if _worktree_matches_root "${argv[0]}" "$target" "$raw_target"; then
                        cwd=$(readlink "$proc_dir/cwd" 2>/dev/null || true)
                    else
                        continue
                    fi
                    ;;
            esac

            if _worktree_is_dev_process "$target" "$raw_target" "$cwd" "${argv[@]}"; then
                matched[$pid]=1
            fi
        done
    fi

    # Expand descendants (BFS) so child processes like `cap` or Playwright browsers
    # are signaled alongside (and before) their parent wrapper.
    local -a bfs_queue=()
    local -a ordered_descendants=()
    local -A seen=()
    local root_pid child
    if ((${#matched[@]} > 0)); then
        for root_pid in "${!matched[@]}"; do
            bfs_queue+=("$root_pid")
            seen[$root_pid]=1
        done
    fi

    local idx=0 current
    while ((idx < ${#bfs_queue[@]})); do
        current=${bfs_queue[$idx]}
        idx=$((idx + 1))
        ordered_descendants+=("$current")
        for child in ${children_by_ppid[$current]:-}; do
            [[ -z "${excluded[$child]:-}" && -z "${seen[$child]:-}" ]] || continue
            if _worktree_proc_is_alive "$child"; then
                seen[$child]=1
                bfs_queue+=("$child")
            fi
        done
    done

    # Signal deepest descendants first (mirrors Ctrl+C reaching leaf `cap` first).
    local -a targets=()
    local i
    for ((i = ${#ordered_descendants[@]} - 1; i >= 0; i--)); do
        targets+=("${ordered_descendants[$i]}")
    done

    if ((${#targets[@]} == 0)); then
        if $has_pidfile; then
            remove_worktree_android_pidfile "$target" "$pidfile_pid"
        fi
        return 0
    fi

    echo "Stopping ${#targets[@]} lingering host process(es) for $target..."

    local pid
    # 1. SIGINT first so `cap run android --live-reload` restores Capacitor config cleanly.
    for pid in "${targets[@]}"; do
        kill -INT "$pid" 2>/dev/null || true
    done
    _worktree_wait_for_exit "$sigint_wait_ds" "${targets[@]}" || true

    # 2. SIGTERM for anything still alive.
    local -a remaining=()
    for pid in "${targets[@]}"; do
        _worktree_proc_is_alive "$pid" && remaining+=("$pid")
    done
    if ((${#remaining[@]} > 0)); then
        for pid in "${remaining[@]}"; do
            kill -TERM "$pid" 2>/dev/null || true
        done
        _worktree_wait_for_exit "$sigterm_wait_ds" "${remaining[@]}" || true
    fi

    # 3. SIGKILL fallback for anything that ignored SIGINT and SIGTERM.
    local -a stubborn=()
    if ((${#remaining[@]} > 0)); then
        for pid in "${remaining[@]}"; do
            _worktree_proc_is_alive "$pid" && stubborn+=("$pid")
        done
    fi
    if ((${#stubborn[@]} > 0)); then
        for pid in "${stubborn[@]}"; do
            kill -KILL "$pid" 2>/dev/null || true
        done
        _worktree_wait_for_exit "$sigkill_wait_ds" "${stubborn[@]}" || true
    fi

    if $has_pidfile; then
        remove_worktree_android_pidfile "$target" "$pidfile_pid"
    fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    set -euo pipefail
    case "${1:-}" in
        stop)
            [[ $# -ge 2 ]] || { echo "Usage: $0 stop <worktree-path>" >&2; exit 2; }
            stop_worktree_host_processes "$2"
            ;;
        write-pid)
            [[ $# -ge 2 ]] || { echo "Usage: $0 write-pid <worktree-path> [pid]" >&2; exit 2; }
            write_worktree_android_pidfile "$2" "${3:-$$}"
            ;;
        *)
            echo "Usage: $0 <stop|write-pid> <worktree-path> [args...]" >&2
            exit 2
            ;;
    esac
fi
