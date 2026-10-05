import { z } from 'zod';

/** How a server backup came to be. `upload` is one an admin brought from elsewhere. */
export const backupKindSchema = z.enum(['manual', 'scheduled', 'update', 'pre-restore', 'upload']);
export type BackupKind = z.infer<typeof backupKindSchema>;

const NAME =
  /^catch-backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-([a-z-]+?)(?:-(\d+))?\.zip$/;

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * A backup's file name: its time in UTC and its kind, so backups sort by age and can be
 * pruned by kind without opening them. `copy` tells apart two made in the same second.
 */
export function backupFileName(kind: BackupKind, createdAt: Date, copy = 0) {
  const date = `${createdAt.getUTCFullYear()}-${pad(createdAt.getUTCMonth() + 1)}-${pad(createdAt.getUTCDate())}`;
  const time = `${pad(createdAt.getUTCHours())}-${pad(createdAt.getUTCMinutes())}-${pad(createdAt.getUTCSeconds())}`;
  return `catch-backup-${date}_${time}-${kind}${copy > 0 ? `-${copy}` : ''}.zip`;
}

export function parseBackupFileName(name: string): { kind: BackupKind; createdAt: Date } | null {
  const match = NAME.exec(name);
  if (!match) return null;
  const kind = backupKindSchema.safeParse(match[7]);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const createdAt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return kind.success && !Number.isNaN(createdAt.getTime()) ? { kind: kind.data, createdAt } : null;
}

export const backupItemSchema = z.object({
  name: z.string(),
  kind: backupKindSchema,
  createdAt: z.iso.datetime(),
  size: z.number().int().nonnegative(),
  /** The release that made it, when it came from a released image. */
  appVersion: z.string().nullable(),
  users: z.number().int().nonnegative(),
  notes: z.number().int().nonnegative(),
  includesAttachments: z.boolean(),
  attachments: z.number().int().nonnegative(),
  /** False when it was made under another BETTER_AUTH_SECRET: restoring signs everyone out. */
  secretMatches: z.boolean(),
  /** Why this server cannot restore it, or null when it can. */
  problem: z.string().nullable(),
});
export type BackupItem = z.infer<typeof backupItemSchema>;

export function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const backupScheduleSchema = z.object({
  enabled: z.boolean(),
  /** Local time of day in `timeZone`, as HH:MM. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().refine(isTimeZone, 'Unknown time zone'),
  /** How many scheduled backups to keep. Other kinds are not counted or removed. */
  keep: z.number().int().min(1).max(365),
  includeAttachments: z.boolean(),
});
export type BackupSchedule = z.infer<typeof backupScheduleSchema>;

export const DEFAULT_BACKUP_SCHEDULE: BackupSchedule = {
  enabled: false,
  time: '03:00',
  timeZone: 'UTC',
  keep: 7,
  includeAttachments: true,
};

/** The calendar date and time of day at `now` in a time zone, as `YYYY-MM-DD` and `HH:MM`. */
export function localDateTime(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * The local date a scheduled backup is due for at `now`, or null when today's has run or its
 * time has not come. Comparing dates rather than instants also catches up after downtime:
 * a server that was off at the scheduled time runs the backup when it starts.
 */
export function backupDueDate(
  schedule: BackupSchedule,
  lastRunDate: string | null,
  now: Date,
): string | null {
  if (!schedule.enabled) return null;
  const local = localDateTime(now, schedule.timeZone);
  return local.time >= schedule.time && local.date !== lastRunDate ? local.date : null;
}

export const backupOverviewSchema = z.object({
  backups: z.array(backupItemSchema),
  destination: z.object({
    freeBytes: z.number().nonnegative().nullable(),
    /** On the same disk as the data they protect, so one failure takes both. */
    sameDiskAsData: z.boolean(),
    /** False inside a container with no volume mounted for backups: they die with it. */
    persistent: z.boolean(),
  }),
  schedule: backupScheduleSchema,
  running: z
    .object({ kind: z.enum(['backup', 'restore']), startedAt: z.iso.datetime() })
    .nullable(),
  /** The last backup this server process made or failed to make. */
  lastBackup: z
    .object({
      finishedAt: z.iso.datetime(),
      name: z.string().nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
  lastRestore: z
    .object({
      finishedAt: z.iso.datetime(),
      name: z.string(),
      error: z.string().nullable(),
      /** Attachments the restored notes list whose files are not on this server. */
      missingAttachments: z.number().int().nonnegative(),
      /** The backup of the database as it was just before, to undo the restore with. */
      safetyBackup: z.string().nullable(),
    })
    .nullable(),
});
export type BackupOverview = z.infer<typeof backupOverviewSchema>;

export const createBackupSchema = z.object({ includeAttachments: z.boolean() });
export type CreateBackup = z.infer<typeof createBackupSchema>;

/** A short-lived ticket that lets a plain link download a backup without a bearer token. */
export const backupAccessSchema = z.object({ access: z.string() });
export type BackupAccess = z.infer<typeof backupAccessSchema>;
