import { type PushMessage, reminderText } from '@catch/shared';

/** The notification for a note's reminder: its first line as the title, the rest under it. */
export function reminderMessage(noteId: string, searchText: string): PushMessage {
  return { type: 'reminder', noteId, ...reminderText(searchText) };
}
