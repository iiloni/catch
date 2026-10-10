import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { API_PROTOCOL_HEADER, API_PROTOCOL_VERSION } from './packages/shared/src/protocol';

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

// Tests tagged @api only call the server and never open a page, so one run covers every
// layout.
const apiTests = /@api/;

export default defineConfig({
  testDir: './e2e',
  workers: 2,
  // A busy machine stretches a passing test well past its usual time. The limit only has
  // to catch a test that hangs.
  timeout: 60_000,
  // Recording a trace slows every test by about a fifth, so only the rerun of a failed
  // test records one. A test that passes the second time is reported as flaky, and fails
  // the run in CI, where no other work competes for the machine.
  retries: 1,
  failOnFlakyTests: !!process.env.CI,
  use: {
    baseURL,
    // A click on something that never appears should fail well before the test's own limit.
    actionTimeout: 20_000,
    trace: 'on-first-retry',
    // The first failure has no trace, so keep a picture of where it stopped.
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { [API_PROTOCOL_HEADER]: String(API_PROTOCOL_VERSION) },
  },
  projects: [
    { name: 'desktop', grepInvert: apiTests, use: { ...devices['Desktop Chrome'] } },
    { name: 'android', grepInvert: apiTests, use: { ...devices['Pixel 7'] } },
    { name: 'api', grep: apiTests },
    // Opt in for affected cases without adding another browser to every local or CI run.
    ...(process.env.E2E_FIREFOX === '1'
      ? [{ name: 'firefox', grepInvert: apiTests, use: { ...devices['Desktop Firefox'] } }]
      : []),
  ],
});
