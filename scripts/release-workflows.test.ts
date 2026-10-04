import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

function stepLines(file: string, name: string) {
  const lines = readFileSync(
    new URL(`../.github/workflows/${file}`, import.meta.url),
    'utf8',
  ).split('\n');
  const step = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(step, -1, `Missing step: ${name}`);
  const indent = lines[step].length - lines[step].trimStart().length;
  const end = lines.findIndex(
    (line, index) =>
      index > step &&
      line.trim() !== '' &&
      !line.trimStart().startsWith('#') &&
      !line.startsWith(' '.repeat(indent + 1)),
  );
  return lines.slice(step, end === -1 ? undefined : end);
}

function stepBody(file: string, name: string, key: 'run' | 'script') {
  const lines = stepLines(file, name);
  const body = lines.findIndex((line) => line.trim() === `${key}: |`);
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

function stepValues(
  file: string,
  name: string,
  key: 'env' | 'with',
  bindings: Record<string, string>,
) {
  const lines = stepLines(file, name);
  const section = lines.findIndex((line) => line.trim() === `${key}:`);
  if (section === -1) return {};
  const indent = lines[section].length - lines[section].trimStart().length + 2;
  const values: Record<string, string> = {};
  for (const line of lines.slice(section + 1)) {
    if (!line.trim()) continue;
    if (!line.startsWith(' '.repeat(indent))) break;
    const field = /^([\w-]+): (.*)$/.exec(line.slice(indent));
    assert.ok(field, `Unsupported ${key} field: ${line}`);
    const expression = /^\$\{\{ (.+) \}\}$/.exec(field[2]);
    if (expression) {
      assert.ok(Object.hasOwn(bindings, expression[1]), `Missing binding: ${expression[1]}`);
    }
    values[field[1]] = expression ? bindings[expression[1]] : field[2];
  }
  return values;
}

// GitHub drops a job output that contains a secret's value, and the documented key alias
// is "catch", so these names must be built in the jobs that use them.
test('Release names the image and APK without passing them between jobs', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(workflow, /needs\.version\.outputs\.(image|apk)/);
  assert.match(workflow, /RELEASE_APK: catch-\$\{\{ needs\.version\.outputs\.version \}\}\.apk\n/);
  assert.match(
    workflow,
    /tags: \$\{\{ env\.IMAGE \}\}:\$\{\{ needs\.version\.outputs\.version \}\}\n/,
  );
  assert.equal(workflow.split('- name: Name image\n').length - 1, 2);

  const directory = mkdtempSync(join(tmpdir(), 'catch-release-'));
  try {
    const GITHUB_ENV = join(directory, 'env');
    writeFileSync(GITHUB_ENV, '');
    const result = spawnSync('bash', ['-e', '-c', stepBody('release.yml', 'Name image', 'run')], {
      env: { PATH: process.env.PATH, GITHUB_ENV, GITHUB_REPOSITORY: 'Iiloni/Catch' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(GITHUB_ENV, 'utf8'), 'IMAGE=ghcr.io/iiloni/catch\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Release rejects branch refs even when their name looks like a release tag', () => {
  const script = stepBody('release.yml', 'Require a release tag', 'run');
  for (const REF_TYPE of ['branch', '', 'tag']) {
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: {
        PATH: process.env.PATH,
        ...stepValues('release.yml', 'Require a release tag', 'env', {
          'github.ref_type': REF_TYPE,
          'github.ref_name': 'v1.2.3',
        }),
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, REF_TYPE === 'tag' ? 0 : 1, result.stderr);
  }
});

test('preparation executes the trusted helper even when the target replaces release code', (t) => {
  const checkout = stepValues('tag-release.yml', 'Checkout trusted release helper', 'with', {
    'steps.trusted.outputs.sha': 'c'.repeat(40),
    'github.sha': 'd'.repeat(40),
  });
  assert.equal(checkout.ref, 'c'.repeat(40), 'Helper must come from the trusted commit');
  const cwd = mkdtempSync(join(tmpdir(), 'catch-release-target-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GITHUB_OUTPUT: undefined,
    GITHUB_WORKSPACE: fileURLToPath(new URL('../', import.meta.url)),
    ...stepValues('tag-release.yml', 'Create annotated release tag', 'env', {
      'inputs.channel': 'preview',
      'inputs.version_type': 'minor',
    }),
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
      {
        github,
        core: { summary },
        context,
        process: {
          env: stepValues('tag-release.yml', 'Publish annotated release tag', 'env', {
            'needs.prepare.outputs.tag': tag,
            'github.ref_name': 'main',
          }),
        },
      },
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
      process: {
        env: stepValues('tag-release.yml', 'Start release builds on the new tag', 'env', {
          'needs.prepare.outputs.tag': 'v1.2.3',
          'github.ref_name': 'main',
        }),
      },
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

test('published notes list the changes ahead of the artifact details', (t) => {
  for (const name of ['Checkout version history', 'Checkout release history']) {
    const checkout = stepValues('release.yml', name, 'with', { 'github.sha': 'd'.repeat(40) });
    assert.equal(checkout['fetch-depth'], '0', `${name} must fetch tags and full history`);
    assert.equal(checkout['persist-credentials'], 'false');
  }
  const cwd = mkdtempSync(join(tmpdir(), 'catch-release-notes-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GITHUB_WORKSPACE: fileURLToPath(new URL('../', import.meta.url)),
    GITHUB_REPOSITORY: 'iiloni/catch',
    GITHUB_STEP_SUMMARY: join(cwd, 'summary.md'),
    RUNNER_TEMP: cwd,
    RELEASE_TAG: 'v0.2.0-preview',
    CHANNEL: 'preview',
    VERSION: '0.2.0-preview',
    VERSION_CODE: '12',
    IMAGE: 'ghcr.io/iiloni/catch',
    DIGEST: `sha256:${'e'.repeat(64)}`,
    GITHUB_SHA: 'd'.repeat(40),
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@example.com');
  for (const [subject, tag] of [
    ['feat: earlier work', 'v0.1.0-preview'],
    ['fix(notes): `$(touch executed)` stays text (#4)', 'v0.2.0-preview'],
  ]) {
    git('-c', 'commit.gpgSign=false', 'commit', '--quiet', '--allow-empty', '-m', subject);
    git('tag', tag);
  }
  const run = (name: string) =>
    spawnSync('bash', ['-e', '-c', stepBody('release.yml', name, 'run')], {
      cwd,
      env,
      encoding: 'utf8',
    });
  // A retried publish job writes the same notes again for the existing draft.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = run('Prepare release notes');
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(existsSync(join(cwd, 'executed')), false);
  assert.equal(
    readFileSync(join(cwd, 'release-notes.md'), 'utf8'),
    `Changes since [0.1.0-preview](https://github.com/iiloni/catch/releases/tag/v0.1.0-preview).

### Fixes

- **notes:** \`$(touch executed)\` stays text ([#4](https://github.com/iiloni/catch/pull/4))

**Full changelog:** https://github.com/iiloni/catch/compare/v0.1.0-preview...v0.2.0-preview

## Release details

Channel: preview

Docker image: \`ghcr.io/iiloni/catch:0.2.0-preview\`

Pinned Docker image: \`ghcr.io/iiloni/catch@sha256:${'e'.repeat(64)}\`

Source commit: \`${'d'.repeat(40)}\`

Android version code: 12

Download the signed APK and its SHA-256 checksum below. Stable and preview Android apps can be installed together.
`,
  );

  const preview = spawnSync(
    'bash',
    [
      '-e',
      '-c',
      stepLines('release.yml', 'Preview release notes')
        .at(-1)!
        .replace(/^\s*run: /, ''),
    ],
    { cwd, env, encoding: 'utf8' },
  );
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /^Changes since \[0\.1\.0-preview\]/);
  // A tag the checkout does not have stops the release before its builds.
  const missing = spawnSync(
    'bash',
    ['-e', '-c', stepBody('release.yml', 'Prepare release notes', 'run')],
    { cwd, env: { ...env, RELEASE_TAG: 'v0.3.0-preview' }, encoding: 'utf8' },
  );
  assert.equal(missing.status, 1);
});
