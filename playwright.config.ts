import { defineConfig, devices } from '@playwright/test';

/**
 * Requires the dev database: `pnpm db:up && pnpm db:migrate`.
 * Set E2E_BASE_URL to test an already running deployment instead of `pnpm dev`; that
 * deployment needs AUTH_RATE_LIMIT=false, since the tests sign up many users quickly.
 */
const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: externalBaseUrl ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
  // One process per server so Playwright can shut each down cleanly.
  webServer: externalBaseUrl
    ? undefined
    : [
        {
          command: 'node --env-file-if-exists=../../.env --import tsx src/index.ts',
          cwd: 'apps/server',
          url: 'http://localhost:3000/api/health',
          reuseExistingServer: true,
        },
        {
          command: 'node node_modules/vite/bin/vite.js --port 5173 --strictPort',
          cwd: 'apps/web',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
        },
      ],
});
