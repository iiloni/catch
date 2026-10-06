import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Files the app, its image and its tests never load. Markdown elsewhere is left out on
// purpose: an importer fixture or a bundled file ending in .md is code to the E2E suite.
const documentation = [
  /^docs\//,
  /^[^/]+\.md$/,
  /^branding\/.+\.md$/,
  /^\.github\/pull_request_template\.md$/,
  /^LICENSE$/,
  /^\.gitignore$/,
  /^cubic\.yaml$/,
];

/** A change needs E2E unless every path it touches is documentation. No paths prove nothing. */
export function docsOnly(paths: string[]) {
  return paths.length > 0 && paths.every((path) => documentation.some((rule) => rule.test(path)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = readFileSync(0, 'utf8')
    .split('\n')
    .filter((path) => path !== '');
  console.log(docsOnly(paths));
}
