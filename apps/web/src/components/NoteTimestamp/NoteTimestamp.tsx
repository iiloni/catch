import { formatTime, useHour12 } from '@/lib/clock';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function NoteTimestamp({ updatedAt }: { updatedAt: Date }) {
  // Redraws the times below when the clock setting changes.
  useHour12();
  const sameDay = updatedAt.toDateString() === new Date().toDateString();
  const edited = sameDay ? formatTime(updatedAt) : dateFormat.format(updatedAt);

  return (
    <p className="px-4 pt-6 pb-2 text-center text-muted-foreground text-xs">
      Edited <time dateTime={updatedAt.toISOString()}>{edited}</time>
    </p>
  );
}
