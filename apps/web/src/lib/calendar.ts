import { blocksToPlainText, type Note } from '@catch/shared';
import { getServerUrl } from './serverUrl';

const TITLE_LENGTH = 200;

/** A note has no title of its own: its first line with text stands in for one. */
function noteTitle(content: Note['content']) {
  const first =
    blocksToPlainText(content)
      .split('\n')
      .find((line) => line.trim()) ?? '';
  // By code point: cutting between the two halves of an emoji leaves a broken character.
  return Array.from(first.trim()).slice(0, TITLE_LENGTH).join('');
}

/**
 * Google Calendar's new event form, filled in with the note's title and a link back to the
 * note. It is a plain link: Catch holds no Google account and never learns whether the event
 * was saved.
 */
export function googleCalendarEventUrl(note: Pick<Note, 'id' | 'content'>) {
  const params = new URLSearchParams({ action: 'TEMPLATE' });
  const title = noteTitle(note.content);
  if (title) params.set('text', title);
  params.set('details', `${getServerUrl()}/?note=${encodeURIComponent(note.id)}`);
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function addToGoogleCalendar(note: Pick<Note, 'id' | 'content'>) {
  window.open(googleCalendarEventUrl(note), '_blank', 'noopener,noreferrer');
}
