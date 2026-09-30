const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function NoteTimestamp({ updatedAt }: { updatedAt: Date }) {
  const sameDay = updatedAt.toDateString() === new Date().toDateString();
  const edited = sameDay ? timeFormat.format(updatedAt) : dateFormat.format(updatedAt);

  return (
    <p className="px-4 pt-6 pb-2 text-center text-muted-foreground text-xs">
      Edited <time dateTime={updatedAt.toISOString()}>{edited}</time>
    </p>
  );
}
