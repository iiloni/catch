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
  /**
   * Fetch pages for link previews. Off keeps the server from contacting the sites users
   * link to; notes then show plain link cards.
   */
  LINK_PREVIEWS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Directory containing the built web app. Served when set. */
  WEB_DIST_DIR: z.string().optional(),
  ATTACHMENTS_DIR: z.string().default('/data/attachments'),
  /** Where server backups are written. Mount a volume here, ideally on another disk. */
  BACKUPS_DIR: z.string().default('/data/backups'),
  /** The release this image was built from, recorded in backups. Unset in development. */
  CATCH_VERSION: z.string().optional(),
  /** Back up the database at startup before a new version migrates it. */
  UPDATE_BACKUPS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** How many of those backups to keep. */
  UPDATE_BACKUPS_KEPT: z.coerce.number().int().min(1).default(10),
});

export const env = envSchema.parse(process.env);

/** Origins used by the Capacitor Android WebView. */
export const NATIVE_APP_ORIGINS = ['https://localhost', 'capacitor://localhost'];
