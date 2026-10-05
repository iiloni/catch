# Parallel development with Git worktrees

Every checkout runs its own Docker Compose stack: the app container (API + Vite with hot
reload), Postgres and Electric, each with its own volumes. Project names and host ports are
generated per checkout, so several agents can work and run migrations without touching each
other's data. End-to-end suites take a shared host lock: a second suite waits until the first
finishes, keeping concurrent agents' test runs from overwhelming the machine.

Only the app is published to the host, on one port per worktree. Postgres and Electric stay
on the stack's private network. The pnpm download cache (`catch-pnpm-store`) is the only
volume shared between worktrees.
Each worktree also keeps its own pnpm metadata cache, so repeated `up` runs can reuse
lockfile supply-chain verification results.

## Start a checkout

```bash
./scripts/dev.sh up
```

The first run writes an ignored, owner-only `.env.worktree` with the Compose project name,
the host port, a generated `BETTER_AUTH_SECRET` and the seed profile. `up` then builds the
dev image, installs dependencies into Docker volumes, applies migrations, seeds the database
and waits until the app is healthy. It prints the URL; print it again with
`./scripts/dev.sh url`.

URLs use the machine's Tailscale MagicDNS name when Tailscale is running (for example
`http://llm:24685`) and are also reachable on `http://localhost:<port>`. Stacks bind to all
interfaces; set `CATCH_DEV_BIND_ADDRESS=127.0.0.1` in `.env.worktree` and recreate the stack
to keep one local-only.

HTTP development sync polls once a second after catching up, leaving connections free for
lazy pages, hot reload and writes. Six long-running shape requests would otherwise fill the
browser's HTTP/1.1 connection limit and make these operations wait up to 20 seconds. HTTPS
and production builds use normal long polling; serve production through an HTTP/2 proxy.

Seeded accounts (the `demo` profile, the default):

```text
Admin:        admin@example.com / adminadmin
Regular user: user@example.com  / userpassword
```

`basic` seeds only the admin, `none` seeds nothing. Seeding is idempotent and never
overwrites existing accounts or notes. Rerun it with `./scripts/dev.sh seed [demo|basic]`.
The `demo` profile gives the admin sample notes, link previews and a nested tag tree with
primary and secondary assignments. Tag examples are added only when the admin has no tags,
including on older dev databases; existing notes and tag trees are left alone.

## Create a worktree

Agents must work in the checkout or worktree they are started in. They must not create
or switch to another worktree unless the user explicitly asks them to.

From any checkout:

```bash
./scripts/worktree.sh create feature/board-view
./scripts/worktree.sh create feature/board-view ../somewhere-else
```

The default location is a sibling directory: `catch-feature-board-view` next to a primary
checkout named `catch-main` (or `catch`). The branch is created from `HEAD` when it does not
exist. Uncommitted changes in the source checkout are not carried over.

Port allocation holds a repository-wide lock and skips ports reserved by other worktrees or
already listening. `./scripts/worktree.sh list` shows every worktree and its URL.

For a worktree made with plain `git worktree add`, run `./scripts/worktree.sh init` inside
it (or just `./scripts/dev.sh up`, which initializes on first use).

## Everyday commands

Run these from inside the worktree; they always target that worktree's stack.

```bash
./scripts/dev.sh logs [app|postgres|electric]
./scripts/dev.sh check          # lint, typecheck, unit tests, build (in the container)
./scripts/dev.sh test           # unit tests only
./scripts/dev.sh e2e            # Playwright from the host against this stack
./scripts/dev.sh generate       # new migration from apps/server/src/db/schema.ts
./scripts/dev.sh migrate
./scripts/dev.sh psql
./scripts/dev.sh shell
./scripts/dev.sh install        # after pulling a lockfile change
./scripts/dev.sh down           # stop, keeping data
./scripts/dev.sh reset [-y]     # wipe this worktree's volumes and start fresh
```

`./scripts/dev.sh help` lists everything. Running `pnpm install` on the host as well is
fine (editors want it, and `e2e` needs Playwright on the host); container dependencies live
in their own volumes and never mix with the host's.

Playwright uses two workers per suite by default. Each worker also runs Chromium processes,
so the worker count is not a CPU core limit. Pass `--workers=N` to `e2e` if a run needs a
different limit. `pnpm e2e` goes through the same shared lock as `./scripts/dev.sh e2e`.
Each run recreates the app container and waits for it to be healthy, clearing Vite's HMR
module timestamps so test imports share the app's state. The database and Electric stay running.

CI splits each Playwright project over two runners (`--shard=1/2` and `--shard=2/2`), each
with its own stack and one worker; the `api` project (tests that only call the server) runs
whole beside desktop's first half. The job names say which half failed. To reproduce it, run that half the same
way: `./scripts/dev.sh e2e --project=android --shard=2/2 --workers=1`.

## Shared settings

Optional settings shared by every worktree, such as future AI provider keys, go in the
primary checkout's ignored `.env`. Each worktree's stack reads it first, then applies its own
generated values, so worktree settings always win.

## Remove a worktree

From another checkout:

```bash
./scripts/worktree.sh remove feature/board-view [-y] [--delete-branch]
```

Or from inside the worktree itself, as an agent's cleanup step before it settles its thread:

```bash
./scripts/worktree.sh self-remove [-y] [--delete-branch]
```

Removal refuses the primary checkout, the checkout running the command, and worktrees with
uncommitted changes, untracked files or unexpected ignored files. Dependencies, build output,
test reports and Android build products are treated as disposable; pass `--strict` to
refuse those too. It then deletes that worktree's Compose volumes (asking first unless `-y`)
and removes the checkout. The branch is kept unless `--delete-branch` is given, which uses a
non-forced `git branch -d`, so unmerged work is never deleted.

To remove every non-main worktree, run this from the primary checkout while it is on `main`:

```bash
./scripts/worktree.sh remove-all [-y] [--delete-branch]
```

It uses the same safety checks and volume cleanup for each worktree. Without `-y`, it asks
before deleting each initialized worktree's volumes. `--delete-branch` also deletes each
merged branch with `git branch -d`; an unmerged branch is preserved.

## Parallel migrations

Worktrees isolate databases, not Git history. Drizzle numbers migrations sequentially and
records them in `apps/server/drizzle/meta/_journal.json`, so two branches that each generate
a migration will conflict when merged. Let one agent own schema changes at a time. If two
branches do both add migrations, merge the first, then in the second delete its generated
migration files and journal entry, rebase, and run `./scripts/dev.sh generate` again.
