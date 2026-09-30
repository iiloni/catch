import type { Attachment } from '@catch/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepAttachmentOffline, useAttachmentUrl } from '@/lib/attachmentFiles';
import { downloadAttachment } from '@/lib/attachments';
import { MediaViewer } from './MediaViewer';

vi.mock('@/lib/attachmentFiles', () => ({
  useAttachmentUrl: vi.fn(() => ({ source: 'blob:original', error: false })),
  keepAttachmentOffline: vi.fn(),
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

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function loadedStage() {
  const image = screen.getByRole('img');
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 1000 } });
  fireEvent.load(image);
  const stage = image.parentElement;
  if (!stage) throw new Error('Missing image stage');
  stage.setPointerCapture = vi.fn();
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 640,
    bottom: 480,
    width: 640,
    height: 480,
    toJSON() {},
  });
  return { image, stage };
}

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

  it('zooms by wheel, resets by keyboard, and pans without navigating while zoomed', () => {
    const next = { ...file, id: 'next', name: 'next.png' };
    render(<MediaViewer file={file} files={[file, next]} onClose={vi.fn()} />);
    const { image, stage } = loadedStage();
    fireEvent.wheel(stage, { deltaY: -200, clientX: 320, clientY: 240 });
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('149%');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(image.style.transform).not.toContain('translate(0px, 0px)');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('photo.png');
    fireEvent.keyDown(window, { key: '0' });
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('next.png');
  });

  it('pinches to zoom and does not turn the pinch into a swipe', () => {
    render(
      <MediaViewer
        file={file}
        files={[file, { ...file, id: 'next', name: 'next.png' }]}
        onClose={vi.fn()}
      />,
    );
    const { stage } = loadedStage();
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 260, clientY: 240 });
    fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 380, clientY: 240 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 200, clientY: 240 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 440, clientY: 240 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 200, clientY: 240 });
    fireEvent.pointerUp(stage, { pointerId: 2, clientX: 440, clientY: 240 });
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('200%');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('photo.png');
  });

  it('navigates an unzoomed swipe and resets the next image', () => {
    render(
      <MediaViewer
        file={file}
        files={[file, { ...file, id: 'next', name: 'next.png' }]}
        onClose={vi.fn()}
      />,
    );
    const { stage } = loadedStage();
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 400, clientY: 240 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 250, clientY: 240 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 250, clientY: 240 });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('next.png');
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%');
  });

  it('provides offline storage from the metadata card', () => {
    render(<MediaViewer file={file} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep offline' }));
    expect(keepAttachmentOffline).toHaveBeenCalledWith(file.id);
  });

  it('stops playback and releases the source when navigating away from a recording', () => {
    render(
      <MediaViewer
        file={{ ...file, kind: 'audio' }}
        files={[
          { ...file, kind: 'audio' },
          { ...file, id: 'next' },
        ]}
        onClose={vi.fn()}
      />,
    );
    const audio = document.querySelector('audio');
    fireEvent.click(screen.getByRole('button', { name: 'Next attachment' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledOnce();
    expect(audio).not.toHaveAttribute('src');
  });
});
