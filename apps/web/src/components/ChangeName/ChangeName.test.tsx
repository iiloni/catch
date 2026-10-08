import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChangeName } from './ChangeName';

const changeAccountName = vi.fn();
vi.mock('@/lib/auth', () => ({
  changeAccountName: (...args: unknown[]) => changeAccountName(...args),
}));

beforeEach(() => changeAccountName.mockReset());

function edit(value: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Change name' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value } });
}

it('rejects whitespace-only names before sending a change', () => {
  render(<ChangeName name="Old Name" onChanged={vi.fn()} />);
  edit('   ');
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a name');
  expect(changeAccountName).not.toHaveBeenCalled();
});

it('preserves a failed draft for retry, then shows the saved name when reopened', async () => {
  changeAccountName.mockResolvedValueOnce({ error: { message: 'Session expired' } });
  const onChanged = vi.fn();
  const view = render(<ChangeName name="Old Name" onChanged={onChanged} />);
  edit('  New Name  ');
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Session expired');
  expect(screen.getByLabelText('Name')).toHaveValue('  New Name  ');
  expect(onChanged).not.toHaveBeenCalled();
  changeAccountName.mockResolvedValueOnce({ error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(changeAccountName).toHaveBeenLastCalledWith('New Name');
  expect(onChanged).toHaveBeenCalledOnce();
  view.rerender(<ChangeName name="New Name" onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Change name' }));
  expect(screen.getByLabelText('Name')).toHaveValue('New Name');
});

it('keeps connection failures visible and discards unsaved edits on cancel', async () => {
  changeAccountName.mockRejectedValueOnce(new Error('offline'));
  render(<ChangeName name="Old Name" onChanged={vi.fn()} />);
  edit('New Name');
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change name' }));
  expect(screen.getByLabelText('Name')).toHaveValue('Old Name');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('prevents duplicate saves and dismissal while saving', async () => {
  let finish: (value: { error: null }) => void = () => {};
  changeAccountName.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<ChangeName name="Old Name" onChanged={vi.fn()} />);
  edit('New Name');
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByLabelText('Name')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(changeAccountName).toHaveBeenCalledOnce();
  finish({ error: null });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
