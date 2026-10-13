import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Files outside the app build, production image and Playwright inputs. Markdown elsewhere
// is left out: an importer fixture or a bundled file ending in .md is E2E input.
const exemptPaths = [
  /^docs\//,
  /^[^/]+\.md$/,
  /^branding\/.+\.md$/,
  /^\.github\/pull_request_template\.md$/,
  /^LICENSE$/,
  /^\.gitignore$/,
  /^cubic\.yaml$/,
  // These workflows orchestrate publication or review; CI itself defines the E2E jobs.
  /^\.github\/workflows\/(release|site|tag-release|promote-release|ai-review)\.yml$/,
  /^scripts\/release-workflows\.test\.ts$/,
];

/** Skip E2E only when every changed path is exempt. No paths prove nothing. */
export function e2eExempt(paths: string[]) {
  return paths.length > 0 && paths.every((path) => exemptPaths.some((rule) => rule.test(path)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = readFileSync(0, 'utf8')
    .split('\n')
    .filter((path) => path !== '');
  console.log(e2eExempt(paths));
}
