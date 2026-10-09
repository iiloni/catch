import type { LinkIntake } from '@catch/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { LinkCaptureForm } from './LinkCapture';

const mocks = vi.hoisted(() => ({
  intake: vi.fn(),
  create: vi.fn((_input: unknown) => ({ id: 'note-1', transaction: { id: 'write-1' } })),
  update: vi.fn(() => ({ id: 'write-2' })),
  has: vi.fn(() => false),
  stored: vi.fn(async () => {}),
  load: vi.fn(async () => {}),
}));
vi.mock('@/lib/api', () => ({
  api: { linkIntake: mocks.intake },
  ApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
vi.mock('@/lib/collections', () => ({
  useCaptureNotes: () => [],
  useBoardColumns: () => [{ id: 'in_progress', name: 'In progress', position: 'a0' }],
  useTags: () => [{ id: 'tag-1', name: 'Later', parentId: null, color: null }],
  useTagReadiness: () => ({ awaitingTags: false }),
  boardColumnsCollection: new Map([['in_progress', {}]]),
  tagsCollection: new Map([['tag-1', { id: 'tag-1', name: 'Later', parentId: null, color: null }]]),
  loadShareCollections: mocks.load,
  waitForWriteStored: mocks.stored,
}));
vi.mock('@/lib/notes', () => ({
  createNote: mocks.create,
  updateNote: mocks.update,
  hasNote: mocks.has,
}));
vi.mock('@/lib/linkPreviews', () => ({
  assetUrl: (hash: string) => `/api/link-previews/assets/${hash}`,
}));
vi.mock('@/lib/openNote', () => ({ useOpenNote: () => ({ open: vi.fn() }) }));
vi.mock('@/lib/haptics', () => ({ haptics: { success: vi.fn(), selection: vi.fn() } }));
vi.mock('@/components/ColorPicker/ColorPicker', () => ({
  COLOR_NAMES: { default: 'No color', blue: 'Blue' },
  ColorTagSelector: ({ onChange }: { onChange: (color: 'blue') => void }) => (
    <button type="button" onClick={() => onChange('blue')}>
      Blue
    </button>
  ),
}));
vi.mock('@/lib/receiveShare', () => ({ dismissLinkShare: vi.fn(), saveLinkShare: vi.fn() }));

const metadata: LinkIntake = {
  title: 'Fetched title',
  description: 'Fetched description',
  siteName: 'Example',
  imageHash: null,
  imageWidth: null,
  imageHeight: null,
  iconHash: null,
  hue: null,
};
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  mocks.intake.mockReset().mockResolvedValue(metadata);
  mocks.stored.mockReset().mockResolvedValue(undefined);
  mocks.has.mockReturnValue(false);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
});

function mount(autoFetch = false) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  render(
    <LinkCaptureForm
      initial={{ url: 'https://example.com/', title: 'Browser title', notes: 'Selection' }}
      autoFetch={autoFetch}
      onSaved={onSaved}
      onCancel={onCancel}
      onOpenNote={vi.fn()}
    />,
  );
  return { onSaved, onCancel };
}

describe('LinkCaptureForm', () => {
  it('saves the destination, color and tags selected in the dialog', async () => {
    mount(true);
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Save to Gallery' }));
    fireEvent.click(screen.getByRole('button', { name: 'In progress' }));
    fireEvent.click(screen.getByRole('button', { name: 'Background color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose tags' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Later' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'in_progress',
          color: 'blue',
          secondaryTagIds: ['tag-1'],
        }),
      ),
    );
  });
  it('starts each capture in Gallery with no color or tags', async () => {
    mount(true);
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: null,
          galleryPreviewUrl: 'https://example.com/',
          color: 'default',
          primaryTagId: null,
          secondaryTagIds: [],
        }),
      ),
    );
  });
  it('keeps only the URL until the current fetch completes, and hides details for a changed URL', async () => {
    let finish!: (value: LinkIntake) => void;
    mocks.intake.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Your notes')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Link placement' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch details' }));
    expect(screen.getByRole('status')).toHaveTextContent('Fetching page details');
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Link placement' })).not.toBeInTheDocument();
    await act(async () => finish(metadata));
    expect(screen.getByLabelText('Title')).toHaveValue('Fetched title');
    expect(screen.getByLabelText('Your notes')).toHaveValue('Selection');
    expect(screen.getByRole('button', { name: 'Save to Gallery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Background color' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose tags' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'invalid' } });
    await waitFor(() => expect(screen.queryByLabelText('Title')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Your notes')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Link placement' })).not.toBeInTheDocument();
  });

  it('keeps the close icon while cancellation is pending', async () => {
    let finish!: () => void;
    render(
      <LinkCaptureForm
        onSaved={vi.fn()}
        onOpenNote={vi.fn()}
        onCancel={() =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
        }
      />,
    );
    const close = screen.getByRole('button', { name: 'Close link capture' });
    fireEvent.click(close);
    expect(close).toBeDisabled();
    expect(close.querySelector('.lucide-x')).not.toBeNull();
    expect(close.querySelector('.lucide-loader-circle')).toBeNull();
    await act(async () => finish());
  });

  it('fetches a pasted URL immediately and preserves manually edited fields', async () => {
    mount(true);
    await screen.findByDisplayValue('Fetched title');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My title' } });
    const input = screen.getByLabelText('URL') as HTMLInputElement;
    input.setSelectionRange(0, input.value.length);
    fireEvent.paste(input, { clipboardData: { getData: () => 'https://other.example/page' } });
    await waitFor(() =>
      expect(mocks.intake).toHaveBeenCalledWith(
        { url: 'https://other.example/page' },
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Description')).toHaveValue('Fetched description'),
    );
    expect(input).toHaveValue('https://other.example/page');
    expect(screen.getByLabelText('Title')).toHaveValue('My title');
    expect(screen.getByLabelText('Your notes')).toHaveValue('Selection');
  });

  it('shows close instead of save for an unsupported pasted URL without fetching', () => {
    mount();
    const input = screen.getByLabelText('URL') as HTMLInputElement;
    input.setSelectionRange(0, input.value.length);
    fireEvent.paste(input, { clipboardData: { getData: () => 'javascript:alert(1)' } });
    expect(mocks.intake).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close link capture' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Save link' })).not.toBeInTheDocument();
  });
  it('hands an incoming capture to its durable share saver rather than generating another note', async () => {
    let complete!: (id: string) => void;
    const saveDraft = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    const onSaved = vi.fn();
    render(
      <LinkCaptureForm
        initial={{ url: 'https://example.com/', title: 'Shared title' }}
        autoFetch
        saveDraft={saveDraft}
        onSaved={onSaved}
        onCancel={vi.fn()}
        onOpenNote={vi.fn()}
      />,
    );
    await screen.findByDisplayValue('Fetched title');
    fireEvent.change(screen.getByLabelText('Your notes'), { target: { value: 'My context' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    expect(saveDraft).toHaveBeenCalledWith(
      {
        url: 'https://example.com/',
        title: 'Fetched title',
        description: 'Fetched description',
        notes: 'My context',
      },
      { status: null, color: 'default', primaryTagId: null, secondaryTagIds: [] },
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save link' })).toBeDisabled();
    await act(async () => complete('share-id'));
    expect(onSaved).toHaveBeenCalledWith('share-id');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('retains the form if recording cancellation fails', async () => {
    render(
      <LinkCaptureForm
        initial={{ url: '' }}
        onSaved={vi.fn()}
        onCancel={async () => {
          throw new Error('Inbox storage unavailable');
        }}
        onOpenNote={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close link capture' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Inbox storage unavailable'),
    );
    expect(screen.getByRole('button', { name: 'Close link capture' })).toBeEnabled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('fetches details automatically for a bookmarklet capture without creating a note', async () => {
    mount(true);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Fetched title'));
    expect(screen.getByLabelText('Description')).toHaveValue('Fetched description');
    expect(screen.getByLabelText('Your notes')).toHaveValue('Selection');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('preserves manual edits made before and during a fetch', async () => {
    let finish!: (value: LinkIntake) => void;
    mount(true);
    await screen.findByDisplayValue('Fetched title');
    mocks.intake.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch details' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'My description' } });
    await act(async () => finish(metadata));
    expect(screen.getByLabelText('Title')).toHaveValue('My title');
    expect(screen.getByLabelText('Description')).toHaveValue('My description');
  });
  it('ignores an old response after the URL changes', async () => {
    let finish!: (value: LinkIntake) => void;
    mocks.intake.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount(true);
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://other.example/' } });
    await act(async () => finish(metadata));
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    expect(screen.queryByText('Page details fetched')).not.toBeInTheDocument();
  });
  it('allows manual save when the optional endpoint is absent on an older server', async () => {
    mocks.intake.mockRejectedValueOnce(new ApiError(404, 'Not found'));
    const { onSaved } = mount(true);
    await screen.findByText(/Update your Catch server/);
    expect(screen.getByRole('button', { name: 'Save to Gallery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Background color' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose tags' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('note-1'));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', content: expect.any(Array) }),
    );
  });
  it('waits for durable admission before confirming and reuses the note on retry', async () => {
    let fail!: (error: Error) => void;
    mocks.stored.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const { onSaved } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    await waitFor(() => expect(mocks.stored).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save link' })).toBeDisabled();
    await act(async () => fail(new Error('Could not store this note')));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not store this note');
    mocks.has.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('note-1'));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(
      'note-1',
      expect.objectContaining({ content: expect.any(Array) }),
    );
  });
  it('does not save on cancel or allow unsupported URL schemes', () => {
    const { onCancel } = mount();
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'javascript:alert(1)' } });
    expect(screen.queryByRole('button', { name: 'Save link' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fetch details' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close link capture' }));
    expect(onCancel).toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
