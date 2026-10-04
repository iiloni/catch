import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareReleaseTags,
  nextReleaseTag,
  promotePreviewTag,
  releaseMetadata,
  shouldPromote,
} from './release.ts';

test('stable and preview choose separate image channels and Android variants', () => {
  const stable = releaseMetadata('v0.4.1', 'Iiloni/Catch', '7');
  const preview = releaseMetadata('v1.0.2-preview', 'Iiloni/Catch', '8');
  assert.equal(stable.channel, 'stable');
  assert.equal(stable.prerelease, false);
  assert.equal(stable.gradle_task, 'assembleStableRelease');
  assert.equal(preview.channel, 'preview');
  assert.equal(preview.prerelease, true);
  assert.equal(preview.gradle_task, 'assemblePreviewRelease');
  assert.equal(preview.version, '1.0.2-preview');
  assert.equal(preview.version_code, 8);
});

test('malformed or unsupported tags cannot reach publishing', () => {
  for (const tag of [
    'main',
    '1.2.3',
    'v1.2',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2.3-preview.0',
    'v1.2.3-preview.1',
    'v1.2.3-preview.01',
    'v1.2.3-beta.1',
    'v1.2.3+build.1',
    'v1.2.3\n',
    'v1.2.3\nimage=other',
    `v${'1'.repeat(129)}.0.0`,
  ]) {
    assert.throws(() => releaseMetadata(tag, 'iiloni/catch', '1'));
  }
});

test('invalid Android build numbers and repository names are rejected', () => {
  for (const number of ['', '0', '-1', '1.2', '01', '2100000001', '9007199254740992']) {
    assert.throws(() => releaseMetadata('v1.0.0', 'iiloni/catch', number));
  }
  assert.throws(() => releaseMetadata('v1.0.0', 'iiloni/catch\nimage=other', '1'));
  assert.throws(() => releaseMetadata('v1.0.0', 'iiloni/catch\n', '1'));
  assert.equal(releaseMetadata('v1.0.0', 'iiloni/catch', '2100000000').version_code, 2100000000);
});

test('preview versions use numeric core ordering and precede their stable version', () => {
  assert.equal(compareReleaseTags('v1.10.0', 'v1.9.9'), 1);
  assert.equal(compareReleaseTags('v1.0.10-preview', 'v1.0.2-preview'), 1);
  assert.equal(compareReleaseTags('v1.0.0', 'v1.0.0-preview'), 1);
  assert.equal(compareReleaseTags('v1.0.0-preview', 'v1.0.0'), -1);
  assert.equal(compareReleaseTags('v1.0.0-preview', 'v1.0.0-preview'), 0);
  assert.equal(compareReleaseTags('v1.0.0', 'v1.0.0'), 0);
});

test('channels advance independently and backports do not move aliases backwards', () => {
  const releases = [
    { tagName: 'v0.4.1', isDraft: false },
    { tagName: 'v1.0.2-preview', isDraft: false },
    { tagName: 'v2.0.0', isDraft: true },
    { tagName: 'old-release', isDraft: false },
  ];
  assert.equal(shouldPromote('v0.4.2', releases), true);
  assert.equal(shouldPromote('v1.0.3-preview', releases), true);
  assert.equal(shouldPromote('v0.3.9', releases), false);
  assert.equal(shouldPromote('v1.0.1-preview', releases), false);
  assert.throws(() => shouldPromote('v0.4.1', releases));
  assert.throws(() => shouldPromote('v1.0.2-preview', releases));
  assert.throws(() => shouldPromote('v0.4.2', [{}]));
  assert.throws(() => shouldPromote('v0.4.2', null));
});

test('bumps use the highest core version across channels and reset lower components', () => {
  const tags = ['v0.3.3', 'v0.4.1-preview', 'v0.4.0-preview', 'other', 'v0.4.1-preview.1'];
  assert.deepEqual(nextReleaseTag(tags, 'preview', 'patch'), {
    tag: 'v0.4.2-preview',
    base: 'v0.4.1-preview',
  });
  assert.equal(nextReleaseTag(tags, 'stable', 'minor').tag, 'v0.5.0');
  assert.equal(nextReleaseTag(tags, 'preview', 'major').tag, 'v1.0.0-preview');
  assert.equal(
    nextReleaseTag(['v1.9.9', 'v1.10.0-preview'], 'preview', 'patch').tag,
    'v1.10.1-preview',
  );
});

test('the first bump starts at 0.0.0 and promotion preserves the preview core', () => {
  assert.equal(nextReleaseTag([], 'preview', 'minor').tag, 'v0.1.0-preview');
  assert.equal(nextReleaseTag([], 'stable', 'patch').tag, 'v0.0.1');
  assert.equal(nextReleaseTag([], 'stable', 'major').tag, 'v1.0.0');
  assert.equal(promotePreviewTag('v0.4.1-preview'), 'v0.4.1');
  assert.throws(() => promotePreviewTag('v0.4.1'));
  assert.throws(() => nextReleaseTag([], 'nightly', 'patch'));
  assert.throws(() => nextReleaseTag([], 'preview', 'promote'));
});
