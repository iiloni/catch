import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChangePassword } from './ChangePassword';

const changePassword = vi.fn();
vi.mock('@/lib/auth', () => ({
  authClient: { changePassword: (...args: unknown[]) => changePassword(...args) },
}));

beforeEach(() => changePassword.mockReset());

function fill(confirmation = 'newpassword123') {
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: 'oldpassword123' },
  });
  fireEvent.change(screen.getByLabelText('New password', { exact: true }), {
    target: { value: 'newpassword123' },
  });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: confirmation },
  });
}

it('checks password confirmation before sending a change', () => {
  render(<ChangePassword />);
  fill('different123');
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(screen.getByRole('alert')).toHaveTextContent('do not match');
  expect(changePassword).not.toHaveBeenCalled();
});

it('keeps the form on authentication failure and clears passwords after success', async () => {
  changePassword.mockResolvedValueOnce({ error: { message: 'Incorrect current password' } });
  render(<ChangePassword />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect current password');
  expect(changePassword).toHaveBeenCalledWith({
    currentPassword: 'oldpassword123',
    newPassword: 'newpassword123',
    revokeOtherSessions: true,
  });
  changePassword.mockResolvedValueOnce({ error: null, data: {} });
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(screen.getByLabelText('Current password')).toHaveValue('');
  expect(screen.getByLabelText('New password', { exact: true })).toHaveValue('');
});

it('forgets unsaved passwords on cancel', () => {
  render(<ChangePassword />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(screen.getByLabelText('Current password')).toHaveValue('');
  expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
});
