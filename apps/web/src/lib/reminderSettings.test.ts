import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  reportTimeZone: vi.fn(async () => ({ timeZone: 'UTC' })),
  reminderSettings: vi.fn(),
  saveReminderSettings: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock('./collections', () => ({ remindersCollection: {}, write: vi.fn() }));
vi.mock('./api', () => ({ api }));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));

import { syncReminderSettings } from './reminders';
import { setSnoozeMinutes, snoozeMinutes } from './snooze';

const times = { morning: '08:00', afternoon: '13:00', evening: '18:00' };

beforeEach(async () => {
  setSnoozeMinutes(30);
  await vi.waitFor(() =>
    expect(localStorage.getItem('catch-reminder-times:user-1:unsent')).toBeNull(),
  );
  vi.clearAllMocks();
  api.saveReminderSettings.mockResolvedValue({ ok: true });
});

describe('the snooze length', () => {
  it('is sent to the server with the quick times when chosen here', async () => {
    setSnoozeMinutes(15);
    await vi.waitFor(() =>
      expect(api.saveReminderSettings).toHaveBeenCalledWith(
        expect.objectContaining({ times, snoozeMinutes: 15 }),
      ),
    );
  });

  it('is taken from the server without being sent back', async () => {
    api.reminderSettings.mockResolvedValue({ timeZone: 'UTC', times, snoozeMinutes: 60 });
    await syncReminderSettings('user-1');
    expect(snoozeMinutes()).toBe(60);
    expect(api.saveReminderSettings).not.toHaveBeenCalled();
  });

  it('chosen offline is sent at the next sync instead of being overwritten', async () => {
    api.saveReminderSettings.mockRejectedValueOnce(new Error('offline'));
    setSnoozeMinutes(15);
    await vi.waitFor(() => expect(api.saveReminderSettings).toHaveBeenCalledTimes(1));
    api.reminderSettings.mockResolvedValue({ timeZone: 'UTC', times, snoozeMinutes: 60 });
    await syncReminderSettings('user-1');
    expect(api.saveReminderSettings).toHaveBeenCalledTimes(2);
    expect(api.reminderSettings).not.toHaveBeenCalled();
    expect(snoozeMinutes()).toBe(15);
  });
});
