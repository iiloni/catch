import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  platform: 'node',
  format: 'esm',
  // Workspace packages ship TypeScript source, so they must be bundled.
  noExternal: [/^@catch\//],
});
