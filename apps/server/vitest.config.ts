import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://catch:catch@localhost:5432/catch_test',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      BETTER_AUTH_URL: 'http://localhost:3000',
      ELECTRIC_URL: 'http://localhost:3001',
    },
  },
});
