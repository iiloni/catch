import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const releaseTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-preview)?$/;

export function parseReleaseTag(input: unknown) {
  const tag = z.string().max(128).parse(input);
  const match = releaseTag.exec(tag);
  if (!match || match[0] !== tag) {
    throw new Error('Use vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-preview.');
  }
  return {
    version: tag.slice(1),
    channel: match[4] ? 'preview' : 'stable',
    parts: match.slice(1, 4).map(BigInt),
  };
}

export function releaseMetadata(tag: unknown, repositoryInput: unknown, runNumber: unknown) {
  const { version, channel } = parseReleaseTag(tag);
  const repository = z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    .refine((value) => value === value.trim())
    .parse(repositoryInput);
  const versionCode = z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((value) => String(Number(value)) === value)
    .transform(Number)
    .pipe(z.number().int().min(1).max(2100000000))
    .parse(runNumber);
  return {
    tag: z.string().parse(tag),
    version,
    channel,
    prerelease: channel === 'preview',
    flavor: channel,
    gradle_task: channel === 'preview' ? 'assemblePreviewRelease' : 'assembleStableRelease',
    version_code: versionCode,
    image: `ghcr.io/${repository.toLowerCase()}`,
    apk: `catch-${version}.apk`,
  };
}

export function compareReleaseTags(left: string, right: string) {
  const a = parseReleaseTag(left);
  const b = parseReleaseTag(right);
  for (let index = 0; index < a.parts.length; index++) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1;
  }
  if (a.channel === b.channel) return 0;
  return a.channel === 'stable' ? 1 : -1;
}

/** The supported release tags in `input`, lowest version first. */
export function releaseTags(input: unknown) {
  return z
    .array(z.string())
    .parse(input)
    .filter((tag) => {
      try {
        parseReleaseTag(tag);
        return true;
      } catch {
        return false;
      }
    })
    .sort(compareReleaseTags);
}

export function nextReleaseTag(input: unknown, channelInput: unknown, bumpInput: unknown) {
  const channel = z.enum(['stable', 'preview']).parse(channelInput);
  const bump = z.enum(['major', 'minor', 'patch']).parse(bumpInput);
  const base = releaseTags(input).at(-1) ?? 'v0.0.0';
  const parts = parseReleaseTag(base).parts;
  const index = { major: 0, minor: 1, patch: 2 }[bump];
  parts[index] += 1n;
  for (let lower = index + 1; lower < parts.length; lower++) parts[lower] = 0n;
  const tag = `v${parts.join('.')}${channel === 'preview' ? '-preview' : ''}`;
  parseReleaseTag(tag);
  return { tag, base };
}

export function promotePreviewTag(input: unknown) {
  const release = parseReleaseTag(input);
  if (release.channel !== 'preview') throw new Error('Promotion requires a preview tag.');
  return `v${release.version.replace(/-preview$/, '')}`;
}

export function shouldPromote(tag: string, input: unknown) {
  const { channel } = parseReleaseTag(tag);
  const releases = z.array(z.object({ tagName: z.string(), isDraft: z.boolean() })).parse(input);
  let promote = true;
  for (const release of releases) {
    if (release.isDraft) continue;
    if (release.tagName === tag)
      throw new Error(`Release ${tag} is already published; create a new tag.`);
    if (!releaseTag.test(release.tagName)) continue;
    if (
      parseReleaseTag(release.tagName).channel === channel &&
      compareReleaseTags(tag, release.tagName) < 0
    ) {
      promote = false;
    }
  }
  return promote;
}

function output(values: Record<string, string | number | boolean>) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  }
  console.log(JSON.stringify(values, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, tag = process.env.GITHUB_REF_NAME, file] = process.argv.slice(2);
    if (command === 'metadata') {
      output(releaseMetadata(tag, process.env.GITHUB_REPOSITORY, process.env.GITHUB_RUN_NUMBER));
    } else if (command === 'promotion' && tag && file) {
      output({ promote: shouldPromote(tag, JSON.parse(readFileSync(file, 'utf8'))) });
    } else {
      throw new Error('Usage: release.ts metadata [tag] | promotion <tag> <releases.json>');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
