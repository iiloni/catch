import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const passing = {
  EVENT_NAME: 'pull_request',
  E2E_REQUESTED: 'true',
  MERGE_APPROVED: 'true',
  REUSE_RESULT: 'success',
  RUN_CHECKS: 'true',
  CHECK_RESULT: 'success',
  DESKTOP_RESULT: 'success',
  ANDROID_RESULT: 'success',
};

function validate(overrides: Record<string, string> = {}) {
  const result = spawnSync('bash', [new URL('./ci-validation.sh', import.meta.url).pathname], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...passing, ...overrides },
  });
  assert.ifError(result.error);
  return result;
}

test('an unlabeled PR cannot pass validation, even with successful dependencies', () => {
  const result = validate({ E2E_REQUESTED: 'false', MERGE_APPROVED: 'false' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Apply "run e2e" for testing/);
});

test('E2E without merge approval cannot pass validation, even after all tests pass', () => {
  for (const MERGE_APPROVED of ['false', '']) {
    const result = validate({ MERGE_APPROVED });
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /Checks and both E2E projects passed, but merge approval is still required/,
    );
  }
  const failed = validate({ MERGE_APPROVED: 'false', DESKTOP_RESULT: 'failure' });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /Desktop E2E must pass/);
});

test('a merge-approved PR passes only when every prerequisite succeeds', () => {
  assert.equal(validate().status, 0);
  for (const key of ['REUSE_RESULT', 'CHECK_RESULT', 'DESKTOP_RESULT', 'ANDROID_RESULT']) {
    for (const value of ['failure', 'cancelled', 'skipped', '']) {
      assert.equal(validate({ [key]: value }).status, 1, `${key}=${value} must block merging`);
    }
  }
});

test('main, manual dispatch and merge queue run full validation without a PR label', () => {
  for (const EVENT_NAME of ['push', 'workflow_dispatch', 'merge_group']) {
    assert.equal(
      validate({ EVENT_NAME, E2E_REQUESTED: 'false', MERGE_APPROVED: 'false' }).status,
      0,
    );
    assert.equal(validate({ EVENT_NAME, ANDROID_RESULT: 'skipped' }).status, 1);
  }
});

test('only main/tag CI can reuse an independently verified full pass', () => {
  const skipped = {
    RUN_CHECKS: 'false',
    CHECK_RESULT: 'skipped',
    DESKTOP_RESULT: 'skipped',
    ANDROID_RESULT: 'skipped',
  };
  for (const EVENT_NAME of ['push', 'workflow_dispatch']) {
    assert.equal(validate({ ...skipped, EVENT_NAME }).status, 0);
    assert.equal(validate({ ...skipped, EVENT_NAME, REUSE_RESULT: 'failure' }).status, 1);
  }
  for (const EVENT_NAME of ['pull_request', 'merge_group', '']) {
    assert.equal(validate({ ...skipped, EVENT_NAME }).status, 1);
  }
});

test('missing test-plan outputs cannot turn skipped jobs into successful validation', () => {
  assert.equal(validate({ RUN_CHECKS: '' }).status, 1);
  assert.equal(validate({ E2E_REQUESTED: '' }).status, 1);
});

test('CI requests E2E with either label but binds merge approval only to merge on pass', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const expression = workflow.match(/^\s+run_e2e: \$\{\{ (.+) \}\}$/m)?.[1];
  assert.ok(expression);
  assert.match(workflow, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
  assert.match(
    workflow,
    /MERGE_APPROVED: \$\{\{ contains\(github\.event\.pull_request\.labels\.\*\.name, 'merge on pass'\) \}\}/,
  );

  for (const event of [
    'pull_request',
    'push',
    'workflow_dispatch',
    'workflow_call',
    'merge_group',
  ]) {
    for (const labels of [
      [],
      ['maintenance'],
      ['run e2e'],
      ['merge on pass'],
      ['run e2e', 'merge on pass'],
    ]) {
      const requested = runInNewContext(
        expression.replaceAll('github.event.pull_request.labels.*.name', 'labels'),
        {
          github: { event_name: event },
          labels,
          contains: (values: string[], value: string) => values.includes(value),
        },
      );
      assert.equal(
        requested,
        event !== 'pull_request' || labels.includes('run e2e') || labels.includes('merge on pass'),
        `${event}: ${labels.join(', ')}`,
      );
    }
  }
});
