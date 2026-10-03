import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const passing = {
  EVENT_NAME: 'pull_request',
  E2E_REQUESTED: 'true',
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
  const result = validate({ E2E_REQUESTED: 'false' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Apply the "merge on pass" label/);
});

test('a labeled PR passes only when every prerequisite succeeds', () => {
  assert.equal(validate().status, 0);
  for (const key of ['REUSE_RESULT', 'CHECK_RESULT', 'DESKTOP_RESULT', 'ANDROID_RESULT']) {
    for (const value of ['failure', 'cancelled', 'skipped', '']) {
      assert.equal(validate({ [key]: value }).status, 1, `${key}=${value} must block merging`);
    }
  }
});

test('main, manual dispatch and merge queue run full validation without a PR label', () => {
  for (const EVENT_NAME of ['push', 'workflow_dispatch', 'merge_group']) {
    assert.equal(validate({ EVENT_NAME, E2E_REQUESTED: 'false' }).status, 0);
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
