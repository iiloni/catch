# Pull requests and CI

Catch's [CI workflow](../.github/workflows/ci.yml) separates PR iteration from full
validation. Every PR update targeting `main` runs lint, type checks, unit tests and builds.
The `run e2e` label requests the full suite on a draft without merge approval. The
`merge on pass` label means functionality and design are approved and the agent may
merge once all required checks pass. Either label requests the Docker-backed test suite: two desktop
shards, two mobile shards, API tests and the unit tests that require FFmpeg and Postgres tools. Mobile E2E
emulates Android in Chromium; it does not test a native APK.

The required check is **`validation`**. For a PR, it fails until `merge on pass` is present
and checks and both E2E projects succeed in the same run. A PR with only `run e2e` still
has a failing `validation` check after successful E2E, with a message that approval is
required. A PR with neither label also has a failing `validation` check; its ordinary
`check` job still reports whether development checks passed. Skipped E2E jobs do not satisfy
the gate. Main pushes and manual CI requests always request the full suite. Release CI
continues to reuse only a verified full pass for the exact main/tag commit.

Optional [AI code review](ai-reviews.md) is requested separately with the `ai review`
label. It can run while a PR is a draft, is advisory, and does not authorize merging.
Agents add the label themselves for higher-risk changes (see `AGENTS.md`).
Wait for requested feedback and address useful findings before merge approval.
The AI request job and cubic's review are not part of the required `validation` check.

## One-time GitHub setup

1. Land this workflow change in `main`. Run it on a PR with `merge on pass` first so GitHub has a
   recent successful `validation` check to offer in the settings picker. If the label does
   not exist, create it under **Issues → Labels → New label**, or run:

   ```bash
   gh label create "merge on pass" --color 1D76DB --description "Functionality and design approved; merge when required checks pass"
   gh label create "run e2e" --color FBCA04 --description "Run full E2E on GitHub; does not authorize merging"
   ```

2. Open **Settings → Branches → Add classic branch protection rule** for `main` (or edit
   the existing matching rule). Enable:
   - **Require a pull request before merging**.
   - **Require status checks to pass before merging**, with **`validation`** as a required
     check. Choose **GitHub Actions** as its expected source when offered.
   Leave **Require branches to be up to date before merging** off (see
   [What gets merged](#what-gets-merged)).
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
Opening a PR or enabling auto-merge alone does not finish the task.

Agents add existing descriptive labels while opening a draft, using a small set that
matches the change:

| Label | Use for |
| --- | --- |
| `enhancement` | New features or improvements |
| `bug` | Fixing defects |
| `documentation` | Substantive documentation changes |
| `accessibility` | Accessibility improvements or fixes |
| `maintenance` | CI, build tooling, dependencies, refactoring or test infrastructure |

These labels describe scope. `run e2e` requests tests; `merge on pass` records approval
and merge authorization and also requests tests.
Set descriptive labels before requesting full validation, since later label edits also
trigger CI. Ordinary PR work does not require inventing new labels or adding unrelated
labels such as `duplicate`, `invalid` or `wontfix`.

1. Work on a branch and open a draft PR targeting `main`. Push iterations while reviewing
   functionality and design. Use targeted local E2E for affected specs or cases, with
   `--workers=1` to reduce contention across worktrees:

   ```bash
   ./scripts/dev.sh e2e e2e/notes.spec.ts --grep 'create' --workers=1
   ```

   Leave `merge on pass` absent. For sweeping changes that benefit from broad regression
   coverage (shared navigation, sync or test infrastructure, for example), agents may
   request the full GitHub suite before approval:

   ```bash
   gh pr edit <number> --add-label 'run e2e'
   ```

   Keep the PR a draft. This label grants no permission to merge or enable auto-merge.
   Adding it starts full E2E; later pushes rerun the suite while it remains. After the
   requested E2E jobs finish, inspect their results and remove the label if upcoming
   commits do not need another full run:

   ```bash
   gh pr edit <number> --remove-label 'run e2e'
   ```

   Keep it while fixing E2E failures or iterating on sweeping changes that still warrant
   full coverage. Reapply it when another full run is justified. Wait until the run
   finishes before removing it, since label changes cancel superseded CI runs. Removing
   it triggers ordinary checks and skips E2E when `merge on pass` is absent.
   Ordinary changes use targeted local tests
   and rely on the mandatory full suite before merge; do not run full local E2E as a
   routine finishing check. An explicit user request can also justify an early full run.
2. Once functionality and design are approved for merging after tests pass, mark the PR
   ready and add `merge on pass`:

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
   and checks. A branch behind `main` still merges; update it only to resolve conflicts
   or to pick up a fix for a failure that came from `main`, because every update reruns
   the full suite.

To return to feature iteration, disable any pending auto-merge, make the PR a draft and
remove `merge on pass`. Removing the label withdraws merge authorization and triggers a
new run that fails the gate. E2E continues if `run e2e` remains; remove both labels to
stop requesting the full suite.
To rerun full E2E for the same commit, use **Re-run all jobs** on the latest CI run that
requested E2E, or remove and reapply `run e2e`. Full merge validation also requires
`merge on pass`. Rerunning an older unlabeled event uses
that event's original label state. Label changes trigger CI, so unrelated label edits can
also rerun E2E while either test-requesting label is present.

## What gets merged

PR checkout uses GitHub's temporary merge commit, combining the PR branch with its base.
Conflicting PRs need their conflicts resolved and another push before PR CI can run.

A branch does not have to be up to date with `main` to merge. Requiring that made every
merge invalidate the passing result of every other approved PR, so several ready PRs
each waited for a rebase and another full suite per merge ahead of them. A PR's result
therefore covers `main` as it stood when its run started, and two PRs that each pass can
still break `main` together. The full suite on every `main` push catches that after the
merge, and a release only reuses a verified full pass for its exact commit, so a broken
combination is not released.

A red `main` only blocks releasing that commit. Agents finish with their own PR merged
and do not watch `main` afterwards; when `main` needs to be green again, the maintainer
starts an agent for that. An agent whose PR fails on something that also fails on `main`
reports it rather than fixing it in that PR.

The workflow also handles `merge_group: checks_requested`: every merge group runs full
validation without needing a PR label. If the repository later adopts a merge queue,
enable it in GitHub's branch settings; queue availability depends on the repository and
GitHub plan. The queue tests the proposed combination with current `main` and preceding
queued PRs. See [merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).

Local work still must pass `./scripts/dev.sh check` before finishing. Local E2E should be
targeted; full E2E runs on GitHub through `run e2e` when early coverage is justified,
or through `merge on pass` before merging.
