import type { BackupOverview, BackupSchedule } from '@catch/shared';
import { backupDueDate, localDateTime } from '@catch/shared';
import { eq } from 'drizzle-orm';
import type { AuthSession } from '../auth';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { resumePendingPreviews } from '../linkPreviews';
import { backupConfig } from './config';
import { BackupError } from './errors';
import { createBackup, restoreBackup } from './operations';
import {
  backupPath,
  clearStaleWork,
  describeBackup,
  destinationStatus,
  listBackups,
  pruneBackups,
  readSchedule,
  writeSchedule,
} from './store';

/**
 * The running server's backups: one backup or restore at a time, what the last ones came
 * to, and the daily schedule. The work itself is in `operations.ts`, which the CLI shares.
 */
let running: BackupOverview['running'] = null;
let lastBackup: BackupOverview['lastBackup'] = null;
let lastRestore: BackupOverview['lastRestore'] = null;

/** While true the API turns requests away (see `app.ts`): a restore replaces every table. */
export const isRestoring = () => running?.kind === 'restore';
export const isBusy = () => running !== null;

export const BUSY = 'A backup or restore is already running.';

function begin(kind: 'backup' | 'restore') {
  if (running) throw new BackupError(BUSY);
  running = { kind, startedAt: new Date().toISOString() };
}

const reason = (error: unknown) =>
  error instanceof BackupError ? error.message : 'It failed unexpectedly. See the server log.';

/** Claims the server before its first await, so a caller can tell at once that it started. */
export async function runBackup(
  kind: 'manual' | 'scheduled',
  includeAttachments: boolean,
  keep?: number,
) {
  begin('backup');
  try {
    const name = await createBackup(backupConfig, { kind, includeAttachments });
    if (keep) await pruneBackups(backupConfig.backupsDir, kind, keep);
    lastBackup = { finishedAt: new Date().toISOString(), name, error: null };
    return name;
  } catch (error) {
    if (!(error instanceof BackupError)) console.error('Backup failed', error);
    lastBackup = { finishedAt: new Date().toISOString(), name: null, error: reason(error) };
    throw error;
  } finally {
    running = null;
  }
}

/**
 * Restores a backup in the background and records how it went. The session that asked is
 * put back afterwards when its user is in the restored data, so the admin is not signed out
 * by a backup older than their sign-in.
 */
export async function runRestore(name: string, session: AuthSession['session'] | null) {
  begin('restore');
  try {
    const outcome = await restoreBackup(backupConfig, backupPath(backupConfig.backupsDir, name));
    if (session) await keepSession(session);
    lastRestore = {
      finishedAt: new Date().toISOString(),
      name,
      error: null,
      missingAttachments: outcome.missingAttachments,
      safetyBackup: outcome.safetyBackup,
    };
  } catch (error) {
    if (!(error instanceof BackupError)) console.error('Restore failed', error);
    lastRestore = {
      finishedAt: new Date().toISOString(),
      name,
      error: reason(error),
      missingAttachments: 0,
      safetyBackup: null,
    };
  } finally {
    running = null;
  }
  // The restored notes may hold links whose previews were still waiting when it was made.
  resumePendingPreviews().catch((error: unknown) => {
    console.error('Could not resume link previews', error);
  });
}

async function keepSession(session: AuthSession['session']) {
  const [owner] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, session.userId));
  if (owner) await db.insert(schema.session).values(session).onConflictDoNothing();
}

export async function backupOverview(): Promise<BackupOverview> {
  return {
    backups: await listBackups(backupConfig),
    destination: await destinationStatus(backupConfig),
    schedule: (await readSchedule(backupConfig.backupsDir)).schedule,
    running,
    lastBackup,
    lastRestore,
  };
}

/** A backup that exists and that this server can restore. */
export async function restorableBackup(name: string) {
  const item = await describeBackup(backupConfig, name);
  if (item.problem) throw new BackupError(item.problem);
  return item;
}

export async function saveSchedule(schedule: BackupSchedule, now = new Date()) {
  const previous = await readSchedule(backupConfig.backupsDir);
  const local = localDateTime(now, schedule.timeZone);
  // Turning the schedule on, or moving its time, after today's time has passed starts it
  // tomorrow rather than at once.
  const lastRunDate = local.time >= schedule.time ? local.date : previous.lastRunDate;
  await writeSchedule(backupConfig.backupsDir, { schedule, lastRunDate });
}

async function runDueBackup() {
  const state = await readSchedule(backupConfig.backupsDir);
  const due = backupDueDate(state.schedule, state.lastRunDate, new Date());
  if (!due || isBusy()) return;
  // Recorded first, so a backup that fails is reported once rather than retried each minute.
  await writeSchedule(backupConfig.backupsDir, { ...state, lastRunDate: due });
  const name = await runBackup('scheduled', state.schedule.includeAttachments, state.schedule.keep);
  console.log(`Scheduled backup saved as ${name}`);
}

/** Checks the schedule each minute. A missed day is caught up when the server next runs. */
export function startBackupSchedule() {
  const tick = () =>
    runDueBackup().catch((error: unknown) => console.error('Scheduled backup failed', error));
  clearStaleWork(backupConfig.backupsDir).catch(() => {});
  setInterval(tick, 60_000).unref();
  void tick();
}
