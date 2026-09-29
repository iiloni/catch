import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Targets this worktree's running stack (`./scripts/dev.sh up`). Set
 * E2E_BASE_URL to test another deployment; production deployments need
 * AUTH_RATE_LIMIT=false because the tests sign up many users quickly.
 */
function worktreeUrl() {
  try {
    const port = readFileSync('.env.worktree', 'utf8').match(/^CATCH_PORT=(\d+)$/m)?.[1];
    return port ? `http://localhost:${port}` : undefined;
  } catch {
    return undefined;
  }
}

const baseURL = process.env.E2E_BASE_URL ?? worktreeUrl();
if (!baseURL) {
  throw new Error('No stack to test. Run ./scripts/dev.sh up, or set E2E_BASE_URL.');
}

export default defineConfig({
  testDir: './e2e',
  workers: 2,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
});
