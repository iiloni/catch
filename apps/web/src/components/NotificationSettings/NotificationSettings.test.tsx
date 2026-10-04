import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushState } from '@/lib/push';
import { NotificationSettings } from './NotificationSettings';

const push = vi.hoisted(() => ({
  state: 'off' as PushState,
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  sendTestPush: vi.fn(),
}));

vi.mock('@/lib/push', () => ({
  usePushState: () => push.state,
  refreshPushState: vi.fn().mockResolvedValue(undefined),
  enablePush: push.enablePush,
  disablePush: push.disablePush,
  sendTestPush: push.sendTestPush,
}));
vi.mock('@/lib/reminders', async () => {
  const { useState } = await import('react');
  return {
    useReminderTimes: () => useState({ morning: '08:00', afternoon: '13:00', evening: '18:00' }),
  };
});

beforeEach(() => {
  push.state = 'off';
  push.enablePush.mockReset().mockImplementation(async () => {
    push.state = 'on';
  });
  push.disablePush.mockReset().mockImplementation(async () => {
    push.state = 'off';
  });
  push.sendTestPush.mockReset().mockResolvedValue(undefined);
});

describe('NotificationSettings', () => {
  it('turns notifications on for this device', async () => {
    render(<NotificationSettings />);
    const toggle = screen.getByRole('switch', { name: 'Reminder notifications' });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(push.enablePush).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('turns them off and offers a test while they are on', async () => {
    push.state = 'on';
    render(<NotificationSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(push.sendTestPush).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('switch', { name: 'Reminder notifications' }));
    await waitFor(() => expect(push.disablePush).toHaveBeenCalled());
  });

  it.each([
    ['native', /Android app does not show reminders yet/],
    ['needs-install', /add Catch to your Home Screen/],
    ['blocked', /Notifications are blocked/],
    ['unsupported', /cannot receive notifications/],
  ] as const)('explains why %s devices cannot turn them on', (state, reason) => {
    push.state = state;
    render(<NotificationSettings />);
    expect(screen.getByRole('switch', { name: 'Reminder notifications' })).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('changes a quick time', () => {
    render(<NotificationSettings />);
    const morning = screen.getByLabelText('Morning time');
    fireEvent.change(morning, { target: { value: '07:30' } });
    expect(morning).toHaveValue('07:30');
  });
});
