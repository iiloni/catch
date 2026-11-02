import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { e2eExempt } from './change-scope.ts';

const passing = {
  EVENT_NAME: 'pull_request',
  E2E_REQUESTED: 'true',
  E2E_EXEMPT: 'false',
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

test('an E2E-exempt PR or main push passes on checks alone', () => {
  const exempt = {
    E2E_EXEMPT: 'true',
    E2E_REQUESTED: 'false',
    DESKTOP_RESULT: 'skipped',
    ANDROID_RESULT: 'skipped',
  };
  for (const EVENT_NAME of ['pull_request', 'push']) {
    const result = validate({ ...exempt, EVENT_NAME });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /E2E is not required for an E2E-exempt change/);
    for (const CHECK_RESULT of ['failure', 'cancelled', 'skipped', '']) {
      assert.equal(validate({ ...exempt, EVENT_NAME, CHECK_RESULT }).status, 1);
    }
    assert.equal(validate({ ...exempt, EVENT_NAME, REUSE_RESULT: 'failure' }).status, 1);
  }
  // Skipped E2E stays a failure wherever the change was not read, or was read as code.
  for (const EVENT_NAME of ['workflow_dispatch', 'merge_group', '']) {
    assert.equal(validate({ ...exempt, EVENT_NAME }).status, 1);
  }
  for (const E2E_EXEMPT of ['false', '']) {
    assert.equal(validate({ ...exempt, E2E_EXEMPT }).status, 1);
    assert.equal(validate({ ...exempt, E2E_EXEMPT, EVENT_NAME: 'push' }).status, 1);
  }
});

test('classified workflow changes skip E2E validation only when every path is exempt', () => {
  const workflowPaths = [
    '.github/workflows/release.yml',
    '.github/workflows/site.yml',
    'scripts/release-workflows.test.ts',
    'docs/ci.md',
  ];
  for (const paths of [
    workflowPaths,
    [...workflowPaths, '.github/workflows/ci.yml'],
    [...workflowPaths, 'apps/web/src/routes/index.tsx'],
  ]) {
    const exempt = e2eExempt(paths);
    for (const EVENT_NAME of ['pull_request', 'push']) {
      assert.equal(
        validate({
          EVENT_NAME,
          E2E_EXEMPT: String(exempt),
          E2E_REQUESTED: 'false',
          DESKTOP_RESULT: 'skipped',
          ANDROID_RESULT: 'skipped',
        }).status,
        exempt ? 0 : 1,
        paths.join(', '),
      );
    }
  }
});

test('an E2E-exempt PR still needs merge approval, and tests when asked to', () => {
  const unapproved = validate({
    E2E_EXEMPT: 'true',
    E2E_REQUESTED: 'false',
    MERGE_APPROVED: 'false',
    DESKTOP_RESULT: 'skipped',
    ANDROID_RESULT: 'skipped',
  });
  assert.equal(unapproved.status, 1);
  assert.match(unapproved.stdout, /E2E-exempt change, but merge approval is still required/);
  // `run e2e` requested the suite, so its result counts again.
  assert.equal(validate({ E2E_EXEMPT: 'true' }).status, 0);
  assert.equal(validate({ E2E_EXEMPT: 'true', ANDROID_RESULT: 'failure' }).status, 1);
  assert.equal(validate({ E2E_EXEMPT: 'true', DESKTOP_RESULT: 'skipped' }).status, 1);
});

test('missing test-plan outputs cannot turn skipped jobs into successful validation', () => {
  assert.equal(validate({ RUN_CHECKS: '' }).status, 1);
  assert.equal(validate({ E2E_REQUESTED: '' }).status, 1);
});

test('CI runs E2E for `run e2e`, and otherwise for code that is approved or already on main', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const expression = workflow.match(/^\s+run_e2e: \$\{\{ (.+) \}\}$/m)?.[1];
  assert.ok(expression);
  assert.match(workflow, /e2e_exempt: \$\{\{ steps\.scope\.outputs\.e2e_exempt \}\}/);
  assert.match(workflow, /echo "e2e_exempt=\$e2e_exempt" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /E2E_EXEMPT: \$\{\{ needs\.reuse\.outputs\.e2e_exempt \}\}/);
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
      // An empty output is a scope step that wrote nothing.
      for (const e2eExempt of ['true', 'false', '']) {
        const requested = runInNewContext(
          expression.replaceAll('github.event.pull_request.labels.*.name', 'labels'),
          {
            github: { event_name: event },
            steps: { scope: { outputs: { e2e_exempt: e2eExempt } } },
            labels,
            contains: (values: string[], value: string) => values.includes(value),
          },
        );
        assert.equal(
          requested,
          labels.includes('run e2e') ||
            (e2eExempt !== 'true' &&
              (event !== 'pull_request' || labels.includes('merge on pass'))),
          `${event}: ${labels.join(', ')}; E2E exempt: ${e2eExempt}`,
        );
      }
    }
  }
});
