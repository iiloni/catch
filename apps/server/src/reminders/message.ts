import type { PushMessage } from '@catch/shared';

const TITLE_LENGTH = 80;
const BODY_LENGTH = 180;

// By code point: cutting between the two halves of an emoji leaves a broken character.
function clip(text: string, length: number) {
  const points = Array.from(text);
  if (points.length <= length) return text;
  return `${points
    .slice(0, length - 1)
    .join('')
    .trimEnd()}…`;
}

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
