import { afterEach, describe, expect, it, vi } from 'vitest';
import { addToGoogleCalendar, googleCalendarEventUrl } from './calendar';

const id = '0199a0a0-0000-7000-8000-000000000001';
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

afterEach(() => vi.restoreAllMocks());

describe('googleCalendarEventUrl', () => {
  it("fills the event with the note's first line and a link back to it", () => {
    const url = new URL(
      googleCalendarEventUrl({
        id,
        content: [paragraph(''), paragraph('  Dentist & checkup  '), paragraph('Bring the forms')],
      }),
    );
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Dentist & checkup');
    expect(url.searchParams.get('details')).toBe(`${window.location.origin}/?note=${id}`);
  });

  it('leaves the title to Google for a note with no text', () => {
    const url = new URL(googleCalendarEventUrl({ id, content: [] }));
    expect(url.searchParams.has('text')).toBe(false);
    expect(url.searchParams.get('details')).toBe(`${window.location.origin}/?note=${id}`);
  });

  it('cuts a long first line without splitting an emoji', () => {
    const url = new URL(googleCalendarEventUrl({ id, content: [paragraph('🎉'.repeat(300))] }));
    expect(url.searchParams.get('text')).toBe('🎉'.repeat(200));
  });
});

describe('addToGoogleCalendar', () => {
  it('opens the form outside the app', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    addToGoogleCalendar({ id, content: [paragraph('Dentist')] });
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('text=Dentist'),
      '_blank',
      'noopener,noreferrer',
    );
  });
});
