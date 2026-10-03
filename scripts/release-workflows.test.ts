import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

function stepBody(file: string, name: string, key: 'run' | 'script') {
  const lines = readFileSync(
    new URL(`../.github/workflows/${file}`, import.meta.url),
    'utf8',
  ).split('\n');
  const step = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(step, -1, `Missing step: ${name}`);
  const body = lines.findIndex((line, index) => index > step && line.trim() === `${key}: |`);
  assert.notEqual(body, -1, `Missing ${key} body: ${name}`);
  const indent = lines[body].length - lines[body].trimStart().length + 2;
  const end = lines.findIndex(
    (line, index) => index > body && line.trim() !== '' && !line.startsWith(' '.repeat(indent)),
  );
  return lines
    .slice(body + 1, end === -1 ? undefined : end)
    .map((line) => line.slice(indent))
    .join('\n');
}

test('Release rejects branch refs even when their name looks like a release tag', () => {
  const script = stepBody('release.yml', 'Require a release tag', 'run');
  for (const REF_TYPE of ['branch', '', 'tag']) {
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: { PATH: process.env.PATH, REF_TYPE, GITHUB_REF_NAME: 'v1.2.3' },
      encoding: 'utf8',
    });
    assert.equal(result.status, REF_TYPE === 'tag' ? 0 : 1, result.stderr);
  }
});

test('preparation executes the trusted helper even when the target replaces release code', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'catch-release-target-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GITHUB_OUTPUT: undefined,
    GITHUB_WORKSPACE: fileURLToPath(new URL('../', import.meta.url)),
    CHANNEL: 'preview',
    VERSION_TYPE: 'minor',
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@example.com');
  mkdirSync(join(cwd, 'scripts'));
  writeFileSync(join(cwd, 'scripts/release.sh'), '#!/bin/bash\ntouch executed\nexit 1\n');
  writeFileSync(join(cwd, 'package.json'), '{"scripts":{"preinstall":"touch executed"}}');
  git('add', '.');
  git('-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'Untrusted target');
  const head = git('rev-parse', 'HEAD');
  const result = spawnSync(
    'bash',
    ['-e', '-c', stepBody('tag-release.yml', 'Create annotated release tag', 'run')],
    {
      cwd,
      env,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(cwd, 'executed')), false);
  assert.equal(git('cat-file', '-t', 'v0.1.0-preview'), 'tag');
  assert.equal(git('rev-parse', 'v0.1.0-preview^{commit}'), head);
});

const context = {
  repo: { owner: 'iiloni', repo: 'catch' },
  sha: 'a'.repeat(40),
};

function publish(tag: string, collision = false) {
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const summary = {
    addRaw: (_text: string) => summary,
    write: async () => {},
  };
  const github = {
    rest: {
      git: {
        createTag: async (input: Record<string, unknown>) => {
          calls.push({ method: 'createTag', input: structuredClone(input) });
          return { data: { sha: 'b'.repeat(40) } };
        },
        createRef: async (input: Record<string, unknown>) => {
          calls.push({ method: 'createRef', input: structuredClone(input) });
          if (collision) throw new Error('Reference already exists');
        },
      },
    },
  };
  return {
    calls,
    result: runInNewContext(
      `(async () => { ${stepBody('tag-release.yml', 'Publish annotated release tag', 'script')} })()`,
      { github, core: { summary }, context, process: { env: { RELEASE_TAG: tag } } },
    ) as Promise<void>,
  };
}

test('privileged publication annotates the dispatch commit and references the tag object', async () => {
  const { result, calls } = publish('v1.2.3-preview');
  await result;
  assert.deepEqual(calls, [
    {
      method: 'createTag',
      input: {
        ...context.repo,
        tag: 'v1.2.3-preview',
        message: 'Catch 1.2.3-preview',
        object: context.sha,
        type: 'commit',
        tagger: {
          name: 'github-actions[bot]',
          email: '41898282+github-actions[bot]@users.noreply.github.com',
        },
      },
    },
    {
      method: 'createRef',
      input: { ...context.repo, ref: 'refs/tags/v1.2.3-preview', sha: 'b'.repeat(40) },
    },
  ]);
});

test('invalid preparation output is rejected before any GitHub write', async () => {
  for (const tag of [
    '',
    'main',
    'v01.2.3',
    'v1.2.3-preview.1',
    'v1.2.3\n',
    `v${'1'.repeat(129)}.0.0`,
  ]) {
    const { result, calls } = publish(tag);
    await assert.rejects(result, /Invalid release tag/);
    assert.deepEqual(calls, []);
  }
});

test('a conflicting remote tag fails instead of overwriting the reference', async () => {
  const { result, calls } = publish('v1.2.3', true);
  await assert.rejects(result, /Reference already exists/);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['createTag', 'createRef'],
  );
});

test('Release is dispatched on the published tag rather than the selected branch', async () => {
  let dispatched: Record<string, unknown> | undefined;
  await runInNewContext(
    `(async () => { ${stepBody('tag-release.yml', 'Start release builds on the new tag', 'script')} })()`,
    {
      context,
      process: { env: { RELEASE_TAG: 'v1.2.3' } },
      github: {
        rest: {
          actions: {
            createWorkflowDispatch: async (input: Record<string, unknown>) => {
              dispatched = { ...input };
            },
          },
        },
      },
    },
  );
  assert.deepEqual(dispatched, { ...context.repo, workflow_id: 'release.yml', ref: 'v1.2.3' });
});
