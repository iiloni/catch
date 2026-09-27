import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  ELECTRIC_URL: z.url(),
  ELECTRIC_SECRET: z.string().optional(),
  /** Extra origins allowed to call the API, e.g. the Vite dev server. Comma separated. */
  TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /** Better Auth rate limiting (on in production). Disable only for automated tests. */
  AUTH_RATE_LIMIT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Directory containing the built web app. Served when set. */
  WEB_DIST_DIR: z.string().optional(),
});

export const env = envSchema.parse(process.env);

/** Origins used by the Capacitor Android WebView. */
export const NATIVE_APP_ORIGINS = ['https://localhost', 'capacitor://localhost'];
