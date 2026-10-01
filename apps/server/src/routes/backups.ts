import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { backupScheduleSchema, createBackupSchema } from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { issueBackupAccess, readBackupAccess } from '../backups/access';
import { backupConfig } from '../backups/config';
import { BackupError } from '../backups/errors';
import {
  BUSY,
  backupOverview,
  isBusy,
  restorableBackup,
  runBackup,
  runRestore,
  saveSchedule,
} from '../backups/service';
import { backupPath, deleteBackup, describeBackup, importBackup, workDir } from '../backups/store';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { user } from '../db/schema';

async function isAdmin(userId: string) {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId));
  return row?.role === 'admin';
}

function onError(error: Error, c: Context<AppEnv>) {
  if (error instanceof BackupError) return c.json({ error: error.message }, 400);
  console.error(error);
  return c.json({ error: 'Internal Server Error' }, 500);
}

/**
 * Downloads, which a browser fetches from a plain link that cannot carry the bearer token.
 * The link holds a short-lived ticket from behind the admin guard instead, so this one route
 * is mounted ahead of that guard and checks the ticket's user against the database itself.
 */
export const backupDownloadRoutes = new Hono<AppEnv>()
  .onError(onError)
  .get('/:name/download', async (c) => {
    const name = c.req.param('name');
    const userId = c.get('user')?.id ?? readBackupAccess(c.req.query('access') ?? '', name);
    if (!userId || !(await isAdmin(userId))) return c.json({ error: 'Unauthorized' }, 401);
    const path = backupPath(backupConfig.backupsDir, name);
    const file = await stat(path).catch(() => null);
    if (!file?.isFile()) return c.json({ error: 'Not found' }, 404);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(file.size),
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  });

/**
 * Server backups, mounted in the admin routes behind their guard (ADR 0011). Unlike every
 * other route these act on all users' data at once, so nothing here filters by the caller.
 */
export const backupRoutes = new Hono<AppEnv>()
  .onError(onError)
  .get('/', async (c) => c.json(await backupOverview()))
  .post('/', zValidator('json', createBackupSchema), (c) => {
    if (isBusy()) return c.json({ error: BUSY }, 409);
    // Large attachments take longer than a request should stay open: the overview says when
    // the backup is done, and how it went.
    runBackup('manual', c.req.valid('json').includeAttachments).catch(() => {});
    return c.json({ started: true }, 202);
  })
  .put('/schedule', zValidator('json', backupScheduleSchema), async (c) => {
    await saveSchedule(c.req.valid('json'));
    return c.json({ ok: true });
  })
  .post('/upload', async (c) => {
    if (!c.req.raw.body) return c.json({ error: 'Missing file' }, 400);
    const length = Number(c.req.header('content-length') ?? 0);
    const work = await workDir(backupConfig.backupsDir);
    try {
      const space = await statfs(backupConfig.backupsDir);
      if (length > space.bavail * space.bsize) {
        return c.json({ error: 'There is not enough free space for this backup.' }, 507);
      }
      const file = join(work, 'upload.zip');
      await pipeline(
        Readable.fromWeb(c.req.raw.body as NodeReadableStream<Uint8Array>),
        createWriteStream(file, { mode: 0o600 }),
      );
      const name = await importBackup(backupConfig, file);
      return c.json(await describeBackup(backupConfig, name), 201);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  })
  .get('/:name/access', async (c) => {
    const name = c.req.param('name');
    await describeBackup(backupConfig, name);
    return c.json({ access: issueBackupAccess(c.get('user')!.id, name) });
  })
  .delete('/:name', async (c) => {
    if (isBusy()) return c.json({ error: BUSY }, 409);
    await deleteBackup(backupConfig.backupsDir, c.req.param('name'));
    return c.json({ ok: true });
  })
  .post('/:name/restore', async (c) => {
    const name = c.req.param('name');
    await restorableBackup(name);
    if (isBusy()) return c.json({ error: BUSY }, 409);
    void runRestore(name, c.get('session'));
    return c.json({ started: true }, 202);
  });
