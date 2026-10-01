import { describe, expect, it } from 'vitest';
import {
  backupDueDate,
  backupFileName,
  backupScheduleSchema,
  DEFAULT_BACKUP_SCHEDULE,
  parseBackupFileName,
} from './backups';

describe('backup file names', () => {
  const createdAt = new Date('2026-10-01T03:04:05.678Z');

  it('carry the time in UTC and the kind, and read back', () => {
    const name = backupFileName('scheduled', createdAt);
    expect(name).toBe('catch-backup-2026-10-01_03-04-05-scheduled.zip');
    expect(parseBackupFileName(name)).toEqual({
      kind: 'scheduled',
      createdAt: new Date('2026-10-01T03:04:05Z'),
    });
  });

  it('tell apart a kind with a hyphen from a copy number', () => {
    expect(parseBackupFileName(backupFileName('pre-restore', createdAt))?.kind).toBe('pre-restore');
    const copy = backupFileName('pre-restore', createdAt, 2);
    expect(copy).toBe('catch-backup-2026-10-01_03-04-05-pre-restore-2.zip');
    expect(parseBackupFileName(copy)?.kind).toBe('pre-restore');
  });

  it('sort by age', () => {
    const names = [
      backupFileName('manual', new Date('2026-10-02T00:00:00Z')),
      backupFileName('update', new Date('2026-09-30T23:59:59Z')),
      backupFileName('scheduled', createdAt),
    ];
    expect([...names].sort()).toEqual([names[1], names[2], names[0]]);
  });

  it('reject other files', () => {
    for (const name of [
      'notes.zip',
      'catch-backup-2026-10-01_03-04-05-weekly.zip',
      'catch-backup-2026-13-41_03-04-05-manual.zip.part',
      '../catch-backup-2026-10-01_03-04-05-manual.zip',
    ]) {
      expect(parseBackupFileName(name)).toBeNull();
    }
  });
});

describe('backupDueDate', () => {
  const schedule = { ...DEFAULT_BACKUP_SCHEDULE, enabled: true, time: '03:00' };

  it('is due once its time has come, once a day', () => {
    expect(backupDueDate(schedule, null, new Date('2026-10-01T02:59:00Z'))).toBeNull();
    expect(backupDueDate(schedule, null, new Date('2026-10-01T03:00:00Z'))).toBe('2026-10-01');
    expect(backupDueDate(schedule, '2026-10-01', new Date('2026-10-01T03:01:00Z'))).toBeNull();
    expect(backupDueDate(schedule, '2026-10-01', new Date('2026-10-02T03:00:00Z'))).toBe(
      '2026-10-02',
    );
  });

  it('catches up when the server was off at the scheduled time', () => {
    expect(backupDueDate(schedule, '2026-09-30', new Date('2026-10-01T17:30:00Z'))).toBe(
      '2026-10-01',
    );
  });

  it('follows the schedule’s time zone', () => {
    const jerusalem = { ...schedule, timeZone: 'Asia/Jerusalem' };
    // 03:00 in Jerusalem (UTC+3 in summer) is midnight UTC.
    expect(backupDueDate(jerusalem, null, new Date('2026-07-01T00:00:00Z'))).toBe('2026-07-01');
    expect(backupDueDate(jerusalem, null, new Date('2026-06-30T23:59:00Z'))).toBeNull();
    // Late evening UTC is already the next day there, before that day's backup time.
    expect(backupDueDate(jerusalem, '2026-07-01', new Date('2026-07-01T22:30:00Z'))).toBeNull();
  });

  it('is never due while off', () => {
    expect(
      backupDueDate({ ...schedule, enabled: false }, null, new Date('2026-10-01T12:00:00Z')),
    ).toBeNull();
  });
});

describe('backupScheduleSchema', () => {
  it('rejects times and zones that do not exist', () => {
    expect(backupScheduleSchema.safeParse(DEFAULT_BACKUP_SCHEDULE).success).toBe(true);
    for (const change of [{ time: '24:00' }, { time: '3:00' }, { timeZone: 'Mars/Olympus' }]) {
      expect(
        backupScheduleSchema.safeParse({ ...DEFAULT_BACKUP_SCHEDULE, ...change }).success,
      ).toBe(false);
    }
  });
});
