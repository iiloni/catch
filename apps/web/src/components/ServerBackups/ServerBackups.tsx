import type { BackupItem, BackupKind, BackupOverview, BackupSchedule } from '@catch/shared';
import {
  CalendarClock,
  Download,
  Ellipsis,
  FileUp,
  HardDriveDownload,
  History,
  Paperclip,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProgressRow } from '@/components/ImportProgress/ImportProgress';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { haptics } from '@/lib/haptics';
import { BackupRequestError, serverBackups, useServerBackups } from '@/lib/serverBackups';

const numbers = new Intl.NumberFormat();
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const KIND_LABELS: Record<BackupKind, string> = {
  manual: 'Made by hand',
  scheduled: 'Scheduled',
  update: 'Before an update',
  'pre-restore': 'Before a restore',
  upload: 'Uploaded',
};

function formatSize(bytes: number) {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const count = (value: number, one: string, many: string) =>
  `${numbers.format(value)} ${value === 1 ? one : many}`;

const made = (backup: BackupItem) => dateTime.format(new Date(backup.createdAt));

function contents(backup: BackupItem) {
  return [
    KIND_LABELS[backup.kind],
    formatSize(backup.size),
    count(backup.notes, 'note', 'notes'),
    backup.includesAttachments
      ? count(backup.attachments, 'attachment', 'attachments')
      : 'no attachments',
  ].join(' · ');
}

const message = (error: unknown) =>
  error instanceof BackupRequestError ? error.message : 'The server could not be reached.';

/**
 * Backups of the whole server, for its admins (Settings > Admin > Backups): make one,
 * download, upload and restore them, and set the daily schedule.
 */
export function ServerBackups({ onAccessDenied }: { onAccessDenied: () => void }) {
  const { state, refresh, expectRestore } = useServerBackups(onAccessDenied);
  const input = useRef<HTMLInputElement>(null);
  const [starting, setStarting] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; sent: number; total: number } | null>(
    null,
  );
  const [restoring, setRestoring] = useState<BackupItem | null>(null);
  const [deleting, setDeleting] = useState<BackupItem | null>(null);

  const overview = state.status === 'ready' ? state.overview : null;
  useAnnounceResults(overview);

  if (state.status === 'restoring') {
    return (
      <SettingsSection title="Server backups">
        <ProgressRow label="Restoring the backup" done={0} total={null}>
          <p>Catch is unavailable on every device until this finishes.</p>
        </ProgressRow>
      </SettingsSection>
    );
  }
  if (!overview) {
    return (
      <SettingsSection title="Server backups">
        {state.status === 'loading' ? (
          <p role="status" className="px-4 py-8 text-center text-muted-foreground text-sm">
            Loading backups…
          </p>
        ) : (
          <SettingsRow
            label="Could not load backups"
            description="Check your connection and try again"
          >
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => void refresh()}
            >
              Retry
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
    );
  }

  const busy = overview.running !== null || starting || uploading !== null;

  async function backUp() {
    setStarting(true);
    try {
      await serverBackups.create(true);
      haptics.toggle();
    } catch (error) {
      toast.error('Could not start the backup', { description: message(error) });
    } finally {
      await refresh();
      setStarting(false);
    }
  }

  async function upload(file: File) {
    setUploading({ name: file.name, sent: 0, total: file.size });
    try {
      const added = await serverBackups.upload(file, (sent, total) =>
        setUploading({ name: file.name, sent, total }),
      );
      toast.success('Backup added', {
        description: `From ${made(added)}. Restore it from the list.`,
      });
    } catch (error) {
      toast.error('Could not add the backup', { description: message(error) });
    } finally {
      setUploading(null);
      await refresh();
    }
  }

  async function restore(backup: BackupItem) {
    setRestoring(null);
    try {
      await serverBackups.restore(backup.name);
      expectRestore();
    } catch (error) {
      toast.error('Could not restore the backup', { description: message(error) });
      await refresh();
    }
  }

  async function remove(backup: BackupItem) {
    setDeleting(null);
    try {
      await serverBackups.remove(backup.name);
    } catch (error) {
      toast.error('Could not delete the backup', { description: message(error) });
    }
    await refresh();
  }

  async function download(backup: BackupItem) {
    try {
      await serverBackups.download(backup.name);
    } catch (error) {
      toast.error('Could not download the backup', { description: message(error) });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Server backups"
        description={<Destination destination={overview.destination} />}
      >
        <SettingsRow
          icon={HardDriveDownload}
          label="Back up this server"
          description="Every account, note and attachment"
        >
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            aria-label="Back up now"
            disabled={busy}
            onClick={() => void backUp()}
          >
            Back up
          </Button>
        </SettingsRow>
        {overview.running?.kind === 'backup' && (
          <ProgressRow label="Backing up" done={0} total={null}>
            <p>You can leave this page; the backup keeps going.</p>
          </ProgressRow>
        )}
        <SettingsRow
          icon={FileUp}
          label="Add a backup file"
          description="To restore one kept somewhere else"
        >
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            aria-label="Add a backup file"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            Choose
          </Button>
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip"
            hidden
            disabled={busy}
            aria-label="Backup file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Lets the same file be chosen again after a failed upload.
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
        </SettingsRow>
        {uploading && (
          <ProgressRow
            label={`Uploading ${uploading.name}`}
            done={uploading.sent}
            total={uploading.total}
          >
            <p>
              {uploading.sent < uploading.total
                ? `${formatSize(uploading.sent)} of ${formatSize(uploading.total)}`
                : 'Checking every file in it…'}
            </p>
          </ProgressRow>
        )}
        {overview.backups.length === 0 && (
          <p className="px-4 py-3.5 text-muted-foreground text-sm">No backups yet.</p>
        )}
        {overview.backups.map((backup) => (
          <div key={backup.name} className="flex min-h-14 items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{made(backup)}</p>
              <p className="text-muted-foreground text-sm">{contents(backup)}</p>
              {backup.problem && <p className="text-destructive text-sm">{backup.problem}</p>}
            </div>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton label={`Manage the backup from ${made(backup)}`}>
                  <Ellipsis />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void download(backup)}>
                  <Download />
                  Download
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={busy || backup.problem !== null}
                  onSelect={() => setRestoring(backup)}
                >
                  <History />
                  Restore
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy}
                  onSelect={() => setDeleting(backup)}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </SettingsSection>

      <Schedule schedule={overview.schedule} onSaved={refresh} />

      <Dialog open={restoring !== null} onOpenChange={(open) => !open && setRestoring(null)}>
        <DialogContent>
          <DialogTitle>Restore this backup?</DialogTitle>
          <DialogDescription>
            The server goes back to {restoring && made(restoring)} for everyone: notes, accounts and
            passwords. Changes made since then are lost, on every device.
          </DialogDescription>
          {restoring && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground text-sm">
              <li>Catch is unavailable while it restores, then every device syncs again.</li>
              <li>The database as it is now is kept as a backup, to undo this with.</li>
              {!restoring.includesAttachments && (
                <li>This backup has no attachments. The files on the server stay as they are.</li>
              )}
              <li>
                Everyone else has to sign in again, and so do you if this backup is from before your
                account.
              </li>
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" className="rounded-full">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="rounded-full"
              onClick={() => restoring && void restore(restoring)}
            >
              Restore
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogTitle>Delete this backup?</DialogTitle>
          <DialogDescription>
            The backup from {deleting && made(deleting)} is removed from the server. Copies you
            downloaded are not affected.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" className="rounded-full">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="rounded-full"
              onClick={() => deleting && void remove(deleting)}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Says how a backup or restore went when it ends while the page is open. */
function useAnnounceResults(overview: BackupOverview | null) {
  // Results from before the page opened were announced then, or to someone else.
  const seen = useRef<{ backup: string | null; restore: string | null } | null>(null);
  useEffect(() => {
    if (!overview) return;
    const backup = overview.lastBackup;
    const restore = overview.lastRestore;
    const before = seen.current;
    seen.current = { backup: backup?.finishedAt ?? null, restore: restore?.finishedAt ?? null };
    if (!before) return;

    if (backup && backup.finishedAt !== before.backup) {
      if (backup.error) toast.error('The backup failed', { description: backup.error });
      else {
        haptics.success();
        toast.success('Backup saved on the server');
      }
    }
    if (restore && restore.finishedAt !== before.restore) {
      if (restore.error) {
        toast.error('The restore failed', {
          description: `${restore.error} Nothing was changed.`,
        });
      } else {
        haptics.success();
        toast.success('Server restored', {
          description:
            restore.missingAttachments > 0
              ? `${count(restore.missingAttachments, 'attachment has', 'attachments have')} no file on this server.`
              : 'Every device syncs again on its own.',
        });
      }
    }
  }, [overview]);
}

function Destination({ destination }: { destination: BackupOverview['destination'] }) {
  if (!destination.persistent) {
    return (
      <span className="text-destructive">
        Backups are kept inside the server’s container and are deleted when it is updated. Download
        them, and mount a volume at /data/backups.
      </span>
    );
  }
  const free =
    destination.freeBytes === null
      ? 'The server cannot write to its backups directory.'
      : `${formatSize(destination.freeBytes)} free for backups.`;
  return (
    <>
      {free}
      {destination.sameDiskAsData &&
        ' They are on the same disk as the data they protect, so download the ones that matter.'}
    </>
  );
}

function Schedule({
  schedule,
  onSaved,
}: {
  schedule: BackupSchedule;
  onSaved: () => Promise<void>;
}) {
  // Edited here and saved as a whole, so a slow save cannot undo a later change.
  const [draft, setDraft] = useState(schedule);
  useEffect(() => setDraft(schedule), [schedule]);

  async function save(change: Partial<BackupSchedule>) {
    // The time is entered on this device, so it means this device's time zone.
    const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const next = { ...draft, ...change, timeZone };
    setDraft(next);
    try {
      await serverBackups.saveSchedule(next);
    } catch (error) {
      toast.error('Could not save the schedule', { description: message(error) });
    }
    await onSaved();
  }

  return (
    <SettingsSection
      title="Automatic backups"
      description="Only scheduled backups are removed to make room for new ones. The server also backs up its database before each update."
    >
      <SettingsRow
        icon={CalendarClock}
        label="Back up every day"
        description={draft.enabled ? `At ${draft.time}, ${draft.timeZone} time` : 'Off'}
      >
        <Switch
          aria-label="Back up every day"
          checked={draft.enabled}
          onCheckedChange={(enabled) => {
            haptics.toggle();
            void save({ enabled });
          }}
        />
      </SettingsRow>
      {draft.enabled && (
        <>
          <SettingsRow label="Time">
            <Input
              type="time"
              aria-label="Backup time"
              className="w-32"
              value={draft.time}
              onChange={(event) => {
                if (event.target.value) void save({ time: event.target.value.slice(0, 5) });
              }}
            />
          </SettingsRow>
          <SettingsRow label="Backups to keep" description="Older scheduled ones are removed">
            <KeepInput value={draft.keep} onCommit={(keep) => void save({ keep })} />
          </SettingsRow>
          <SettingsRow
            icon={Paperclip}
            label="Include attachments"
            description="Off backs up the database alone"
          >
            <Switch
              aria-label="Include attachments in scheduled backups"
              checked={draft.includeAttachments}
              onCheckedChange={(includeAttachments) => {
                haptics.toggle();
                void save({ includeAttachments });
              }}
            />
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
}

/** Saves once a whole number has been entered, so the field can be emptied on the way to one. */
function KeepInput({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  function commit() {
    const keep = Number(text);
    if (Number.isInteger(keep) && keep >= 1 && keep <= 365) {
      if (keep !== value) onCommit(keep);
    } else setText(String(value));
  }

  return (
    <Input
      type="number"
      inputMode="numeric"
      min={1}
      max={365}
      aria-label="Backups to keep"
      className="w-20"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
