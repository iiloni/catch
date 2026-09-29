import { CloudAlert, CloudCheck, CloudOff, LoaderCircle } from 'lucide-react';
import { useSyncStatus } from '@/lib/syncStatus';
import type { SaveState } from '@/lib/useNoteAutosave';

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function formatEdited(date: Date) {
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? timeFormat.format(date) : dateFormat.format(date);
}

type Props = {
  state: SaveState;
  updatedAt: Date;
};

export function SaveStatus({ state, updatedAt }: Props) {
  // Offline, a save waits in the outbox until the connection comes back.
  const { offline } = useSyncStatus();
  const local = state === 'saving' && offline;
  return (
    <p className="flex items-center gap-1.5 text-muted-foreground text-xs" aria-live="polite">
      {local && (
        <>
          <CloudOff className="size-3.5" aria-hidden />
          Saved on this device
        </>
      )}
      {state === 'saving' && !local && (
        <>
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          Saving…
        </>
      )}
      {state === 'saved' && (
        <>
          <CloudCheck className="size-3.5" aria-hidden />
          Edited {formatEdited(updatedAt)}
        </>
      )}
      {state === 'error' && (
        <>
          <CloudAlert className="size-3.5 text-destructive" aria-hidden />
          Not saved
        </>
      )}
    </p>
  );
}
