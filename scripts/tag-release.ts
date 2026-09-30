import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { compareReleaseTags, nextReleaseTag, promotePreviewTag } from './release.ts';

const usage = `Usage:
  ./scripts/release.sh <stable|preview> <major|minor|patch> [--dry-run]
  ./scripts/release.sh stable promote [vMAJOR.MINOR.PATCH-preview] [--dry-run]

Bumps use the highest stable or preview tag reachable from HEAD (initially v0.0.0).
Promotion uses the preview tag's existing version and commit; omit the tag to use
the highest preview tag on HEAD. Creates an annotated local tag and never pushes.
Use --dry-run to inspect the result, including from an uncommitted checkout.`;

function git(args: string[], cwd = process.cwd()) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tagExists(tag: string, cwd: string) {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], {
    cwd,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(result.stderr.trim() || 'Could not inspect Git tags.');
}

function main() {
  const { positionals, values } = parseArgs({
    options: { 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (positionals.length < 2 || positionals.length > 3) throw new Error(usage);
  const [channelInput, operationInput, previewInput] = positionals;
  const channel = z.enum(['stable', 'preview']).parse(channelInput);
  const operation = z.enum(['major', 'minor', 'patch', 'promote']).parse(operationInput);
  if (operation === 'promote' && channel !== 'stable') {
    throw new Error('Use stable promote to promote a preview release.');
  }
  if (operation !== 'promote' && previewInput) throw new Error(usage);

  const cwd = git(['rev-parse', '--show-toplevel']);
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}'], cwd);
  let commit = head;
  let tag: string;
  let base: string;
  if (operation === 'promote') {
    const previews = git(['tag', '--points-at', head], cwd)
      .split('\n')
      .filter((candidate) => {
        try {
          promotePreviewTag(candidate);
          return true;
        } catch {
          return false;
        }
      });
    const preview = previewInput ?? previews.sort(compareReleaseTags).at(-1);
    if (!preview) {
      throw new Error('HEAD has no preview tag. Pass an existing preview tag to stable promote.');
    }
    tag = promotePreviewTag(preview);
    if (!tagExists(preview, cwd)) throw new Error(`Preview tag ${preview} does not exist locally.`);
    commit = git(['rev-parse', '--verify', `refs/tags/${preview}^{commit}`], cwd);
    base = preview;
  } else {
    if (!values['dry-run'] && git(['status', '--porcelain'], cwd)) {
      throw new Error(
        'Commit or stash changes before tagging HEAD. Use --dry-run to inspect the version.',
      );
    }
    const tags = git(['tag', '--merged', head], cwd).split('\n').filter(Boolean);
    ({ tag, base } = nextReleaseTag(tags, channel, operation));
  }
  if (tagExists(tag, cwd))
    throw new Error(`Tag ${tag} already exists; it will not be overwritten.`);
  if (values['dry-run']) {
    console.log(`Would create ${tag} at ${commit} (base ${base}). No tag was created.`);
  } else {
    git(['tag', '--annotate', '--message', `Catch ${tag.slice(1)}`, tag, commit], cwd);
    console.log(`Created ${tag} at ${commit} (base ${base}).`);
  }
  console.log(`Push explicitly when ready:\n  git push origin ${tag}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
