import { z } from 'zod';

/**
 * The part of the release tooling's JSON (`scripts/changelog.ts`, ADR 0017) this site
 * renders. Its text is unescaped commit text, so it is only ever rendered as text.
 */
export const CHANGELOG_SCHEMA_VERSION = 1;

const entrySchema = z.object({
  commit: z.string(),
  scope: z.string().nullable(),
  description: z.string(),
  breakingNote: z.string().nullable(),
  url: z.string(),
});

const releaseSchema = z.object({
  tag: z.string().nullable(),
  version: z.string().nullable(),
  channel: z.enum(['stable', 'preview']),
  date: z.string().nullable(),
  promotedFrom: z.string().nullable(),
  urls: z.object({ release: z.string().nullable(), compare: z.string() }),
  protocol: z.object({ summary: z.string().nullable() }),
  breaking: z.boolean(),
  sections: z.array(z.object({ id: z.string(), title: z.string(), entries: z.array(entrySchema) })),
});
export type Release = z.infer<typeof releaseSchema>;

export const changelogSchema = z.object({
  schemaVersion: z.literal(CHANGELOG_SCHEMA_VERSION),
  repository: z.string(),
  releases: z.array(releaseSchema),
});
export type Changelog = z.infer<typeof changelogSchema>;

/** A release that has a version, which every tagged one does. */
export type TaggedRelease = Release & { version: string };

export function taggedReleases(changelog: Changelog | null): TaggedRelease[] {
  return (changelog?.releases ?? []).filter(
    (release): release is TaggedRelease => release.version !== null,
  );
}
