# 0001: Stack

Status: accepted (2026-09-27)

## Context

Catch is a rewrite of an earlier attempt (now `catch-old`) built on Next.js, Mantine and
Prisma. That stack was chosen for human familiarity. This repo is developed mostly by
coding agents, so the stack optimizes for:

- one language end to end, with types shared through a workspace package;
- fast, deterministic feedback from a single command (`pnpm check`);
- plain TypeScript config and schema, with as little code generation as possible;
- self-hosting with `docker compose up`, and a native Android app from the same code.

## Decisions

| Concern | Choice | Instead of |
| --- | --- | --- |
| Frontend | Vite + React SPA, TanStack Router | Next.js. SSR adds nothing behind a login, and Capacitor needs a static build. |
| API | Hono on Node | Next.js route handlers or FastAPI. Keeps types shared with the client without OpenAPI codegen. |
| Database | Postgres + Drizzle | Prisma. The schema is TypeScript with no generated client. |
| Sync | Electric + TanStack DB | Hand-rolled IndexedDB queue. Electric is the sync backend TanStack DB is built around. |
| Auth | Better Auth with bearer tokens | Cookies alone. The Android WebView is a different origin. |
| UI | Tailwind v4 + shadcn/ui | Mantine. Components live in the repo, where agents can read and change them. |
| Android | Capacitor | Tauri mobile (less mature on Android) or React Native (a second UI codebase). |
| Tests | Vitest + Playwright | Jest + Storybook. |
| Lint/format | Biome | ESLint + Stylelint + Prettier. |

## Consequences

- TanStack DB is pre-1.0; its usage is kept in `apps/web/src/lib/collections.ts`.
- Self-hosting runs three containers: app, Postgres (with pgvector), Electric.
- Note content is stored as BlockNote JSON (lossless). Plain text is derived on write for
  search, and Markdown export will be derived the same way.
