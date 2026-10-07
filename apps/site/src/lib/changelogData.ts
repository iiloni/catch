import generated from '@/generated/changelog.json';
import { changelogSchema, taggedReleases } from '@/lib/changelog';

/** Null when the build had no Git history to derive it from (`scripts/changelog.ts`). */
export const changelog = generated === null ? null : changelogSchema.parse(generated);
export const releases = taggedReleases(changelog);
