import { CloudAlert, CloudCheck, LoaderCircle } from 'lucide-react';
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
  return (
    <p className="flex items-center gap-1.5 text-muted-foreground text-xs" aria-live="polite">
      {state === 'saving' && (
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
