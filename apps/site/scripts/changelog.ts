/**
 * Writes the changelog the site renders, from the release tooling's JSON (ADR 0017). That
 * needs Git history with tags, which a shallow CI clone and the development container lack,
 * so without it the page says where the releases are instead. A deploy sets
 * SITE_CHANGELOG=required, making a missing changelog a failure rather than an empty page.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { changelogSchema } from '../src/lib/changelog.ts';

const root = path.join(import.meta.dirname, '../../..');
const output = path.join(import.meta.dirname, '../src/generated/changelog.json');

function generate() {
  const json = execFileSync(
    process.execPath,
    [path.join(root, 'scripts/changelog.ts'), '--all', '--json'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  );
  return changelogSchema.parse(JSON.parse(json));
}

let changelog: ReturnType<typeof generate> | null = null;
try {
  changelog = generate();
  console.log(`Changelog: ${changelog.releases.length} releases.`);
} catch (error) {
  if (process.env.SITE_CHANGELOG === 'required') throw error;
  const reason = error instanceof Error ? error.message.trim().split('\n').at(-1) : String(error);
  console.warn(`Changelog: not generated, the page will show its placeholder (${reason}).`);
}
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(changelog)}\n`);
