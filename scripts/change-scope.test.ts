import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { docsOnly } from './change-scope.ts';

test('a change confined to documentation does not need E2E', () => {
  for (const paths of [
    ['README.md'],
    ['AGENTS.md', 'docs/ci.md', 'docs/decisions/0001-stack.md'],
    ['docs/screenshots/desktop-deck.png'],
    ['branding/dev/catch-dev-brand-spec.md'],
    ['.github/pull_request_template.md', 'LICENSE', '.gitignore', 'cubic.yaml'],
  ]) {
    assert.equal(docsOnly(paths), true, paths.join(', '));
  }
});

test('anything the app, its image, its tests or CI reads needs E2E', () => {
  for (const path of [
    'apps/web/src/routes/index.tsx',
    'apps/web/README.md',
    'e2e/fixtures/keep/note.md',
    'packages/shared/src/protocol.ts',
    'scripts/dev.sh',
    'scripts/change-scope.ts',
    '.github/workflows/ci.yml',
    '.github/workflows/ai-review.yml',
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
    assert.equal(docsOnly([path]), false, path);
    assert.equal(docsOnly(['docs/ci.md', path]), false, `docs/ci.md, ${path}`);
  }
});

test('an empty or unreadable change list is treated as code', () => {
  assert.equal(docsOnly([]), false);
  const run = (input: string) =>
    spawnSync('node', [new URL('./change-scope.ts', import.meta.url).pathname], {
      encoding: 'utf8',
      input,
    }).stdout.trim();
  assert.equal(run(''), 'false');
  assert.equal(run('\n'), 'false');
  assert.equal(run('docs/ci.md\nREADME.md\n'), 'true');
  assert.equal(run('docs/ci.md\napps/server/src/app.ts\n'), 'false');
});
