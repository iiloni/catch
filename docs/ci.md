# Pull requests and CI

Catch's [CI workflow](../.github/workflows/ci.yml) separates PR iteration from full
validation. Every PR update targeting `main` runs lint, type checks, unit tests and builds.
The `merge on pass` label means functionality and design are approved and the agent may
merge once all required checks pass. It requests the Docker-backed test suite: two desktop
shards, two mobile shards, API tests and the unit tests that require FFmpeg and Postgres tools. Mobile E2E
emulates Android in Chromium; it does not test a native APK.

The required check is **`validation`**. It fails until checks and both E2E projects succeed
in the same run. An unlabeled PR deliberately has a failing `validation` check; its ordinary
`check` job still reports whether development checks passed. Skipped E2E jobs do not satisfy
the gate. Main pushes and manual CI requests always request the full suite. Release CI
continues to reuse only a verified full pass for the exact main/tag commit.

Optional [AI code review](ai-reviews.md) is requested separately with the `ai review`
label. It can run while a PR is a draft, is advisory, and does not authorize merging.
Wait for requested feedback and address useful findings before merge approval.
The AI request job and cubic's review are not part of the required `validation` check.

## One-time GitHub setup

1. Land this workflow change in `main`. Run it on a PR with `merge on pass` first so GitHub has a
   recent successful `validation` check to offer in the settings picker. If the label does
   not exist, create it under **Issues → Labels → New label**, or run:

   ```bash
   gh label create "merge on pass" --color 1D76DB --description "Functionality and design approved; merge when required checks pass"
   ```

2. Open **Settings → Branches → Add classic branch protection rule** for `main` (or edit
   the existing matching rule). Enable:
   - **Require a pull request before merging**.
   - **Require status checks to pass before merging**, with **`validation`** as a required
     check. Choose **GitHub Actions** as its expected source when offered.
   - **Require branches to be up to date before merging**.
   - **Do not allow bypassing the above settings**, so the rule also applies to admins.
   Keep force pushes and branch deletion disabled. Save the rule.

   `validation` covers `check`, `e2e (desktop)` and `e2e (android)`; requiring those three
   individually is optional. Requiring only the E2E jobs is insufficient because GitHub
   accepts conditionally skipped jobs as successful checks. See
   [required-check behavior](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
   and [branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

3. Optionally open **Settings → General → Pull Requests** and enable **Allow auto-merge**.
   This makes auto-merge available per PR; it does not automatically merge every passing
   PR. Applying `merge on pass` authorizes the agent to enable it for that PR. The CI
   workflow reports validation; the agent or maintainer merges or enables auto-merge.
   See [GitHub's auto-merge setup](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository).

For a solo maintainer, leave required approving reviews disabled unless someone else can
review: GitHub does not let a PR author approve their own PR. Draft status keeps a PR from
merging while its functionality is still being reviewed.

The workflow needs no new repository secrets or broad write permissions. An agent using
the CLI needs its own authenticated GitHub account/token with permission to push branches
and edit PRs. Actions' `GITHUB_TOKEN` does not trigger label workflows when it applies a
label; use the agent's normal GitHub login (or a separately configured GitHub App/PAT) for
that action. See [workflow token behavior](https://docs.github.com/en/actions/concepts/security/github_token).

## Everyday workflow

Agents follow this process by default for new features and code fixes, as specified in
[the agent guide](../AGENTS.md). Request the feature normally; the agent commits and pushes
reviewable changes and opens a draft PR assigned to its creator (`--assignee @me` when
using `gh pr create`). After reviewing functionality and design, apply
`merge on pass` yourself or tell the agent the feature is approved for merging after tests
pass. The agent then monitors checks for the latest commit, investigates and fixes
failures, pushes updates and continues until it verifies the authorized PR is merged.
Opening a PR or enabling auto-merge alone does not finish the task. If `main` advances,
the agent updates the branch and monitors the new checks before merging under the rules.

Agents add existing descriptive labels while opening a draft, using a small set that
matches the change:

| Label | Use for |
| --- | --- |
| `enhancement` | New features or improvements |
| `bug` | Fixing defects |
| `documentation` | Substantive documentation changes |
| `accessibility` | Accessibility improvements or fixes |
| `maintenance` | CI, build tooling, dependencies, refactoring or test infrastructure |

These labels describe scope. `merge on pass` records approval and merge authorization.
Set descriptive labels before requesting full validation, since later label edits also
trigger CI. Ordinary PR work does not require inventing new labels or adding unrelated
labels such as `duplicate`, `invalid` or `wontfix`.

1. Work on a branch and open a draft PR targeting `main`. Push iterations while reviewing
   functionality and design. Leave `merge on pass` absent; no Docker E2E runners start.
2. Once functionality and design are approved for merging after tests pass, update the
   branch with the latest `main`, mark the PR ready and add `merge on pass`:

   ```bash
   gh pr ready <number>
   gh pr edit <number> --add-label "merge on pass"
   gh pr checks <number> --watch
   ```

3. Keep the label while fixing test failures. Each subsequent commit reruns checks and
   E2E. New PR events cancel older runs, including older label state. Download screenshots
   and retry traces from the failed workflow's artifacts to investigate. A flaky Playwright
   retry still fails CI, matching the local configuration.
   If fixing a failure changes approved functionality or design, disable pending auto-merge,
   return the PR to draft, remove `merge on pass` and obtain renewed approval before
   reapplying it.
4. When `validation` passes, merge manually. Alternatively, use the label's authorization
   to enable auto-merge while validation runs:

   ```bash
   gh pr merge <number> --auto --squash
   ```

   Use a Conventional Commit title for a squash merge. Auto-merge waits for branch rules
   and checks; it does not update an out-of-date branch for you. If `main` advances, merge
   or rebase it into the PR branch (or use GitHub's **Update branch**) and let validation
   rerun before merging.

To return to feature iteration, disable any pending auto-merge, make the PR a draft and
remove `merge on pass`. Removing the label withdraws merge authorization and triggers a
new run that skips E2E and fails the gate.
To rerun full validation for the same commit, use **Re-run all jobs** on a labeled PR's
latest CI run, or remove and reapply the label. Rerunning an older unlabeled event uses
that event's original label state. Label changes trigger CI, so unrelated label edits can
also rerun validation while `merge on pass` is present.

## What gets merged

PR checkout uses GitHub's temporary merge commit, combining the PR branch with its base.
The strict up-to-date rule prevents using a passing result against an outdated `main`.
Conflicting PRs need their conflicts resolved and another push before PR CI can run.

The workflow also handles `merge_group: checks_requested`: every merge group runs full
validation without needing a PR label. If the repository later adopts a merge queue,
enable it in GitHub's branch settings; queue availability depends on the repository and
GitHub plan. The queue tests the proposed combination with current `main` and preceding
queued PRs. See [merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).

Local work still must pass `./scripts/dev.sh check` before finishing. Targeted local E2E
runs remain useful; the full suite can run on GitHub before merging.
