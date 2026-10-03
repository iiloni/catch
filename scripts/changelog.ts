import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { compareReleaseTags, parseReleaseTag, releaseTags } from './release.ts';

const usage = `Usage:
  ./scripts/release.sh changelog [vMAJOR.MINOR.PATCH[-preview]] [--json] [--repo owner/name]
  ./scripts/release.sh changelog [--channel <preview|stable>] [--json]
  ./scripts/release.sh changelog --all [--json]

Prints the changes in one release as Markdown. Without a tag it covers the unreleased
commits on HEAD: since the highest reachable tag, or since the highest reachable stable
tag with --channel stable. --all covers every release tag in the repository, newest first.
--json prints the structured form instead (see docs/releases.md). Reads local tags and
history only; fetch tags first and use a full clone.`;

/**
 * Where each release's changelog page lives, without a trailing slash; a version's page is
 * `<base>/<version>`. While this is null, release notes link to GitHub's compare view.
 */
export const CHANGELOG_BASE_URL: string | null = null;

/** Bump when the JSON output changes incompatibly for its consumers. */
export const CHANGELOG_SCHEMA_VERSION = 1;

const protocolPath = 'packages/shared/src/protocol.ts';

export type Channel = 'stable' | 'preview';
export type Protocol = { version: number; min: number; max: number };
type Tag = { name: string; commit: string; date: string };

const sections = [
  { id: 'breaking', title: 'Breaking changes' },
  { id: 'features', title: 'Features' },
  { id: 'fixes', title: 'Fixes' },
  { id: 'performance', title: 'Performance' },
  { id: 'other', title: 'Other changes' },
] as const;
type SectionId = (typeof sections)[number]['id'];
const sectionByType: Record<string, SectionId> = {
  feat: 'features',
  fix: 'fixes',
  perf: 'performance',
};

export type Entry = {
  commit: string;
  date: string;
  /** The commit subject as written. */
  subject: string;
  /** Lowercased Conventional Commit type; null when the subject is not conventional. */
  type: string | null;
  scope: string | null;
  /** The subject without its type, scope and PR suffix. */
  description: string;
  breaking: boolean;
  /** Text of the `BREAKING CHANGE:` footer, when there is one. */
  breakingNote: string | null;
  pr: number | null;
  /** The pull request when the commit names one, otherwise the commit. */
  url: string;
};

export type Release = {
  /** Null for unreleased changes on HEAD, as are `version` and `date`. */
  tag: string | null;
  version: string | null;
  channel: Channel;
  date: string | null;
  commit: string;
  /** The tag this release's changes are counted from; null for a first release. */
  previous: string | null;
  /** The preview whose commit a stable release promotes unchanged. */
  promotedFrom: string | null;
  /** Previews after `previous` that a stable release folds in, lowest first. */
  previews: string[];
  urls: { release: string | null; compare: string; changelog: string };
  protocol: {
    from: Protocol | null;
    to: Protocol | null;
    changed: boolean;
    summary: string | null;
  };
  breaking: boolean;
  /** Non-empty groups in reading order; each entry is in exactly one. */
  sections: { id: SectionId; title: string; entries: Entry[] }[];
};

export type Changelog = {
  schemaVersion: number;
  repository: string;
  /** Newest version first. */
  releases: Release[];
  /** Commits on HEAD after its highest reachable tag; null when there are none. */
  unreleased: Release | null;
};

const conventionalSubject =
  /^(?<type>[A-Za-z]+)(?:\((?<scope>[^()]+)\))?(?<bang>!)?: (?<description>\S.*)$/;
const prSuffix = /\s+\(#(\d+)\)$/;
// The footer runs to the next blank line or trailer.
const breakingFooter = /^BREAKING[ -]CHANGE:[ \t]*(.*(?:\n(?![\w-]+: )[^\n]+)*)/m;

export function parseCommit(
  input: { commit: string; date: string; subject: string; body: string },
  repository: string,
): Entry {
  const pr = prSuffix.exec(input.subject);
  const title = pr ? input.subject.slice(0, pr.index) : input.subject;
  const conventional = conventionalSubject.exec(title)?.groups;
  const footer = breakingFooter.exec(input.body);
  return {
    commit: input.commit,
    date: input.date,
    subject: input.subject,
    type: conventional?.type.toLowerCase() ?? null,
    scope: conventional?.scope ?? null,
    description: conventional?.description ?? title,
    breaking: Boolean(conventional?.bang || footer),
    breakingNote: footer?.[1].replace(/\s+/g, ' ').trim() || null,
    pr: pr ? Number(pr[1]) : null,
    url: pr
      ? `https://github.com/${repository}/pull/${pr[1]}`
      : `https://github.com/${repository}/commit/${input.commit}`,
  };
}

/**
 * The range a release covers, from the tags reachable from its commit. A preview counts
 * from the highest lower tag of either channel; a stable release counts from the highest
 * lower stable tag, so it includes the previews in between. `tag` is null for HEAD.
 */
export function releaseRange(
  target: { tag: string | null; channel: Channel; commit: string },
  reachable: { name: string; commit: string }[],
) {
  const { tag, channel } = target;
  const lower = releaseTags(reachable.map(({ name }) => name)).filter(
    (name) => tag === null || compareReleaseTags(name, tag) < 0,
  );
  const isPreview = (name: string) => parseReleaseTag(name).channel === 'preview';
  const previous =
    (channel === 'preview' ? lower : lower.filter((name) => !isPreview(name))).at(-1) ?? null;
  const previews =
    channel === 'stable'
      ? lower.filter(
          (name) =>
            isPreview(name) && (previous === null || compareReleaseTags(name, previous) > 0),
        )
      : [];
  const promoted = previews.find(
    (name) =>
      name === `${tag}-preview` &&
      reachable.some((other) => other.name === name && other.commit === target.commit),
  );
  return { previous, previews, promotedFrom: promoted ?? null };
}

/** Reads the protocol constants from `protocol.ts` source; null when the file is absent. */
export function parseProtocol(source: string | null): Protocol | null {
  if (source === null) return null;
  const version = /^export const API_PROTOCOL_VERSION = (\d+);/m.exec(source);
  const range =
    /^export const SUPPORTED_API_PROTOCOLS\b[^=]*=\s*\{\s*min:\s*(\w+),\s*max:\s*(\w+),?\s*\}/m.exec(
      source,
    );
  const value = (text: string) => (text === 'API_PROTOCOL_VERSION' ? version?.[1] : text);
  const parsed = z
    .object({
      version: z.coerce.number().int(),
      min: z.coerce.number().int(),
      max: z.coerce.number().int(),
    })
    .safeParse({
      version: version?.[1],
      min: range && value(range[1]),
      max: range && value(range[2]),
    });
  // Failing here, rather than leaving the line out, keeps a breaking release from
  // publishing notes that say nothing about the protocol.
  if (!parsed.success) throw new Error(`Could not read the API protocol from ${protocolPath}.`);
  return parsed.data;
}

const protocolRange = ({ min, max }: Protocol) => (min === max ? `${min}` : `${min}–${max}`);

/** `from` is the protocol at the range's first tag; undefined when there is no such tag. */
export function compareProtocols(from: Protocol | null | undefined, to: Protocol | null) {
  const none = { from: from ?? null, to, changed: false, summary: null };
  if (from === undefined || !to) return none;
  if (!from) {
    return {
      from,
      to,
      changed: true,
      summary:
        `API protocol ${to.version} is introduced; the server supports ${protocolRange(to)}. ` +
        'The previous release has no compatibility check: sync or export pending changes, ' +
        'then update the server and every app together.',
    };
  }
  if (from.version === to.version && from.min === to.min && from.max === to.max) return none;
  const needsNewServer = to.version > from.max;
  const rejectsOldApps = from.version < to.min;
  const order =
    needsNewServer && rejectsOldApps
      ? 'Update the server first, then every app: apps from the previous release cannot sync ' +
        'with this server, and this app cannot sync with the previous server.'
      : needsNewServer
        ? 'Update the server before the apps: this app cannot sync with the previous server, ' +
          'while apps from the previous release keep working with this one.'
        : rejectsOldApps
          ? 'Update the apps before the server: apps from the previous release cannot sync ' +
            'with this server, while this app still works with the previous one.'
          : 'Apps and servers from the previous release stay compatible with this one.';
  return {
    from,
    to,
    changed: true,
    summary:
      `API protocol: app ${from.version} → ${to.version}; server supports ` +
      `${protocolRange(from)} → ${protocolRange(to)}. ${order}` +
      (needsNewServer || rejectsOldApps
        ? ' Local notes and queued writes are kept while sync is paused.'
        : ''),
  };
}

export function buildRelease(input: {
  repository: string;
  target: { tag: string | null; channel: Channel; commit: string; date: string | null };
  reachable: { name: string; commit: string }[];
  /** Newest first, already limited to the range. */
  commits: (range: { previous: string | null }) => Parameters<typeof parseCommit>[0][];
  protocol: (ref: string) => Protocol | null;
  changelogBaseUrl?: string | null;
}): Release {
  const { repository, target } = input;
  const base = input.changelogBaseUrl === undefined ? CHANGELOG_BASE_URL : input.changelogBaseUrl;
  const range = releaseRange(target, input.reachable);
  const entries = input.commits(range).map((commit) => parseCommit(commit, repository));
  const github = `https://github.com/${repository}`;
  const version = target.tag?.slice(1) ?? null;
  const head = target.tag ?? target.commit;
  const compare = range.previous
    ? `${github}/compare/${range.previous}...${head}`
    : `${github}/commits/${head}`;
  const sectionOf = (entry: Entry): SectionId =>
    entry.breaking ? 'breaking' : (sectionByType[entry.type ?? ''] ?? 'other');
  return {
    tag: target.tag,
    version,
    channel: target.channel,
    date: target.date,
    commit: target.commit,
    ...range,
    urls: {
      release: target.tag && `${github}/releases/tag/${target.tag}`,
      compare,
      changelog: base ? (version ? `${base}/${version}` : base) : compare,
    },
    protocol: compareProtocols(
      range.previous === null ? undefined : input.protocol(range.previous),
      input.protocol(target.commit),
    ),
    breaking: entries.some((entry) => entry.breaking),
    sections: sections
      .map((section) => ({
        ...section,
        entries: entries.filter((entry) => sectionOf(entry) === section.id),
      }))
      .filter((section) => section.entries.length > 0),
  };
}

// Commit text is not ours to trust with markup: outside code spans, `<` would start HTML.
const inline = (text: string) =>
  text.replace(/(`+)[^`]*\1|</g, (match) => (match === '<' ? '&lt;' : match));

function renderEntry(entry: Entry, section: SectionId) {
  const link = entry.pr
    ? `[#${entry.pr}](${entry.url})`
    : `[${entry.commit.slice(0, 7)}](${entry.url})`;
  // Secondary entries keep their type, which is what tells a reader why they are secondary.
  const prefix = section === 'other' ? entry.type : null;
  const scope = prefix
    ? `${prefix}${entry.scope ? `(${entry.scope})` : ''}: `
    : entry.scope
      ? `**${inline(entry.scope)}:** `
      : '';
  const note =
    section === 'breaking' && entry.breakingNote ? `\n  - ${inline(entry.breakingNote)}` : '';
  return `- ${scope}${inline(entry.description)} (${link})${note}`;
}

/** The body of one release's notes, without a title. */
export function renderRelease(release: Release) {
  const github = release.urls.compare.split(/\/(?:compare|commits)\//)[0];
  const versionLink = (tag: string) => `[${tag.slice(1)}](${github}/releases/tag/${tag})`;
  const lines: string[] = [];
  const intro = [
    release.previous
      ? `${release.tag ? 'Changes' : 'Unreleased changes'} since ${versionLink(release.previous)}.`
      : release.tag
        ? 'First release.'
        : 'Unreleased changes.',
  ];
  if (release.promotedFrom) {
    intro.push(`Promotes ${versionLink(release.promotedFrom)} to stable unchanged.`);
  }
  const folded = release.previews.filter((tag) => tag !== release.promotedFrom);
  if (folded.length > 0) {
    intro.push(`Includes the changes from ${folded.map(versionLink).join(', ')}.`);
  }
  lines.push(intro.join(' '), '');
  if (release.protocol.summary) lines.push(`> **Compatibility:** ${release.protocol.summary}`, '');
  if (release.sections.length === 0) lines.push('No changes.', '');
  for (const section of release.sections) {
    const entries = section.entries.map((entry) => renderEntry(entry, section.id));
    if (section.id === 'other') {
      lines.push(
        `<details><summary>${section.title} (${entries.length})</summary>`,
        '',
        ...entries,
        '',
        '</details>',
        '',
      );
    } else {
      lines.push(`### ${section.title}`, '', ...entries, '');
    }
  }
  lines.push(`**Full changelog:** ${release.urls.changelog}`);
  return `${lines.join('\n')}\n`;
}

export function renderChangelog(changelog: Changelog) {
  const releases = changelog.unreleased
    ? [changelog.unreleased, ...changelog.releases]
    : changelog.releases;
  const parts = releases.map((release) => {
    const title = release.tag
      ? `[${release.version}](${release.urls.release}) (${release.date?.slice(0, 10)})`
      : 'Unreleased';
    return `## ${title}\n\n${renderRelease(release)}`;
  });
  return `# Changelog\n\n${parts.join('\n')}`;
}

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
}

/** Reads releases from the repository at `cwd`. Never fetches or writes. */
export function repositoryChangelog(cwd: string, repository: string) {
  // A shallow clone would report a release's whole visible history as its changes.
  if (git(cwd, ['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error(
      'The changelog needs full history; fetch it with git fetch --unshallow --tags.',
    );
  }
  const tags: Tag[] = git(cwd, [
    'for-each-ref',
    'refs/tags',
    '--format=%(refname:short)%00%(objectname)%00%(*objectname)%00%(creatordate:iso-strict)',
  ])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\0'))
    .map(([name, object, peeled, date]) => ({ name, commit: peeled || object, date }));
  const protocols = new Map<string, Protocol | null>();
  const protocol = (ref: string) => {
    if (!protocols.has(ref)) {
      const file = spawnSync('git', ['show', `${ref}:${protocolPath}`], { cwd, encoding: 'utf8' });
      if (file.error) throw file.error;
      protocols.set(ref, parseProtocol(file.status === 0 ? file.stdout : null));
    }
    return protocols.get(ref) ?? null;
  };
  const build = (target: Parameters<typeof buildRelease>[0]['target']) => {
    const merged = new Set(git(cwd, ['tag', '--merged', target.commit]).split('\n'));
    return buildRelease({
      repository,
      target,
      reachable: tags.filter(({ name }) => merged.has(name)),
      // Merge commits repeat the commits they bring in, which carry the real subjects.
      commits: ({ previous }) =>
        git(cwd, [
          'log',
          '--no-merges',
          '--format=%H%x00%cI%x00%s%x00%b%x1e',
          previous ? `${previous}..${target.commit}` : target.commit,
        ])
          .split('\x1e')
          .map((record) => record.replace(/^\n/, '').split('\0'))
          .filter((fields) => fields.length === 4)
          .map(([commit, date, subject, body]) => ({ commit, date, subject, body })),
      protocol,
    });
  };
  return {
    release(tag: string) {
      const { channel } = parseReleaseTag(tag);
      const found = tags.find(({ name }) => name === tag);
      if (!found) throw new Error(`Tag ${tag} does not exist locally; fetch tags first.`);
      return build({ tag, channel: channel as Channel, commit: found.commit, date: found.date });
    },
    unreleased(channel: Channel) {
      const commit = git(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
      return build({ tag: null, channel, commit, date: null });
    },
    all(): Changelog {
      const unreleased = this.unreleased('preview');
      return {
        schemaVersion: CHANGELOG_SCHEMA_VERSION,
        repository,
        releases: releaseTags(tags.map(({ name }) => name))
          .reverse()
          .map((tag) => this.release(tag)),
        unreleased: unreleased.sections.length > 0 ? unreleased : null,
      };
    },
  };
}

const repositoryName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

function defaultRepository(cwd: string) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\s*$/.exec(remote.stdout ?? '');
  if (!match) throw new Error('Could not tell the GitHub repository; pass --repo owner/name.');
  return match[1];
}

function main() {
  const { positionals, values } = parseArgs({
    options: {
      all: { type: 'boolean' },
      json: { type: 'boolean' },
      channel: { type: 'string' },
      repo: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const [tag] = positionals;
  if (positionals.length > 1 || ((tag || values.all) && values.channel) || (tag && values.all)) {
    throw new Error(usage);
  }
  const channel = z.enum(['stable', 'preview']).default('preview').parse(values.channel);
  const cwd = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const repository = repositoryName.parse(values.repo ?? defaultRepository(cwd));
  const changelog = repositoryChangelog(cwd, repository);
  if (values.all) {
    const all = changelog.all();
    process.stdout.write(values.json ? `${JSON.stringify(all, null, 2)}\n` : renderChangelog(all));
  } else {
    const release = tag ? changelog.release(tag) : changelog.unreleased(channel);
    process.stdout.write(
      values.json ? `${JSON.stringify(release, null, 2)}\n` : renderRelease(release),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
