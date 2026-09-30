import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startImport, useImport } from '@/lib/imports';
import { type KeepExport, KeepImportError, readKeepExport } from '@/lib/keepImport';
import { hasNote, type ImportedNote } from '@/lib/notes';
import { KeepImport } from './KeepImport';

vi.mock('@/lib/notes');
vi.mock('@/lib/imports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/imports')>()),
  startImport: vi.fn(),
  useImport: vi.fn(() => null),
}));
vi.mock('@/lib/keepImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/keepImport')>()),
  readKeepExport: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(useImport).mockReturnValue(null);
});

function imported(id: string): ImportedNote {
  return {
    id,
    content: [{ type: 'paragraph', content: [] }],
    color: 'default',
    isPinned: false,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function exported(overrides: Partial<KeepExport> = {}): KeepExport {
  return {
    notes: [imported('a'), imported('b'), imported('c')],
    trashed: 0,
    mediaOnly: 0,
    attachments: 0,
    labelled: 0,
    ...overrides,
  };
}

function choose(files: File[]) {
  fireEvent.change(screen.getByLabelText('Google Takeout export'), { target: { files } });
}

const takeout = new File(['zip'], 'takeout.zip', { type: 'application/zip' });

describe('KeepImport', () => {
  it('shows the export being read on the page, and stops reading when cancelled', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(readKeepExport).mockImplementation((_files, _userId, options) => {
      signal = options?.signal;
      options?.onProgress?.(120, 480);
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(signal?.reason)),
      );
    });
    render(<KeepImport userId="user-1" notesSynced />);

    choose([takeout]);
    const bar = await screen.findByRole('progressbar', { name: 'Reading takeout.zip' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('120 of 480 files read')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import from Google Keep' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says what an export holds, and starts importing its new notes once confirmed', async () => {
    const found = exported({ trashed: 2, attachments: 1, labelled: 1 });
    vi.mocked(readKeepExport).mockResolvedValue(found);
    vi.mocked(hasNote).mockImplementation((id) => id === 'a');
    render(<KeepImport userId="user-1" notesSynced />);

    choose([takeout]);
    await screen.findByRole('heading', { name: 'Import 2 notes?' });
    const dialog = screen.getByRole('dialog');
    expect(readKeepExport).toHaveBeenCalledWith([takeout], 'user-1', expect.anything());
    expect(dialog).toHaveTextContent('1 note is already in Catch');
    expect(dialog).toHaveTextContent('2 notes in Keep’s trash stay behind');
    expect(dialog).toHaveTextContent('Images, drawings and recordings stay behind');
    expect(dialog).toHaveTextContent('Labels stay behind');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(startImport).toHaveBeenCalledWith('Google Keep', 'user-1', found.notes);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('imports nothing when cancelled at the confirmation', async () => {
    vi.mocked(readKeepExport).mockResolvedValue(exported());
    vi.mocked(hasNote).mockReturnValue(false);
    render(<KeepImport userId="user-1" notesSynced />);

    choose([takeout]);
    await screen.findByRole('heading', { name: 'Import 3 notes?' });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(startImport).not.toHaveBeenCalled();
  });

  it('starts no other import while one is running', () => {
    vi.mocked(useImport).mockReturnValue({
      source: 'Google Keep',
      total: 100,
      saved: 50,
      failed: 0,
      finished: false,
    });
    render(<KeepImport userId="user-1" notesSynced />);
    expect(screen.getByRole('button', { name: 'Import from Google Keep' })).toBeDisabled();
  });

  it('says so when every note is already here', async () => {
    vi.mocked(readKeepExport).mockResolvedValue(exported());
    vi.mocked(hasNote).mockReturnValue(true);
    render(<KeepImport userId="user-1" notesSynced />);

    choose([takeout]);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Nothing new to import', {
        description: 'Every note in this export is already in Catch.',
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('waits for the notes to sync', () => {
    render(<KeepImport userId="user-1" notesSynced={false} />);
    expect(screen.getByRole('button', { name: 'Import from Google Keep' })).toBeDisabled();
    expect(screen.getByText('Available once your notes have synced')).toBeInTheDocument();
  });

  it('explains files it cannot read', async () => {
    vi.mocked(readKeepExport).mockRejectedValue(new KeepImportError('Not a Keep export.'));
    render(<KeepImport userId="user-1" notesSynced />);

    choose([takeout]);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not import from Google Keep', {
        description: 'Not a Keep export.',
      }),
    );
    expect(screen.getByRole('button', { name: 'Import from Google Keep' })).toBeEnabled();
  });
});
