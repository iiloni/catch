import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissImport, type ImportState, useImport } from '@/lib/imports';
import { updateSyncStatus } from '@/lib/syncStatus';
import { ImportProgress } from './ImportProgress';

vi.mock('@/lib/imports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/imports')>()),
  useImport: vi.fn(),
  dismissImport: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  updateSyncStatus({ offline: false });
});

function showing(state: Partial<ImportState> | null) {
  vi.mocked(useImport).mockReturnValue(
    state && {
      source: 'Google Keep',
      total: 0,
      saved: 0,
      failed: 0,
      finished: false,
      attachmentTotal: 0,
      attachmentSaved: 0,
      attachmentFailed: 0,
      preparing: 0,
      ...state,
    },
  );
  return render(<ImportProgress />);
}

describe('ImportProgress', () => {
  it('shows nothing without an import', () => {
    const { container } = showing(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows how much of a running import the server has', () => {
    showing({ total: 2000, saved: 450 });
    expect(screen.getByRole('progressbar', { name: 'Importing from Google Keep' })).toHaveAttribute(
      'aria-valuenow',
      '22',
    );
    expect(screen.getByText('450 of 2,000 notes saved on your server')).toBeInTheDocument();
    expect(
      screen.getByText('You can leave this page; the import keeps going.'),
    ).toBeInTheDocument();
  });

  it('says when it is waiting for a connection', () => {
    updateSyncStatus({ offline: true });
    showing({ total: 100, saved: 50 });
    expect(screen.getByText(/Waiting for a connection/)).toBeInTheDocument();
  });

  it('distinguishes preparing files from durable queued uploads', () => {
    showing({ total: 1, saved: 1, attachmentTotal: 2, attachmentSaved: 1, preparing: 1 });
    expect(screen.getByText(/Preparing 1 attachment on this device/)).toBeInTheDocument();
    expect(screen.getByText('1 of 2 attachments saved on your server')).toBeInTheDocument();
  });

  it('summarizes an attachment-only import and explains retrying failures', () => {
    showing({ attachmentTotal: 3, attachmentSaved: 2, attachmentFailed: 1, finished: true });
    expect(screen.getByRole('status')).toHaveTextContent('2 attachments imported from Google Keep');
    expect(screen.getByRole('status')).toHaveTextContent('1 attachment could not be saved');
  });

  it('sums up a finished import until dismissed', () => {
    showing({ total: 100, saved: 80, failed: 20, finished: true });
    expect(screen.getByRole('status')).toHaveTextContent('80 notes imported from Google Keep');
    expect(screen.getByRole('status')).toHaveTextContent('20 notes could not be saved');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismissImport).toHaveBeenCalled();
  });
});
