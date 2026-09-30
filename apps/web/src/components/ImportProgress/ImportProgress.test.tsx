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
    state && { source: 'Google Keep', total: 0, saved: 0, failed: 0, finished: false, ...state },
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

  it('sums up a finished import until dismissed', () => {
    showing({ total: 100, saved: 80, failed: 20, finished: true });
    expect(screen.getByRole('status')).toHaveTextContent('80 notes imported from Google Keep');
    expect(screen.getByRole('status')).toHaveTextContent('20 notes could not be saved');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismissImport).toHaveBeenCalled();
  });
});
