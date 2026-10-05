import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changelogSchema, taggedReleases } from './changelog.ts';

const release = {
  tag: 'v1.2.0',
  version: '1.2.0',
  channel: 'stable',
  date: '2026-10-01T00:00:00Z',
  commit: 'abc',
  previous: 'v1.1.0',
  promotedFrom: null,
  previews: [],
  urls: { release: null, compare: 'https://example.com/compare', changelog: 'https://example.com' },
  protocol: { from: null, to: null, changed: false, summary: null },
  breaking: false,
  sections: [
    {
      id: 'features',
      title: 'Features',
      entries: [
        {
          commit: 'abc',
          date: '2026-10-01T00:00:00Z',
          subject: 'feat(notes): add a thing (#1)',
          type: 'feat',
          scope: 'notes',
          description: 'add a thing',
          breaking: false,
          breakingNote: null,
          pr: 1,
          url: 'https://example.com/pull/1',
        },
      ],
    },
  ],
};

test('reads the generator output and keeps what the page renders', () => {
  const changelog = changelogSchema.parse({
    schemaVersion: 1,
    repository: 'iiloni/catch',
    releases: [release],
    unreleased: null,
  });
  assert.equal(taggedReleases(changelog)[0]?.version, '1.2.0');
  assert.equal(changelog.releases[0]?.sections[0]?.entries[0]?.description, 'add a thing');
});

test('refuses a schema version it does not know', () => {
  assert.equal(
    changelogSchema.safeParse({ schemaVersion: 2, repository: 'iiloni/catch', releases: [] })
      .success,
    false,
  );
});

test('has no releases without a changelog', () => {
  assert.deepEqual(taggedReleases(null), []);
});
