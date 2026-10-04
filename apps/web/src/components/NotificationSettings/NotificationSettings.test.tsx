import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushState } from '@/lib/push';
import { NotificationSettings } from './NotificationSettings';

const push = vi.hoisted(() => ({
  state: 'off' as PushState,
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  sendTestPush: vi.fn(),
  refreshPushState: vi.fn(),
}));

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/push', () => ({
  usePushState: () => push.state,
  refreshPushState: push.refreshPushState,
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
  push.refreshPushState.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  toast.error.mockReset();
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
    const toggle = screen.getByRole('switch', { name: 'Reminder notifications' });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(push.disablePush).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('reads what the device allows when the page opens', () => {
    render(<NotificationSettings />);
    expect(push.refreshPushState).toHaveBeenCalledTimes(1);
  });

  it('says so and reads the state again when turning them on fails', async () => {
    push.enablePush.mockRejectedValue(new Error('No push service'));
    render(<NotificationSettings />);
    const toggle = screen.getByRole('switch', { name: 'Reminder notifications' });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Notifications could not be turned on', {
        description: 'No push service',
      }),
    );
    expect(push.refreshPushState).toHaveBeenCalledTimes(2);
    expect(toggle).not.toBeChecked();
  });

  it('says so when the test notification is not sent', async () => {
    push.state = 'on';
    push.sendTestPush.mockRejectedValue(new Error('The push service did not take it'));
    render(<NotificationSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('The test notification was not sent', {
        description: 'The push service did not take it',
      }),
    );
    expect(toast).not.toHaveBeenCalled();
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
