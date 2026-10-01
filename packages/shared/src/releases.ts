import { z } from 'zod';

export const GITHUB_REPOSITORY = 'iiloni/catch';
export const REPOSITORY_URL = `https://github.com/${GITHUB_REPOSITORY}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
export const releaseChannelSchema = z.enum(['stable', 'preview', 'dev']);
export const versionInfoSchema = z.object({
  version: z.string().nullable(),
  channel: releaseChannelSchema,
});
export type VersionInfo = z.infer<typeof versionInfoSchema>;

export function parseReleaseVersion(version: string | null) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-preview)?$/.exec(version ?? '');
  if (!match || match[0] !== version) return null;
  return {
    parts: match.slice(1, 4).map(BigInt),
    channel: match[4] ? ('preview' as const) : ('stable' as const),
  };
}

export function compareReleaseVersions(left: string, right: string) {
  const a = parseReleaseVersion(left);
  const b = parseReleaseVersion(right);
  if (!a || !b) throw new Error('Invalid release version');
  for (let index = 0; index < a.parts.length; index++) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index]! > b.parts[index]! ? 1 : -1;
  }
  if (a.channel === b.channel) return 0;
  return a.channel === 'stable' ? 1 : -1;
}

export function androidUpdateAvailable(app: VersionInfo | null, server: VersionInfo | null) {
  if (!app?.version || !server?.version || app.channel !== server.channel) return false;
  const installed = parseReleaseVersion(app.version);
  const target = parseReleaseVersion(server.version);
  return Boolean(
    installed &&
      target &&
      installed.channel === app.channel &&
      target.channel === server.channel &&
      compareReleaseVersions(server.version, app.version) > 0,
  );
}

export const releaseSchema = z.object({
  version: z.string(),
  name: z.string(),
  publishedAt: z.iso.datetime(),
});
export const releasesResponseSchema = z.object({
  channel: releaseChannelSchema,
  releases: z.array(releaseSchema),
});
export type ReleasesResponse = z.infer<typeof releasesResponseSchema>;
