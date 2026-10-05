import { describe, expect, it } from 'vitest';
import { reminderMessage } from './message';

const id = '0199a0a0-0000-7000-8000-000000000000';

describe('reminderMessage', () => {
  it('uses the first line as the title and the rest as the body', () => {
    expect(
      reminderMessage(id, '\n  Call the dentist \nAsk about Friday\n\nBring the form'),
    ).toEqual({
      type: 'reminder',
      noteId: id,
      title: 'Call the dentist',
      body: 'Ask about Friday Bring the form',
    });
  });

  it('names a note without text', () => {
    expect(reminderMessage(id, '  \n')).toMatchObject({ title: 'Reminder', body: '' });
  });

  it('clips long notes', () => {
    const message = reminderMessage(id, `${'a'.repeat(200)}\n${'b'.repeat(500)}`);
    expect(message.title).toHaveLength(80);
    expect(message.title.endsWith('…')).toBe(true);
    expect(message.body).toHaveLength(180);
  });

  it('does not cut an emoji in half', () => {
    const { title } = reminderMessage(id, '😀'.repeat(100));
    expect(Array.from(title)).toHaveLength(80);
    expect(title).toBe(`${'😀'.repeat(79)}…`);
  });
});
