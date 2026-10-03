import { type BackupItem, type BackupOverview, DEFAULT_BACKUP_SCHEDULE } from '@catch/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type ServerBackupsState, serverBackups, useServerBackups } from '@/lib/serverBackups';
import { ServerBackups } from './ServerBackups';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/serverBackups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/serverBackups')>()),
  useServerBackups: vi.fn(),
  serverBackups: {
    create: vi.fn(async () => ({})),
    saveSchedule: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
    restore: vi.fn(async () => ({})),
    download: vi.fn(async () => {}),
    upload: vi.fn(),
  },
}));

afterEach(() => vi.clearAllMocks());

const backup: BackupItem = {
  name: 'catch-backup-2026-10-01_03-00-00-scheduled.zip',
  kind: 'scheduled',
  createdAt: '2026-10-01T03:00:00.000Z',
  size: 5 * 1024 * 1024,
  appVersion: '1.4.0',
  users: 2,
  notes: 1200,
  includesAttachments: true,
  attachments: 31,
  secretMatches: true,
  problem: null,
};

const overview: BackupOverview = {
  backups: [backup],
  destination: { freeBytes: 20 * 1024 ** 3, sameDiskAsData: false, persistent: true },
  schedule: DEFAULT_BACKUP_SCHEDULE,
  running: null,
  lastBackup: null,
  lastRestore: null,
};

const refresh = vi.fn(async () => {});
const expectRestore = vi.fn();

const onAccessDenied = vi.fn();

const page = () => (
  <TooltipProvider>
    <ServerBackups onAccessDenied={onAccessDenied} />
  </TooltipProvider>
);

function showing(state: ServerBackupsState) {
  vi.mocked(useServerBackups).mockReturnValue({ state, refresh, expectRestore });
  return render(page());
}

const ready = (change: Partial<BackupOverview> = {}) =>
  showing({ status: 'ready', overview: { ...overview, ...change } });

async function openMenu() {
  const trigger = screen.getByRole('button', { name: /^Manage the backup from/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await screen.findByRole('menu');
}

describe('ServerBackups', () => {
  it('says so while loading, and offers to retry when the server cannot be reached', () => {
    const { unmount } = showing({ status: 'loading' });
    expect(useServerBackups).toHaveBeenCalledWith(onAccessDenied);
    expect(screen.getByRole('status')).toHaveTextContent('Loading backups…');
    unmount();

    showing({ status: 'unavailable' });
    expect(screen.getByText('Could not load backups')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('lists what each backup holds and how much room is left', () => {
    ready();
    expect(screen.getByText('Scheduled · 5.0 MB · 1,200 notes · 31 attachments')).toBeVisible();
    expect(screen.getByText(/20\.0 GB free for backups\./)).toBeVisible();
    expect(screen.queryByText(/same disk/)).not.toBeInTheDocument();
  });

  it('warns when backups share a disk with the data or do not outlive the container', () => {
    const { unmount } = ready({
      destination: { freeBytes: 1024, sameDiskAsData: true, persistent: true },
    });
    expect(screen.getByText(/on the same disk as the data they protect/)).toBeVisible();
    unmount();

    ready({ destination: { freeBytes: 1024, sameDiskAsData: true, persistent: false } });
    expect(screen.getByText(/deleted when it is updated/)).toBeVisible();
  });

  it('starts a backup and refreshes', async () => {
    ready({ backups: [] });
    expect(screen.getByText('No backups yet.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(serverBackups.create).toHaveBeenCalledWith(true);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('allows one thing at a time while a backup runs', async () => {
    ready({ running: { kind: 'backup', startedAt: '2026-10-01T03:00:00.000Z' } });
    expect(screen.getByRole('progressbar', { name: 'Backing up' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add a backup file' })).toBeDisabled();
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Restore' })).toHaveAttribute('data-disabled');
    // A finished backup can still be saved elsewhere meanwhile.
    expect(screen.getByRole('menuitem', { name: 'Download' })).not.toHaveAttribute('data-disabled');
  });

  it('restores only after saying what is lost', async () => {
    ready({
      backups: [{ ...backup, includesAttachments: false, attachments: 0 }],
    });
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Changes made since then are lost, on every device.');
    expect(dialog).toHaveTextContent('This backup has no attachments.');
    expect(dialog).toHaveTextContent(
      'Everyone else has to sign in again, and so do you if this backup is from before your account.',
    );
    expect(serverBackups.restore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(serverBackups.restore).toHaveBeenCalledWith(backup.name);
    await waitFor(() => expect(expectRestore).toHaveBeenCalled());
  });

  it('does not offer to restore a backup this server cannot read', async () => {
    ready({ backups: [{ ...backup, problem: 'Made by a newer version of Catch.' }] });
    expect(screen.getByText('Made by a newer version of Catch.')).toBeVisible();
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Restore' })).toHaveAttribute('data-disabled');
  });

  it('downloads a backup', async () => {
    ready();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }));
    expect(serverBackups.download).toHaveBeenCalledWith(backup.name);
  });

  it('deletes a backup once confirmed', async () => {
    ready();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await screen.findByRole('dialog');
    expect(serverBackups.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(serverBackups.remove).toHaveBeenCalledWith(backup.name);
  });

  it('uploads a chosen file and says why the server refused it', async () => {
    vi.mocked(serverBackups.upload).mockRejectedValue(new Error('offline'));
    ready();
    const file = new File(['zip'], 'catch-backup.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } });
    expect(vi.mocked(serverBackups.upload).mock.calls[0]?.[0]).toBe(file);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not add the backup', {
        description: 'The server could not be reached.',
      }),
    );
  });

  it('saves the schedule in this device’s time zone', async () => {
    ready();
    expect(screen.queryByLabelText('Backups to keep')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Back up every day' }));
    const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(serverBackups.saveSchedule).toHaveBeenCalledWith({
      ...DEFAULT_BACKUP_SCHEDULE,
      enabled: true,
      timeZone,
    });

    const keep = await screen.findByLabelText('Backups to keep');
    // An emptied or out-of-range field goes back instead of saving.
    fireEvent.change(keep, { target: { value: '' } });
    fireEvent.blur(keep);
    expect(keep).toHaveValue(7);
    fireEvent.change(keep, { target: { value: '30' } });
    fireEvent.blur(keep);
    expect(serverBackups.saveSchedule).toHaveBeenLastCalledWith({
      ...DEFAULT_BACKUP_SCHEDULE,
      enabled: true,
      keep: 30,
      timeZone,
    });
  });

  it('announces a backup or restore that ends while the page is open', () => {
    const { rerender } = ready({
      running: { kind: 'backup', startedAt: '2026-10-01T03:00:00.000Z' },
    });
    expect(toast.success).not.toHaveBeenCalled();
    const finished = (change: Partial<BackupOverview>) => {
      vi.mocked(useServerBackups).mockReturnValue({
        state: { status: 'ready', overview: { ...overview, ...change } },
        refresh,
        expectRestore,
      });
      rerender(page());
    };

    finished({
      lastBackup: { finishedAt: '2026-10-01T03:00:05.000Z', name: backup.name, error: null },
    });
    expect(toast.success).toHaveBeenCalledWith('Backup saved on the server');

    finished({
      lastBackup: { finishedAt: '2026-10-01T03:00:05.000Z', name: backup.name, error: null },
      lastRestore: {
        finishedAt: '2026-10-01T03:05:00.000Z',
        name: backup.name,
        error: null,
        missingAttachments: 2,
        safetyBackup: null,
      },
    });
    expect(toast.success).toHaveBeenLastCalledWith('Server restored', {
      description: '2 attachments have no file on this server.',
    });
    expect(toast.success).toHaveBeenCalledTimes(2);
  });

  it('says a restore is under way while the server answers nothing else', () => {
    showing({ status: 'restoring' });
    expect(screen.getByRole('progressbar', { name: 'Restoring the backup' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Back up now' })).not.toBeInTheDocument();
  });
});
