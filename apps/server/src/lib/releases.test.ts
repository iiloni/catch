import { afterEach, describe, expect, it, vi } from 'vitest';
import { listReleases, releasesForChannel } from './releases';

const release = (tag: string, overrides = {}) => ({
  tag_name: tag,
  name: `Catch ${tag.slice(1)}`,
  draft: false,
  prerelease: tag.endsWith('-preview'),
  published_at: '2026-10-01T00:00:00Z',
  ...overrides,
});
const releases = [
  release('v1.9.0'),
  release('v1.10.0'),
  release('v2.0.0-preview'),
  release('v1.9.1-preview'),
  release('v3.0.0', { draft: true }),
  release('v4.0.0', { published_at: null }),
  release('v5.0.0', { prerelease: true }),
  release('v6.0.0-preview', { prerelease: false }),
  release('unrelated'),
];
afterEach(() => vi.unstubAllGlobals());

describe('GitHub release listing', () => {
  it('shows only published releases for the server channel, newest version first', () => {
    expect(releasesForChannel(releases, 'stable').map((r) => r.version)).toEqual([
      '1.10.0',
      '1.9.0',
    ]);
    expect(releasesForChannel(releases, 'preview').map((r) => r.version)).toEqual([
      '2.0.0-preview',
      '1.9.1-preview',
    ]);
    expect(releasesForChannel(releases, 'dev')).toEqual([]);
  });

  it('does not contact GitHub for a development server', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await listReleases('dev')).toEqual({ channel: 'dev', releases: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shares and caches successful GitHub reads across channels', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(releases));
    vi.stubGlobal('fetch', fetch);
    const [stable, preview] = await Promise.all([listReleases('stable'), listReleases('preview')]);
    expect(stable.releases).toHaveLength(2);
    expect(preview.releases).toHaveLength(2);
    await listReleases('stable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
