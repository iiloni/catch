import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { updateSyncStatus } from '@/lib/syncStatus';
import { SaveStatus } from './SaveStatus';

afterEach(() => act(() => updateSyncStatus({ offline: false })));

describe('SaveStatus', () => {
  it('shows a save in progress', () => {
    render(<SaveStatus state="saving" updatedAt={new Date()} />);
    expect(screen.getByText('Saving…')).toBeInTheDocument();
  });

  it('says an offline save is kept on the device', () => {
    act(() => updateSyncStatus({ offline: true }));
    render(<SaveStatus state="saving" updatedAt={new Date()} />);
    expect(screen.getByText('Saved on this device')).toBeInTheDocument();
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });

  it('shows when the note was last edited once saved', () => {
    act(() => updateSyncStatus({ offline: true }));
    render(<SaveStatus state="saved" updatedAt={new Date()} />);
    expect(screen.getByText(/^Edited/)).toBeInTheDocument();
  });
});
