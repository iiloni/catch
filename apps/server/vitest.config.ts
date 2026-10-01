import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://catch:catch@localhost:5432/catch_test',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      BETTER_AUTH_URL: 'http://localhost:3000',
      ELECTRIC_URL: 'http://localhost:3001',
      // The Postgres server the tests run beside, where there is one (the dev container).
      // The backup tests make and drop their own databases on it; without it they skip.
      BACKUP_TEST_DATABASE_URL: process.env.DATABASE_URL ?? '',
    },
  },
});
