#!/usr/bin/env bash
# The required check must fail closed when its dependencies are skipped or cancelled.
set -euo pipefail

report() {
    echo "$1"
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
        printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
    fi
}

fail() {
    report "$1"
    exit 1
}

[[ "${REUSE_RESULT:-}" == success ]] || fail 'CI setup failed or was cancelled. Rerun CI.'

if [[ "${EVENT_NAME:-}" == pull_request && "${E2E_REQUESTED:-}" != true ]]; then
    fail 'Full E2E has not been requested. Apply "run e2e" for testing, or "merge on pass" once functionality and design are approved for merging after tests pass.'
fi

# Only main/tag CI may reuse an exact commit whose checks and both E2E projects passed.
if [[ "${RUN_CHECKS:-}" == false ]]; then
    case "${EVENT_NAME:-}" in
        push|workflow_dispatch)
            report 'Full CI for this exact commit already passed; the reuse job verified it.'
            exit 0
            ;;
        *) fail 'PR and merge-group validation must run checks and E2E for the combined code.' ;;
    esac
fi

[[ "${RUN_CHECKS:-}" == true ]] || fail 'CI setup did not produce a valid test plan.'
[[ "${CHECK_RESULT:-}" == success ]] || fail 'Lint, type checks, unit tests and build must all pass.'
[[ "${DESKTOP_RESULT:-}" == success ]] || fail 'Desktop E2E must pass; skipped or cancelled tests do not count.'
[[ "${ANDROID_RESULT:-}" == success ]] || fail 'Android E2E must pass; skipped or cancelled tests do not count.'

if [[ "${EVENT_NAME:-}" == pull_request && "${MERGE_APPROVED:-}" != true ]]; then
    fail 'Checks and both E2E projects passed, but merge approval is still required. Apply the "merge on pass" label once functionality and design are approved for merging after tests pass.'
fi

report 'Checks and both E2E projects passed for the tested commit.'
