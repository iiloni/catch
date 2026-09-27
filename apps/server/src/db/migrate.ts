import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client';

const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../../drizzle', import.meta.url));

await migrate(db, { migrationsFolder });
await sql.end();
console.log('Migrations applied');
