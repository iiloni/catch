import {
  compareReleaseVersions,
  GITHUB_REPOSITORY,
  parseReleaseVersion,
  type ReleasesResponse,
  type VersionInfo,
} from '@catch/shared';
import { z } from 'zod';

const githubReleasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    name: z.string().nullable(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.iso.datetime().nullable(),
  }),
);

export function releasesForChannel(input: unknown, channel: VersionInfo['channel']) {
  return githubReleasesSchema
    .parse(input)
    .flatMap((release) => {
      if (!release.tag_name.startsWith('v')) return [];
      const version = release.tag_name.slice(1);
      const parsed = parseReleaseVersion(version);
      if (
        !parsed ||
        parsed.channel !== channel ||
        release.draft ||
        !release.published_at ||
        release.prerelease !== (channel === 'preview')
      )
        return [];
      return [
        { version, name: release.name || `Catch ${version}`, publishedAt: release.published_at },
      ];
    })
    .sort((a, b) => compareReleaseVersions(b.version, a.version))
    .slice(0, 10);
}

let cached: { at: number; data: unknown } | null = null;
let pending: Promise<unknown> | null = null;

async function fetchReleases() {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases?per_page=100`,
    {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Catch' },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error('GitHub releases are unavailable');
  const data = githubReleasesSchema.parse(await response.json());
  cached = { at: Date.now(), data };
  return data;
}

export async function listReleases(channel: VersionInfo['channel']): Promise<ReleasesResponse> {
  if (channel === 'dev') return { channel, releases: [] };
  let data = cached?.data;
  if (!cached || Date.now() - cached.at > 5 * 60_000) {
    pending ??= fetchReleases().finally(() => {
      pending = null;
    });
    data = await pending;
  }
  return { channel, releases: releasesForChannel(data, channel) };
}
