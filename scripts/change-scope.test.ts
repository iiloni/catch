import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { e2eExempt } from './change-scope.ts';

test('a change confined to documentation does not need E2E', () => {
  for (const paths of [
    ['README.md'],
    ['AGENTS.md', 'docs/ci.md', 'docs/decisions/0001-stack.md'],
    ['docs/screenshots/desktop-deck.png'],
    ['branding/dev/catch-dev-brand-spec.md'],
    ['.github/pull_request_template.md', 'LICENSE', '.gitignore', 'cubic.yaml'],
  ]) {
    assert.equal(e2eExempt(paths), true, paths.join(', '));
  }
});

test('publication and review workflows and their release test do not need E2E', () => {
  const paths = [
    '.github/workflows/release.yml',
    '.github/workflows/site.yml',
    '.github/workflows/tag-release.yml',
    '.github/workflows/promote-release.yml',
    '.github/workflows/ai-review.yml',
    'scripts/release-workflows.test.ts',
  ];
  for (const path of paths) assert.equal(e2eExempt([path]), true, path);
  assert.equal(e2eExempt(paths), true);
});

test('release/site workflows, their test and documentation can share an exempt change', () => {
  // The shape of PR #114, which previously required E2E.
  assert.equal(
    e2eExempt([
      '.github/workflows/release.yml',
      '.github/workflows/site.yml',
      'scripts/release-workflows.test.ts',
      'docs/releases.md',
      'docs/ci.md',
      'docs/decisions/0009-release-channels.md',
    ]),
    true,
  );
});

test('app, build, E2E and CI inputs stay outside the exemption', () => {
  for (const path of [
    'apps/web/src/routes/index.tsx',
    'apps/web/README.md',
    'e2e/fixtures/keep/note.md',
    'packages/shared/src/protocol.ts',
    'scripts/dev.sh',
    'scripts/change-scope.ts',
    'scripts/change-scope.test.ts',
    'scripts/ci-validation.sh',
    'scripts/ci-validation.test.ts',
    'scripts/wait-for-ci.ts',
    'scripts/release.ts',
    'scripts/release.test.ts',
    'scripts/changelog.ts',
    'scripts/changelog.test.ts',
    'scripts/release.sh',
    'scripts/tag-release.ts',
    'scripts/tag-release.test.ts',
    'scripts/update.sh',
    'scripts/backup.sh',
    '.github/workflows/other.yml',
    '.github/workflows/release.yml.bak',
    '.github/workflows/nested/site.yml',
    'scripts/release-workflows.test.ts.bak',
    '.github/workflows/ci.yml',
    'branding/catch-icon-master.svg',
    'Dockerfile',
    'docker-compose.dev.yml',
    '.env.example',
    'package.json',
    'pnpm-lock.yaml',
    'docs',
    'docsite/index.ts',
    'LICENSE.txt',
    // Git quotes a path with unusual characters, which must not pass as documentation.
    '"docs/caf\\303\\251.md"',
  ]) {
    assert.equal(e2eExempt([path]), false, path);
    for (const exempt of [
      'docs/ci.md',
      '.github/workflows/release.yml',
      'scripts/release-workflows.test.ts',
    ]) {
      assert.equal(e2eExempt([exempt, path]), false, `${exempt}, ${path}`);
    }
  }
});

test('an empty or unreadable change list is treated as code', () => {
  assert.equal(e2eExempt([]), false);
  const run = (input: string) =>
    spawnSync('node', [new URL('./change-scope.ts', import.meta.url).pathname], {
      encoding: 'utf8',
      input,
    }).stdout.trim();
  assert.equal(run(''), 'false');
  assert.equal(run('\n'), 'false');
  assert.equal(run('docs/ci.md\nREADME.md\n'), 'true');
  assert.equal(
    run(
      '.github/workflows/release.yml\n.github/workflows/site.yml\nscripts/release-workflows.test.ts\ndocs/ci.md\n',
    ),
    'true',
  );
  assert.equal(run('.github/workflows/release.yml\n.github/workflows/ci.yml\n'), 'false');
  assert.equal(run('docs/ci.md\napps/server/src/app.ts\n'), 'false');
});
