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

# A change confined to documentation is the one case where skipped E2E is not a failure.
e2e_exempt=false
if [[ "${DOCS_ONLY:-}" == true && "${E2E_REQUESTED:-}" == false ]]; then
    case "${EVENT_NAME:-}" in
        pull_request|push) e2e_exempt=true ;;
        *) fail 'Only a PR or a push to main may skip E2E for a documentation-only change.' ;;
    esac
fi

if [[ "${EVENT_NAME:-}" == pull_request && "${E2E_REQUESTED:-}" != true && "$e2e_exempt" != true ]]; then
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
if [[ "$e2e_exempt" == true ]]; then
    passed='Checks passed; E2E is not required for a documentation-only change'
else
    [[ "${DESKTOP_RESULT:-}" == success ]] || fail 'Desktop E2E must pass; skipped or cancelled tests do not count.'
    [[ "${ANDROID_RESULT:-}" == success ]] || fail 'Android E2E must pass; skipped or cancelled tests do not count.'
    passed='Checks and both E2E projects passed'
fi

if [[ "${EVENT_NAME:-}" == pull_request && "${MERGE_APPROVED:-}" != true ]]; then
    fail "$passed, but merge approval is still required. Apply the \"merge on pass\" label once functionality and design are approved for merging after tests pass."
fi

report "$passed for the tested commit."
