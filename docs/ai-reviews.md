# Opt-in AI code review

Catch uses [cubic](https://www.cubic.dev/) for an optional code review before merge
approval. Add `ai review` to an open PR targeting `main` when the code is ready,
including while it is a draft. The
[AI review workflow](../.github/workflows/ai-review.yml) posts
`@cubic-dev-ai review this PR` and records the current head commit.

Reviews are advisory. The `ai review` label does not approve functionality or
design, request Docker E2E, or authorize merging. `merge on pass` retains those
meanings from [the CI guide](ci.md). A successful **Request cubic review** job does
not mean cubic finished or found no issues. Check the PR for the request comment;
the job can also succeed after skipping an unauthorized, stale, or duplicate
request. Do not make this job or cubic's check required in branch protection while
evaluating the reviewer.

## One-time setup

1. Sign in at [cubic.dev/sign-up](https://www.cubic.dev/sign-up) with your GitHub
   account and install its GitHub App. Select **Only select repositories** and
   choose `iiloni/catch`.
2. Before this change lands on `main`, open cubic's **AI review settings** for
   Catch and set the temporary dashboard controls to match the repo policy:
   keep AI reviews enabled, add `*` to the **base branch ignore patterns**, allow
   draft reviews, disable automatic incremental reviews and auto-approval, and
   disable automatic PR descriptions and code fixes. The base branch ignore
   pattern suppresses automatic reviews; explicit comment requests still work.
3. Merge the setup PR through Catch's normal approval and validation process.
   Both the workflow and `cubic.yaml` need to be on `main` before the complete
   setup takes effect. cubic reads its configuration from the default branch,
   not the PR's feature branch. Once merged, verify cubic's settings show the
   repository YAML configuration without validation errors.
4. Keep the public repository on cubic's free plan. Public repositories use a
   separate fair-use allowance rather than the private free plan's 20-review
   quota. That allowance has no published numerical guarantee. No paid plan,
   cubic API key, PAT, or repository secret is needed for this workflow.
5. On a draft PR targeting `main`, add `ai review` with your GitHub account or
   normal authenticated `gh` session. Confirm the **AI review** workflow posts a
   request, then wait for cubic's acknowledgement and completed review. Remove
   and reapply the label if it was already present before the workflow landed.

The `ai review` label is created during setup. To recreate it if needed:

```bash
gh label create 'ai review' --color 1D76DB \
  --description 'Request an advisory cubic review; does not authorize merging'
```

See cubic's [quickstart](https://docs.cubic.dev/ai-review/quickstart),
[configuration reference](https://docs.cubic.dev/configure/cubic-yaml), and
[public-repository usage rules](https://docs.cubic.dev/account/ai-review-usage).

## Everyday workflow

1. Push iterations to the draft PR. Automatic reviews are suppressed by
   `cubic.yaml`, including after marking a draft ready or pushing more commits.
2. Add `ai review` when you want a full review. The workflow accepts requests only
   from people with write, maintain, or admin access. It checks that the PR is
   still open, targets `main`, still carries the label, and has the same head
   commit as the label event. A stale request is skipped with a workflow notice.
3. Read the findings and fix those supported by the code. Explain false positives
   in the review discussion. Wait for the review before deciding whether to apply
   `merge on pass`; normal CI does not wait for cubic.
4. After substantial fixes, post `@cubic-dev-ai incremental review` to review only
   changes since the previous completed review. For another full review, remove
   and reapply `ai review`, or post `@cubic-dev-ai review this PR` yourself.
   Keeping the label present does not trigger reviews on subsequent pushes.
5. Approve functionality and design separately, then follow the existing
   `merge on pass` process. Recheck meaningful changes made after the last review.

For example:

```bash
gh pr edit <number> --add-label 'ai review'
gh pr comment <number> --body '@cubic-dev-ai incremental review'
```

Apply the label through the GitHub UI, a normal `gh` login, or a GitHub App/PAT.
Labels applied with an Actions `GITHUB_TOKEN` do not start another Actions
workflow. The workflow itself uses its built-in token only to post the review
request; it does not check out or execute PR code, including code from forks.
Retries of the same workflow run do not post duplicate requests. Removing the
label does not cancel a request already posted; use cubic's **Cancel AI review**
control to stop a running review.

## Handling review results

Agents follow the [AI review instructions in AGENTS.md](../AGENTS.md#ai-code-review)
when you request a review or apply the label. Review remains opt-in; agents do not
spend another review simply because a label is still present after a push.

Read cubic's completed summary, inline findings and follow-up discussion, and
confirm the reviewed revision. `gh pr view <number> --comments` shows the PR
conversation; fetch inline review comments separately:

```bash
gh api --paginate repos/iiloni/catch/pulls/<number>/comments
gh api --paginate repos/iiloni/catch/pulls/<number>/reviews
```

Check each claim against the current implementation, requirements and relevant
ADRs. Fix reproducible bugs and supported regressions within the task's scope;
do not automatically apply every suggestion. Reply with the disposition and
evidence: fixed, already addressed, false positive, or deferred with its remaining
impact. A thread should reflect the actual outcome, not be resolved merely to
clear the review. Material scope or design changes need the maintainer's decision.

Run relevant checks after fixes and request an incremental review for meaningful
changes. Summarize the reviewed commit, fixes, rejected findings and outstanding
risks in the PR description and final update. If cubic cannot complete a review,
report it as pending and use the troubleshooting below. A clean AI review does
not authorize merging; fixes that change approved behavior still follow Catch's
existing process for returning to draft and obtaining renewed approval.

## Troubleshooting

- **No workflow run:** confirm the workflow is on `main`, the PR targets `main`,
  and the label was newly added using an account other than Actions' built-in
  token. Remove and reapply it. Check the workflow notices for permission or
  stale-PR skips.
- **The request posted but cubic is silent:** confirm the App has access to Catch,
  AI reviews and draft reviews are enabled, and there are no YAML validation or
  quota warnings in cubic's settings. The Actions job only verifies posting; the
  App's response cannot be tested until it is installed. Try posting
  `@cubic-dev-ai review this PR` from your own account. If that works but the
  Actions comment does not, use the manual command and report the bot-comment
  handling to cubic before depending on the label workflow.
- **Reviews start without the label:** verify the wildcard base branch ignore
  pattern is active. The repo YAML overrides the dashboard once it is on `main`;
  changes to YAML on a feature branch do not take effect yet.
