import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { promotePreviewTag } from './release.ts';

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

test('Site follows completed Release runs and builds main with every release tag', () => {
  const workflow = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  assert.match(
    workflow,
    /\n {2}workflow_run:\n {4}workflows: \[Release\]\n {4}types: \[completed\]\n/,
  );
  assert.match(workflow, /\n {2}workflow_dispatch:\n/);
  assert.match(workflow, /\n {2}push:\n {4}branches: \[main\]\n/);
  assert.match(workflow, /\n {4}tags: \['v\*'\]\n/);
  assert.match(workflow, /\n {2}release:\n {4}types: \[published\]\n/);
  assert.match(
    workflow,
    /needs: eligibility\n {4}if: needs\.eligibility\.outputs\.published == 'true'\n/,
  );
  assert.match(workflow, /ref: main\n\s+fetch-depth: 0\n\s+fetch-tags: true\n/);
  assert.match(workflow, /SITE_CHANGELOG: required/);
  const release = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  assert.match(release, /^name: Release\n/);
});

test('Site accepts only successful same-repository dispatched Release runs when enabled', () => {
  const workflow = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  const condition = /\n {4}if: >-\n((?: {6}.+\n)+)/.exec(workflow)?.[1];
  assert.ok(condition, 'Missing deployment condition');
  const repository = 'iiloni/catch';
  for (const enabled of ['true', 'false', '']) {
    for (const event of ['push', 'release', 'workflow_dispatch', 'workflow_run']) {
      for (const conclusion of ['success', 'failure', 'cancelled', 'skipped', 'timed_out']) {
        for (const [source, trigger] of [
          [repository, 'workflow_dispatch'],
          [repository, 'push'],
          ['someone/catch', 'workflow_dispatch'],
        ]) {
          const actual: unknown = runInNewContext(condition, {
            vars: { CLOUDFLARE_SITE_ENABLED: enabled },
            github: {
              repository,
              event_name: event,
              event:
                event === 'workflow_run'
                  ? {
                      workflow_run: {
                        event: trigger,
                        conclusion,
                        head_repository: { full_name: source },
                      },
                    }
                  : {},
            },
          });
          const expected =
            enabled === 'true' &&
            (event !== 'workflow_run' ||
              (trigger === 'workflow_dispatch' &&
                conclusion === 'success' &&
                source === repository));
          assert.equal(
            actual,
            expected,
            `${enabled}, ${event}, ${trigger}, ${conclusion}, ${source}`,
          );
        }
      }
    }
  }
});

test('Site completion fallback requires a published GitHub Release and preserves API failures', async () => {
  for (const event of ['workflow_run', 'push', 'release', 'workflow_dispatch']) {
    for (const state of ['published', 'draft', 'missing', 'unavailable']) {
      const outputs: Record<string, string> = {};
      const calls: Record<string, unknown>[] = [];
      const result = runInNewContext(
        `(async () => { ${stepBody('site.yml', 'Verify release publication', 'script')} })()`,
        {
          context: { ...context, eventName: event },
          process: {
            env: stepValues('site.yml', 'Verify release publication', 'env', {
              'github.event.workflow_run.head_branch': 'v0.6.3-preview',
            }),
          },
          core: {
            setOutput: (key: string, value: string) => {
              outputs[key] = value;
            },
          },
          github: {
            rest: {
              repos: {
                getReleaseByTag: async (input: Record<string, unknown>) => {
                  calls.push(structuredClone(input));
                  if (state === 'missing' || state === 'unavailable') {
                    throw Object.assign(new Error(state), {
                      status: state === 'missing' ? 404 : 503,
                    });
                  }
                  return { data: { draft: state === 'draft' } };
                },
              },
            },
          },
        },
      ) as Promise<void>;
      if (event === 'workflow_run' && state === 'unavailable') {
        await assert.rejects(result, /unavailable/);
        assert.deepEqual(outputs, {});
      } else {
        await result;
        assert.equal(outputs.published, String(event !== 'workflow_run' || state === 'published'));
      }
      assert.deepEqual(
        calls,
        event === 'workflow_run' ? [{ ...context.repo, tag: 'v0.6.3-preview' }] : [],
      );
    }
  }
});

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

function promote(
  preview: string,
  options: {
    annotationDepth?: number;
    targetType?: string;
    missing?: boolean;
    collision?: boolean;
    dispatchFailure?: boolean;
  } = {},
) {
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const outputs: Record<string, string> = {};
  const commit = 'c'.repeat(40);
  let annotationDepth = options.annotationDepth ?? 0;
  const target = () => ({
    type: annotationDepth > 0 ? 'tag' : (options.targetType ?? 'commit'),
    sha: annotationDepth > 0 ? String(annotationDepth).padStart(40, '0') : commit,
  });
  const record = (method: string, input: Record<string, unknown>) => {
    calls.push({ method, input: structuredClone(input) });
  };
  const summary = {
    addRaw: (_text: string) => summary,
    write: async () => {},
  };
  const github = {
    rest: {
      git: {
        getRef: async (input: Record<string, unknown>) => {
          record('getRef', input);
          if (options.missing) throw new Error('Reference not found');
          return { data: { object: target() } };
        },
        getTag: async (input: Record<string, unknown>) => {
          assert.equal(input.tag_sha, target().sha);
          record('getTag', input);
          annotationDepth--;
          return { data: { object: target() } };
        },
        createTag: async (input: Record<string, unknown>) => {
          record('createTag', input);
          return { data: { sha: 'b'.repeat(40) } };
        },
        createRef: async (input: Record<string, unknown>) => {
          record('createRef', input);
          if (options.collision) throw new Error('Reference already exists');
        },
      },
      actions: {
        createWorkflowDispatch: async (input: Record<string, unknown>) => {
          record('createWorkflowDispatch', input);
          if (options.dispatchFailure) throw new Error('Dispatch failed');
        },
      },
    },
  };
  const run = (name: string, env: Record<string, string>) =>
    runInNewContext(`(async () => { ${stepBody('promote-release.yml', name, 'script')} })()`, {
      context,
      github,
      core: {
        summary,
        setOutput: (key: string, value: string) => {
          outputs[key] = value;
        },
      },
      process: { env },
    }) as Promise<void>;
  const result = (async () => {
    await run(
      'Promote preview tag',
      stepValues('promote-release.yml', 'Promote preview tag', 'env', {
        'inputs.preview_tag': preview,
      }),
    );
    await run(
      'Start stable release builds',
      stepValues('promote-release.yml', 'Start stable release builds', 'env', {
        'steps.promotion.outputs.tag': outputs.tag,
      }),
    );
  })();
  return { calls, outputs, commit, result };
}

test('promotion preserves an earlier preview commit for lightweight and annotated tags', async () => {
  for (const annotationDepth of [0, 1, 2]) {
    const preview = 'v0.4.1-preview';
    const { result, calls, outputs, commit } = promote(preview, { annotationDepth });
    await result;
    const stable = promotePreviewTag(preview);
    assert.notEqual(commit, context.sha, 'Preview predates the workflow dispatch commit');
    assert.deepEqual(calls[0], {
      method: 'getRef',
      input: { ...context.repo, ref: `tags/${preview}` },
    });
    assert.equal(calls.filter(({ method }) => method === 'getTag').length, annotationDepth);
    assert.deepEqual(calls.slice(-3), [
      {
        method: 'createTag',
        input: {
          ...context.repo,
          tag: stable,
          message: 'Catch 0.4.1',
          object: commit,
          type: 'commit',
          tagger: {
            name: 'github-actions[bot]',
            email: '41898282+github-actions[bot]@users.noreply.github.com',
          },
        },
      },
      {
        method: 'createRef',
        input: { ...context.repo, ref: `refs/tags/${stable}`, sha: 'b'.repeat(40) },
      },
      {
        method: 'createWorkflowDispatch',
        input: { ...context.repo, workflow_id: 'release.yml', ref: stable },
      },
    ]);
    assert.deepEqual(outputs, { tag: stable });
  }
});

test('promotion rejects invalid preview inputs before accessing GitHub', async () => {
  for (const preview of [
    '',
    'main',
    'v1.2.3',
    'v01.2.3-preview',
    'v1.2.3-preview.1',
    'v1.2.3-preview+build',
    ' v1.2.3-preview',
    'v1.2.3-preview\n',
    'v1.2.3-preview;$(touch executed)',
    `v${'1'.repeat(129)}.0.0-preview`,
  ]) {
    const { result, calls } = promote(preview);
    await assert.rejects(result, /Enter a preview tag/);
    assert.deepEqual(calls, []);
  }
});

test('missing previews and tags pointing to non-commits cannot create a stable tag', async () => {
  for (const options of [{ missing: true }, { targetType: 'tree' }, { targetType: 'blob' }]) {
    const { result, calls, outputs } = promote('v1.2.3-preview', options);
    await assert.rejects(result, /Reference not found|must point to a commit/);
    assert.deepEqual(
      calls.map(({ method }) => method),
      ['getRef'],
    );
    assert.deepEqual(outputs, {});
  }
});

test('a stable tag collision stops promotion without dispatching or overwriting', async () => {
  const { result, calls, outputs } = promote('v1.2.3-preview', { collision: true });
  await assert.rejects(result, /Reference already exists/);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['getRef', 'createTag', 'createRef'],
  );
  assert.deepEqual(outputs, {});
});

test('a failed release dispatch leaves the created stable tag available for recovery', async () => {
  const { result, calls, outputs } = promote('v1.2.3-preview', { dispatchFailure: true });
  await assert.rejects(result, /Dispatch failed/);
  assert.equal(calls.at(-1)?.method, 'createWorkflowDispatch');
  assert.deepEqual(outputs, { tag: 'v1.2.3' });
});

test('promotion requires the release switch before creating tags', () => {
  const script = stepBody('promote-release.yml', 'Require releases to be enabled', 'run');
  for (const ENABLED of ['false', '', 'true']) {
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: { PATH: process.env.PATH, ENABLED },
      encoding: 'utf8',
    });
    assert.equal(result.status, ENABLED === 'true' ? 0 : 1, result.stderr);
  }
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
