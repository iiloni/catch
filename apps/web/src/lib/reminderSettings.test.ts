import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  reportTimeZone: vi.fn(async () => ({ timeZone: 'UTC' })),
  reminderSettings: vi.fn(),
  saveReminderSettings: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock('./collections', () => ({ remindersCollection: {}, write: vi.fn() }));
vi.mock('./api', () => ({ api }));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));

import { setReminderTimes, syncReminderSettings } from './reminders';
import { setSnoozeMinutes, snoozeKey, snoozeMinutes } from './snooze';

const times = { morning: '08:00', afternoon: '13:00', evening: '18:00' };

beforeEach(async () => {
  api.reminderSettings.mockResolvedValue({ timeZone: 'UTC', times, snoozeMinutes: 30 });
  setSnoozeMinutes(30);
  await syncReminderSettings('user-1');
  expect(localStorage.getItem(`${snoozeKey()}:unsent`)).toBeNull();
  vi.clearAllMocks();
  api.saveReminderSettings.mockResolvedValue({ ok: true });
});

describe('the snooze length', () => {
  it('is sent to the server on its own when chosen here', async () => {
    setSnoozeMinutes(15);
    await vi.waitFor(() => expect(api.saveReminderSettings).toHaveBeenCalled());
    // Not with the quick times, which this device may hold only as defaults.
    expect(api.saveReminderSettings).toHaveBeenCalledWith({
      times: undefined,
      snoozeMinutes: 15,
      timeZone: expect.any(String),
    });
  });

  it('is left out when only a quick time changes', async () => {
    const changed = { ...times, morning: '07:00' };
    setReminderTimes(changed);
    await vi.waitFor(() => expect(api.saveReminderSettings).toHaveBeenCalled());
    expect(api.saveReminderSettings).toHaveBeenCalledWith({
      times: changed,
      snoozeMinutes: undefined,
      timeZone: expect.any(String),
    });
    setReminderTimes(times);
    await vi.waitFor(() => expect(api.saveReminderSettings).toHaveBeenCalledTimes(2));
  });

  it('is taken from the server without being sent back', async () => {
    api.reminderSettings.mockResolvedValue({ timeZone: 'UTC', times, snoozeMinutes: 60 });
    await syncReminderSettings('user-1');
    expect(snoozeMinutes()).toBe(60);
    expect(api.saveReminderSettings).not.toHaveBeenCalled();
  });

  it('chosen offline is sent at the next sync, and kept over what the server still holds', async () => {
    api.saveReminderSettings.mockRejectedValue(new Error('offline'));
    setSnoozeMinutes(15);
    await vi.waitFor(() => expect(api.saveReminderSettings).toHaveBeenCalledTimes(1));
    api.reminderSettings.mockResolvedValue({ timeZone: 'UTC', times, snoozeMinutes: 60 });
    await syncReminderSettings('user-1');
    expect(api.saveReminderSettings).toHaveBeenCalledTimes(2);
    expect(snoozeMinutes()).toBe(15);

    api.saveReminderSettings.mockResolvedValue({ ok: true });
    api.reminderSettings.mockResolvedValue({ timeZone: 'UTC', times, snoozeMinutes: 15 });
    await syncReminderSettings('user-1');
    expect(api.saveReminderSettings).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem(`${snoozeKey()}:unsent`)).toBeNull();
  });
});
