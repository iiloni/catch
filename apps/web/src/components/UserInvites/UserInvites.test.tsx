import type { Invite } from '@catch/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { UserInvites } from './UserInvites';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { listInvites: vi.fn(), createInvite: vi.fn(), deleteInvite: vi.fn() },
}));

const token = 'aB3_-'.repeat(8) + 'xyz';
const waiting: Invite = {
  id: '0199a0a0-0000-4000-8000-000000000001',
  label: 'Sam',
  createdAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2999-10-08T00:00:00.000Z',
  usedAt: null,
  usedBy: null,
};
const used: Invite = {
  ...waiting,
  id: '0199a0a0-0000-4000-8000-000000000002',
  label: '',
  usedAt: '2026-10-02T00:00:00.000Z',
  usedBy: { name: 'Ada', email: 'ada@example.com' },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listInvites).mockResolvedValue({ invites: [waiting, used] });
});

describe('UserInvites', () => {
  it('lists invites with what became of them', async () => {
    render(<UserInvites onAccessDenied={vi.fn()} />);
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(screen.getByText(/^Waiting, until /)).toBeInTheDocument();
    expect(screen.getByText(/by ada@example\.com$/)).toBeInTheDocument();
  });

  it('says when an invite has run out', async () => {
    vi.mocked(api.listInvites).mockResolvedValue({
      invites: [{ ...waiting, expiresAt: '2026-10-02T00:00:00.000Z' }],
    });
    render(<UserInvites onAccessDenied={vi.fn()} />);
    expect(await screen.findByText(/^Expired /)).toBeInTheDocument();
  });

  it('leaves when the list is refused, and hides on a server without invites', async () => {
    vi.mocked(api.listInvites).mockRejectedValueOnce(new ApiError(403, 'Admin access required'));
    const onAccessDenied = vi.fn();
    const refused = render(<UserInvites onAccessDenied={onAccessDenied} />);
    await waitFor(() => expect(onAccessDenied).toHaveBeenCalled());
    // Nothing can be made before the list is known.
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeDisabled();
    refused.unmount();

    vi.mocked(api.listInvites).mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    const { container } = render(<UserInvites onAccessDenied={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('copies the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.mocked(api.createInvite).mockResolvedValue({ invite: waiting, token });
    render(<UserInvites onAccessDenied={vi.fn()} />);
    await screen.findByText('Sam');
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/login#invite=${token}`);
    vi.unstubAllGlobals();
  });

  it('shows a new invite’s link once, with the token in its fragment', async () => {
    vi.mocked(api.createInvite).mockResolvedValue({ invite: { ...waiting, label: 'Kim' }, token });
    render(<UserInvites onAccessDenied={vi.fn()} />);
    await screen.findByText('Sam');
    fireEvent.change(screen.getByLabelText('Who the invite is for'), { target: { value: 'Kim' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));
    const link = await screen.findByRole('textbox', { name: 'Invite link' });
    expect(api.createInvite).toHaveBeenCalledWith({ label: 'Kim' });
    expect(link).toHaveValue(`${window.location.origin}/login#invite=${token}`);
    expect(screen.getByText('Kim')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Invite link' })).toBeNull());
  });

  it('removes an invite, and leaves when the admin has lost access', async () => {
    vi.mocked(api.deleteInvite).mockResolvedValueOnce({ ok: true });
    const onAccessDenied = vi.fn();
    render(<UserInvites onAccessDenied={onAccessDenied} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove invite for Sam' }));
    await waitFor(() => expect(screen.queryByText('Sam')).toBeNull());
    expect(api.deleteInvite).toHaveBeenCalledWith(waiting.id);

    vi.mocked(api.deleteInvite).mockRejectedValueOnce(new ApiError(403, 'Admin access required'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove invite' }));
    await waitFor(() => expect(onAccessDenied).toHaveBeenCalled());
  });
});
