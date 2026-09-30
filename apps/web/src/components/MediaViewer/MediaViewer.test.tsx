import type { Attachment } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAttachmentUrl } from '@/lib/attachmentFiles';
import { downloadAttachment } from '@/lib/attachments';
import { MediaViewer } from './MediaViewer';

vi.mock('@/lib/attachmentFiles', () => ({
  useAttachmentUrl: vi.fn(() => ({ source: 'blob:original', error: false })),
}));
vi.mock('@/lib/attachments', () => ({ downloadAttachment: vi.fn() }));

const file: Attachment = {
  id: '0199a0a0-0000-7000-8000-000000000001',
  noteId: '0199a0a0-0000-7000-8000-000000000002',
  userId: 'user',
  name: 'photo.png',
  mimeType: 'image/png',
  size: 123,
  kind: 'image',
  status: 'ready',
  sourceId: null,
  createdAt: new Date(),
  deletedAt: null,
};

afterEach(() => vi.clearAllMocks());

describe('MediaViewer', () => {
  it('shows the original image in an accessible dialog and closes it', () => {
    const close = vi.fn();
    render(<MediaViewer file={file} onClose={close} />);
    expect(useAttachmentUrl).toHaveBeenCalledWith(`attachment:${file.id}`);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('photo.png');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:original');
    fireEvent.click(screen.getByRole('button', { name: 'Close media viewer' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(['audio', 'video'] as const)('offers playback controls for %s', (kind) => {
    const { container } = render(<MediaViewer file={{ ...file, kind }} onClose={vi.fn()} />);
    expect(container.ownerDocument.querySelector(kind)).toHaveAttribute('controls');
  });

  it('shows an unavailable preview without blocking download', () => {
    render(<MediaViewer file={file} onClose={vi.fn()} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('status')).toHaveTextContent('Preview unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Download attachment' }));
    expect(downloadAttachment).toHaveBeenCalledWith(file);
  });
});
