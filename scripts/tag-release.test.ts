import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./release.sh', import.meta.url));
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GITHUB_OUTPUT: undefined,
};

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'catch-release-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@example.com');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'tag.gpgSign', 'false');
  git('commit', '--quiet', '--allow-empty', '-m', 'Initial');
  return {
    cwd,
    git,
    run: (...args: string[]) => spawnSync(script, args, { cwd, env, encoding: 'utf8' }),
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

test('a first release annotates HEAD locally without moving HEAD or accessing a remote', (t) => {
  const repo = fixture();
  t.after(repo.cleanup);
  repo.git('remote', 'add', 'origin', join(repo.cwd, 'nonexistent-remote'));
  const head = repo.git('rev-parse', 'HEAD');
  const result = repo.run('preview', 'minor');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(repo.git('tag'), 'v0.1.0-preview');
  assert.equal(repo.git('cat-file', '-t', 'v0.1.0-preview'), 'tag');
  assert.equal(repo.git('rev-parse', 'v0.1.0-preview^{commit}'), head);
  assert.equal(repo.git('rev-parse', 'HEAD'), head);
  assert.match(result.stdout, /git push origin v0\.1\.0-preview/);
});

test('Actions receives the created tag, with no output for dry runs or collisions', (t) => {
  const repo = fixture();
  t.after(repo.cleanup);
  const outputDir = mkdtempSync(join(tmpdir(), 'catch-release-output-'));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const output = join(outputDir, 'output');
  writeFileSync(output, 'existing=value\n');
  const run = (...args: string[]) =>
    spawnSync(script, args, {
      cwd: repo.cwd,
      env: { ...env, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });
  assert.equal(run('preview', 'minor', '--dry-run').status, 0);
  assert.equal(readFileSync(output, 'utf8'), 'existing=value\n');
  const result = run('preview', 'minor');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'existing=value\ntag=v0.1.0-preview\n');
  const promoted = run('stable', 'promote');
  assert.equal(promoted.status, 0, promoted.stderr);
  const expected = 'existing=value\ntag=v0.1.0-preview\ntag=v0.1.0\n';
  assert.equal(readFileSync(output, 'utf8'), expected);
  assert.equal(run('stable', 'promote').status, 1);
  assert.equal(readFileSync(output, 'utf8'), expected);
});

test('bumps use reachable tags across channels and ignore unrelated branch versions', (t) => {
  const repo = fixture();
  t.after(repo.cleanup);
  repo.git('tag', 'v0.3.3');
  repo.git('commit', '--quiet', '--allow-empty', '-m', 'Feature');
  repo.git('tag', '-a', 'v0.4.1-preview', '-m', 'Preview');
  const tree = repo.git('rev-parse', 'HEAD^{tree}');
  const unrelated = repo.git('commit-tree', tree, '-m', 'Unrelated history');
  repo.git('tag', 'v99.0.0-preview', unrelated);
  repo.git('commit', '--quiet', '--allow-empty', '-m', 'Fix');
  const head = repo.git('rev-parse', 'HEAD');
  const result = repo.run('preview', 'patch');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(repo.git('rev-parse', 'v0.4.2-preview^{commit}'), head);
  assert.match(result.stdout, /base v0\.4\.1-preview/);
});

test('dirty checkouts reject tagging but allow a dry run without changing refs', (t) => {
  const repo = fixture();
  t.after(repo.cleanup);
  writeFileSync(join(repo.cwd, 'unfinished.txt'), 'Uncommitted work');
  const rejected = repo.run('stable', 'patch');
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Commit or stash/);
  assert.equal(repo.git('tag'), '');
  const dryRun = repo.run('stable', 'patch', '--dry-run');
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /Would create v0\.0\.1/);
  assert.equal(repo.git('tag'), '');
});

test('promotion can tag an older preview while newer work remains untouched', (t) => {
  const repo = fixture();
  t.after(repo.cleanup);
  const testedCommit = repo.git('rev-parse', 'HEAD');
  repo.git('tag', '-a', 'v0.4.1-preview', '-m', 'Tested preview');
  repo.git('commit', '--quiet', '--allow-empty', '-m', 'New patch');
  repo.git('tag', 'v0.4.2-preview');
  const head = repo.git('rev-parse', 'HEAD');
  writeFileSync(join(repo.cwd, 'unfinished.txt'), 'Newer work');
  const result = repo.run('stable', 'promote', 'v0.4.1-preview');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(repo.git('rev-parse', 'v0.4.1^{commit}'), testedCommit);
  assert.equal(repo.git('rev-parse', 'HEAD'), head);
  assert.match(repo.git('status', '--porcelain'), /unfinished.txt/);
  assert.equal(repo.run('stable', 'promote', 'v0.4.1-preview').status, 1);
  assert.equal(repo.git('rev-parse', 'v0.4.1^{commit}'), testedCommit);
});

test('promotion defaults to a preview on HEAD and invalid input creates no tags', (t) => {
  const repo = fixture();
  t.after(repo.cleanup);
  for (const args of [
    [],
    ['preview', 'promote'],
    ['stable', 'promote'],
    ['stable', 'patch', 'extra'],
  ]) {
    assert.equal(repo.run(...args).status, 1);
    assert.equal(repo.git('tag'), '');
  }
  repo.git('tag', 'v1.0.0-preview');
  assert.equal(repo.run('stable', 'promote', 'v2.0.0-preview').status, 1);
  const dryRun = repo.run('stable', 'promote', '--dry-run');
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(repo.git('tag'), 'v1.0.0-preview');
  const result = repo.run('stable', 'promote');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(repo.git('rev-parse', 'v1.0.0^{commit}'), repo.git('rev-parse', 'HEAD'));
});
