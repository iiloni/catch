import generated from '@/generated/changelog.json';
import { changelogSchema, taggedReleases } from '@/lib/changelog';

/** Null when the build had no Git history to derive it from (`scripts/changelog.ts`). */
export const changelog = generated === null ? null : changelogSchema.parse(generated);
export const releases = taggedReleases(changelog);
/** The newest stable release, which the site is built from and describes (ADR 0020). */
export const stableVersion =
  releases.find((release) => release.channel === 'stable')?.version ?? null;
