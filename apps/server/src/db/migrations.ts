import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The nearest `drizzle` directory above this file, wherever the build put it. */
function findMigrations() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, 'drizzle');
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Migrations not found. Set MIGRATIONS_DIR.');
    dir = parent;
  }
}

export const migrationsFolder = process.env.MIGRATIONS_DIR ?? findMigrations();
