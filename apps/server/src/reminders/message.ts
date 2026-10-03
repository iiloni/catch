import type { PushMessage } from '@catch/shared';

const TITLE_LENGTH = 80;
const BODY_LENGTH = 180;

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;

/** The notification for a note's reminder: its first line as the title, the rest under it. */
export function reminderMessage(noteId: string, searchText: string): PushMessage {
  const [first = '', ...rest] = searchText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    type: 'reminder',
    noteId,
    title: first ? clip(first, TITLE_LENGTH) : 'Reminder',
    body: clip(rest.join(' '), BODY_LENGTH),
  };
}
