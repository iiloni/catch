import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type Changelog,
  compareProtocols,
  parseCommit,
  parseProtocol,
  type Release,
  releaseRange,
} from './changelog.ts';

const script = fileURLToPath(new URL('./release.sh', import.meta.url));
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GITHUB_REPOSITORY: undefined,
};
const github = 'https://github.com/iiloni/catch';

const protocolSource = (version: number, min: number | string) => `import { z } from 'zod';
export const API_PROTOCOL_VERSION = ${version};
export const SUPPORTED_API_PROTOCOLS: ProtocolRange = { min: ${min}, max: API_PROTOCOL_VERSION };
`;

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'catch-changelog-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@example.com');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'tag.gpgSign', 'false');
  const run = (...args: string[]) =>
    spawnSync(script, ['changelog', '--repo', 'iiloni/catch', ...args], {
      cwd,
      env,
      encoding: 'utf8',
    });
  const json = <T>(...args: string[]) => {
    const result = run(...args, '--json');
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as T;
  };
  return {
    cwd,
    git,
    run,
    release: (...args: string[]) => json<Release>(...args),
    all: () => json<Changelog>('--all'),
    commit(subject: string, body = '') {
      git('commit', '--quiet', '--allow-empty', '-m', subject, ...(body ? ['-m', body] : []));
      return git('rev-parse', 'HEAD');
    },
    protocol(version: number, min: number | string, subject: string) {
      mkdirSync(join(cwd, 'packages/shared/src'), { recursive: true });
      writeFileSync(join(cwd, 'packages/shared/src/protocol.ts'), protocolSource(version, min));
      git('add', '.');
      git('commit', '--quiet', '-m', subject);
    },
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

const descriptions = (release: Release) =>
  Object.fromEntries(
    release.sections.map(({ id, entries }) => [id, entries.map((entry) => entry.description)]),
  );

test('commit subjects yield their type, scope, PR link and breaking markers', () => {
  const parse = (subject: string, body = '') =>
    parseCommit({ commit: 'a'.repeat(40), date: '2026-10-01T00:00:00Z', subject, body }, 'o/r');
  const squashed = parse('feat(tags)!: add nested tags (#3)');
  assert.deepEqual(
    {
      type: squashed.type,
      scope: squashed.scope,
      description: squashed.description,
      breaking: squashed.breaking,
      pr: squashed.pr,
      url: squashed.url,
    },
    {
      type: 'feat',
      scope: 'tags',
      description: 'add nested tags',
      breaking: true,
      pr: 3,
      url: 'https://github.com/o/r/pull/3',
    },
  );
  const direct = parse('fix: keep cached notes usable');
  assert.equal(direct.pr, null);
  assert.equal(direct.scope, null);
  assert.equal(direct.breaking, false);
  assert.equal(direct.url, `https://github.com/o/r/commit/${'a'.repeat(40)}`);

  const footer = parse(
    'feat(sync): enforce protocol compatibility',
    'Details.\n\nBREAKING CHANGE: clients must update;\nsync pauses until then.\nCo-Authored-By: A <a@example.com>\n\nMore.',
  );
  assert.equal(footer.breaking, true);
  assert.equal(footer.breakingNote, 'clients must update; sync pauses until then.');
  assert.equal(parse('fix: a', 'BREAKING-CHANGE: hyphenated').breakingNote, 'hyphenated');
  // Mentioning the words is not the footer.
  assert.equal(parse('docs: explain', 'A BREAKING CHANGE: footer marks these.').breaking, false);

  for (const subject of ['Initial', 'Merge the thing (#9)', 'feat:missing space', 'fix(): empty']) {
    const plain = parse(subject);
    assert.equal(plain.type, null, subject);
    assert.equal(plain.breaking, false, subject);
  }
  assert.equal(parse('Merge the thing (#9)').description, 'Merge the thing');
  assert.equal(parse('Merge the thing (#9)').pr, 9);
  // Only a trailing reference is the PR.
  assert.equal(parse('fix: revert (#4) properly').pr, null);
});

test('a preview counts from the highest lower tag and a stable release from the last stable', () => {
  const reachable = [
    { name: 'v0.3.3', commit: 'a' },
    { name: 'v0.4.0-preview', commit: 'b' },
    { name: 'v0.4.1-preview', commit: 'c' },
    { name: 'v0.4.2-preview', commit: 'd' },
    { name: 'not-a-release', commit: 'd' },
  ];
  assert.deepEqual(
    releaseRange({ tag: 'v0.4.2-preview', channel: 'preview', commit: 'd' }, reachable),
    { previous: 'v0.4.1-preview', previews: [], promotedFrom: null },
  );
  assert.deepEqual(releaseRange({ tag: 'v0.4.2', channel: 'stable', commit: 'd' }, reachable), {
    previous: 'v0.3.3',
    previews: ['v0.4.0-preview', 'v0.4.1-preview', 'v0.4.2-preview'],
    promotedFrom: 'v0.4.2-preview',
  });
  // A same-version preview on another commit was not promoted.
  assert.equal(
    releaseRange({ tag: 'v0.4.2', channel: 'stable', commit: 'e' }, reachable).promotedFrom,
    null,
  );
  // A stable tag on the preview's commit is a later release, not the preview's baseline.
  assert.equal(
    releaseRange({ tag: 'v0.4.2-preview', channel: 'preview', commit: 'd' }, [
      ...reachable,
      { name: 'v0.4.2', commit: 'd' },
    ]).previous,
    'v0.4.1-preview',
  );
  assert.deepEqual(releaseRange({ tag: null, channel: 'preview', commit: 'e' }, reachable), {
    previous: 'v0.4.2-preview',
    previews: [],
    promotedFrom: null,
  });
  assert.equal(
    releaseRange({ tag: null, channel: 'stable', commit: 'e' }, reachable).previous,
    'v0.3.3',
  );
  assert.deepEqual(releaseRange({ tag: 'v0.1.0', channel: 'stable', commit: 'a' }, []), {
    previous: null,
    previews: [],
    promotedFrom: null,
  });
});

test('the protocol is read from source, and this checkout declares one', () => {
  assert.equal(parseProtocol(null), null);
  assert.deepEqual(parseProtocol(protocolSource(3, 2)), { version: 3, min: 2, max: 3 });
  assert.deepEqual(parseProtocol(protocolSource(1, 'API_PROTOCOL_VERSION')), {
    version: 1,
    min: 1,
    max: 1,
  });
  assert.throws(() => parseProtocol('export const API_PROTOCOL_VERSION = next();'), /protocol/);
  // A release cannot publish if this file stops being readable, so fail here first.
  const current = parseProtocol(
    readFileSync(new URL('../packages/shared/src/protocol.ts', import.meta.url), 'utf8'),
  );
  assert.ok(current && current.min <= current.version && current.version <= current.max);
});

test('protocol changes state both ranges and the upgrade order', () => {
  const at = (version: number, min: number, max = version) => ({ version, min, max });
  assert.equal(compareProtocols(at(2, 2), at(2, 2)).changed, false);
  assert.equal(compareProtocols(at(2, 2), at(2, 2)).summary, null);
  // No earlier tag, or neither end has the file: nothing to compare.
  assert.equal(compareProtocols(undefined, at(2, 2)).changed, false);
  assert.equal(compareProtocols(null, null).changed, false);
  assert.throws(() => compareProtocols(at(2, 2), null), /missing/);

  const incompatible = compareProtocols(at(1, 1), at(2, 2));
  assert.equal(incompatible.changed, true);
  assert.match(incompatible.summary ?? '', /app 1 → 2; server supports 1 → 2\./);
  assert.match(incompatible.summary ?? '', /Update the server first, then every app/);

  const widened = compareProtocols(at(2, 2), at(3, 2));
  assert.match(widened.summary ?? '', /server supports 2 → 2–3\./);
  assert.match(widened.summary ?? '', /Update the server before the apps/);

  const narrowed = compareProtocols(at(2, 1, 3), at(3, 3));
  assert.match(narrowed.summary ?? '', /server supports 1–3 → 3\./);
  assert.match(narrowed.summary ?? '', /Update the apps before the server/);

  const introduced = compareProtocols(null, at(1, 1));
  assert.equal(introduced.changed, true);
  assert.match(introduced.summary ?? '', /API protocol 1 is introduced/);
});

test('previews, a promoted stable release and unreleased work each cover their own range', (t) => {
  const repo = fixture();
  t.after(repo.cleanup);
  repo.commit('Initial');
  repo.commit('feat: first feature');
  repo.git('tag', '-a', 'v0.1.0-preview', '-m', 'Catch 0.1.0-preview');
  repo.git('tag', 'v0.1.0');
  repo.protocol(1, 1, 'feat(sync)!: add the protocol gate');
  repo.git('tag', '-a', 'v0.2.0-preview', '-m', 'Catch 0.2.0-preview');
  const direct = repo.commit('fix(notes): direct fix');
  repo.commit('feat(tags): squashed feature (#7)', 'BREAKING CHANGE: tags moved.');
  repo.commit('ci: faster checks (#8)');
  repo.git('tag', '-a', 'v0.2.1-preview', '-m', 'Catch 0.2.1-preview');
  const tested = repo.git('rev-parse', 'HEAD');
  repo.protocol(2, 2, 'feat(sync)!: raise the protocol (#9)');
  repo.git('tag', 'v0.2.2-preview');
  repo.git('tag', '-a', 'v0.2.1', '-m', 'Catch 0.2.1', tested);
  repo.commit('Tidy up <b>markup</b> and ![img](http://x) in `<code>[0]`');

  const first = repo.release('v0.1.0-preview');
  assert.equal(first.previous, null);
  assert.equal(first.urls.compare, `${github}/commits/v0.1.0-preview`);
  assert.deepEqual(descriptions(first), { features: ['first feature'], other: ['Initial'] });
  assert.equal(first.protocol.changed, false);

  // The stable tag on the same commit is this preview's promotion, not its baseline.
  const promotedFirst = repo.release('v0.1.0');
  assert.equal(promotedFirst.previous, null);
  assert.equal(promotedFirst.promotedFrom, 'v0.1.0-preview');

  const preview = repo.release('v0.2.1-preview');
  assert.equal(preview.previous, 'v0.2.0-preview');
  assert.equal(preview.channel, 'preview');
  assert.equal(preview.commit, tested);
  assert.equal(preview.breaking, true);
  assert.deepEqual(descriptions(preview), {
    breaking: ['squashed feature'],
    fixes: ['direct fix'],
    other: ['faster checks'],
  });
  assert.equal(preview.urls.compare, `${github}/compare/v0.2.0-preview...v0.2.1-preview`);
  assert.equal(preview.urls.changelog, preview.urls.compare);
  assert.equal(preview.urls.release, `${github}/releases/tag/v0.2.1-preview`);
  assert.equal(preview.protocol.changed, false);
  const [breaking, fix] = preview.sections.map(({ entries }) => entries[0]);
  assert.equal(breaking.url, `${github}/pull/7`);
  assert.equal(breaking.breakingNote, 'tags moved.');
  assert.equal(fix.url, `${github}/commit/${direct}`);
  assert.match(preview.date ?? '', /^\d{4}-\d\d-\d\dT/);

  // Promoting the earlier preview folds in everything since the last stable release and
  // leaves out the work after the promoted commit.
  const stable = repo.release('v0.2.1');
  assert.equal(stable.previous, 'v0.1.0');
  assert.equal(stable.commit, tested);
  assert.equal(stable.promotedFrom, 'v0.2.1-preview');
  assert.deepEqual(stable.previews, ['v0.2.0-preview', 'v0.2.1-preview']);
  assert.deepEqual(descriptions(stable), {
    breaking: ['squashed feature', 'add the protocol gate'],
    fixes: ['direct fix'],
    other: ['faster checks'],
  });
  assert.deepEqual(stable.protocol.from, null);
  assert.deepEqual(stable.protocol.to, { version: 1, min: 1, max: 1 });
  assert.equal(stable.protocol.changed, true);

  const later = repo.release('v0.2.2-preview');
  assert.equal(later.previous, 'v0.2.1');
  assert.deepEqual(descriptions(later), { breaking: ['raise the protocol'] });
  assert.deepEqual(later.protocol.from, { version: 1, min: 1, max: 1 });
  assert.deepEqual(later.protocol.to, { version: 2, min: 2, max: 2 });

  const unreleased = repo.release();
  assert.equal(unreleased.tag, null);
  assert.equal(unreleased.previous, 'v0.2.2-preview');
  assert.equal(unreleased.urls.compare, `${github}/compare/v0.2.2-preview...${unreleased.commit}`);
  assert.equal(repo.release('--channel', 'stable').previous, 'v0.2.1');

  const all = repo.all();
  assert.equal(all.schemaVersion, 1);
  assert.equal(all.repository, 'iiloni/catch');
  assert.deepEqual(
    all.releases.map(({ tag }) => tag),
    ['v0.2.2-preview', 'v0.2.1', 'v0.2.1-preview', 'v0.2.0-preview', 'v0.1.0', 'v0.1.0-preview'],
  );
  assert.deepEqual(all.releases[1], stable);
  assert.deepEqual(all.unreleased, unreleased);

  const notes = repo.run('v0.2.1');
  assert.equal(notes.status, 0, notes.stderr);
  assert.equal(
    notes.stdout,
    `Changes since [0.1.0](${github}/releases/tag/v0.1.0). Promotes [0.2.1-preview](${github}/releases/tag/v0.2.1-preview) to stable unchanged. Includes the changes from [0.2.0-preview](${github}/releases/tag/v0.2.0-preview).

> **Compatibility:** API protocol 1 is introduced; the server supports 1. The previous release has no compatibility check: sync or export pending changes, then update the server and every app together.

### Breaking changes

- **tags:** squashed feature ([#7](${github}/pull/7))
  - tags moved.
- **sync:** add the protocol gate ([${stable.sections[0].entries[1].commit.slice(0, 7)}](${stable.sections[0].entries[1].url}))

### Fixes

- **notes:** direct fix ([${direct.slice(0, 7)}](${github}/commit/${direct}))

<details><summary>Other changes (1)</summary>

- ci: faster checks ([#8](${github}/pull/8))

</details>

**Full changelog:** ${github}/compare/v0.1.0...v0.2.1
`,
  );
  // Commit text cannot add markup to the notes, but code spans stay as written.
  assert.match(
    repo.run().stdout,
    /- Tidy up &lt;b>markup&lt;\/b> and !\\\[img\\\]\(http:\/\/x\) in `<code>\[0\]` \(\[/,
  );
  const document = repo.run('--all');
  assert.match(document.stdout, /^# Changelog\n\n## Unreleased\n/);
  assert.match(
    document.stdout,
    /\n## \[0\.2\.1\]\(.*\/releases\/tag\/v0\.2\.1\) \(\d{4}-\d\d-\d\d\)\n/,
  );

  // An empty range and a HEAD with nothing unreleased are both reportable.
  repo.git('tag', 'v0.3.0-preview');
  repo.git('tag', 'v0.3.1-preview');
  assert.deepEqual(repo.release('v0.3.1-preview').sections, []);
  assert.match(repo.run('v0.3.1-preview').stdout, /\nNo changes\.\n/);
  assert.equal(repo.all().unreleased, null);
});

test('missing tags, bad arguments and shallow clones fail without output', (t) => {
  const repo = fixture();
  t.after(repo.cleanup);
  repo.commit('feat: one');
  repo.commit('feat: two');
  repo.git('tag', 'v0.1.0');
  for (const args of [
    ['v0.2.0'],
    ['main'],
    ['v0.1.0', 'v0.1.0'],
    ['v0.1.0', '--all'],
    ['v0.1.0', '--channel', 'stable'],
    ['--channel', 'nightly'],
  ]) {
    const result = repo.run(...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.equal(result.stdout, '');
  }
  const missingRepository = spawnSync(script, ['changelog'], {
    cwd: repo.cwd,
    env,
    encoding: 'utf8',
  });
  assert.equal(missingRepository.status, 1);
  assert.match(missingRepository.stderr, /--repo/);
  repo.git('remote', 'add', 'origin', 'git@github.com:Someone/Fork.git');
  const fromRemote = spawnSync(script, ['changelog', 'v0.1.0'], {
    cwd: repo.cwd,
    env,
    encoding: 'utf8',
  });
  assert.match(fromRemote.stdout, /https:\/\/github\.com\/Someone\/Fork\/commits\/v0\.1\.0/);

  const shallow = mkdtempSync(join(tmpdir(), 'catch-changelog-shallow-'));
  t.after(() => rmSync(shallow, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--quiet', '--depth', '1', `file://${repo.cwd}`, shallow], { env });
  const result = spawnSync(script, ['changelog', 'v0.1.0', '--repo', 'iiloni/catch'], {
    cwd: shallow,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /full history/);
});
