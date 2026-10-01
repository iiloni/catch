import type { Attachment } from '@catch/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepAttachmentOffline, useAttachmentUrl } from '@/lib/attachmentFiles';
import { downloadAttachment } from '@/lib/attachments';
import { haptics } from '@/lib/haptics';
import { MediaViewer } from './MediaViewer';

vi.mock('@/lib/attachmentFiles', () => ({
  useAttachmentUrl: vi.fn(() => ({ source: 'blob:original', error: false })),
  keepAttachmentOffline: vi.fn(),
}));
vi.mock('@/lib/attachments', () => ({ downloadAttachment: vi.fn() }));
vi.mock('@/lib/haptics', () => ({ haptics: { toggle: vi.fn(), threshold: vi.fn() } }));

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
  it('waits for a late image decode before starting the content fade and keeps close available', async () => {
    const close = vi.fn();
    render(<MediaViewer file={file} onClose={close} />);
    const image = screen.getByRole('img');
    let finishDecode = () => {};
    const decoding = new Promise<void>((resolve) => {
      finishDecode = resolve;
    });
    Object.defineProperty(image, 'decode', { value: vi.fn(() => decoding) });
    loadedStage();
    const content = document.querySelector('[data-media-viewer-content]');
    expect(content).toHaveStyle({ opacity: '0' });
    expect(screen.getByRole('button', { name: 'Close media viewer' })).toBeInTheDocument();
    await act(async () => finishDecode());
    await waitFor(() => expect(content).toHaveStyle({ opacity: '1' }));
  });

  it('shows the original image in an accessible dialog and closes it', () => {
    const close = vi.fn();
    render(<MediaViewer file={file} onClose={close} />);
    expect(useAttachmentUrl).toHaveBeenCalledWith(`attachment:${file.id}`);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('photo.png');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:original');
    fireEvent.click(screen.getByRole('button', { name: 'Close media viewer' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(['image', 'controls'])(
    'closes on right-clicking %s and suppresses the context menu',
    (target) => {
      const close = vi.fn();
      render(<MediaViewer file={file} onClose={close} />);
      const node =
        target === 'image'
          ? screen.getByRole('img')
          : screen.getByRole('button', { name: 'Reset zoom' });
      expect(fireEvent.contextMenu(node)).toBe(false);
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it.each(['audio', 'video'] as const)(
    'reveals %s controls without waiting for media data',
    async (kind) => {
      const { container } = render(<MediaViewer file={{ ...file, kind }} onClose={vi.fn()} />);
      expect(container.ownerDocument.querySelector(kind)).toHaveAttribute('controls');
      await waitFor(() =>
        expect(document.querySelector('[data-media-viewer-content]')).toHaveStyle({ opacity: '1' }),
      );
      expect(screen.queryByText('Loading preview…')).not.toBeInTheDocument();
    },
  );

  it('shows an unavailable preview without blocking download', () => {
    render(<MediaViewer file={file} onClose={vi.fn()} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('status')).toHaveTextContent('Preview unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Download attachment' }));
    expect(downloadAttachment).toHaveBeenCalledWith(file);
  });

  it.each(['video', 'audio'] as const)(
    'restores the %s source after Strict Mode ref cleanup',
    (kind) => {
      render(
        <StrictMode>
          <MediaViewer file={{ ...file, kind }} onClose={vi.fn()} />
        </StrictMode>,
      );
      expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
      expect(document.querySelector(kind)).toHaveAttribute('src', 'blob:original');
    },
  );

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

  it('keeps narrow-screen metadata hidden until requested and out of the focus order', async () => {
    vi.stubGlobal('innerWidth', 380);
    render(<MediaViewer file={file} onClose={vi.fn()} />);
    const info = screen.getByRole('button', { name: 'Attachment details' });
    const sheet = document.querySelector('[data-media-details]');
    expect(sheet).toHaveAttribute('inert');
    expect(info).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Keep offline' })).not.toBeInTheDocument();
    fireEvent.click(info);
    expect(info).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Keep offline' }));
    expect(keepAttachmentOffline).toHaveBeenCalledWith(file.id);
    fireEvent.click(info);
    await waitFor(() => expect(sheet).toHaveAttribute('inert'));
    expect(haptics.toggle).toHaveBeenCalledTimes(2);
  });

  it('interpolates a details drag, haptics at the threshold, and restores on cancellation', async () => {
    vi.stubGlobal('innerWidth', 380);
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(600);
    render(<MediaViewer file={file} onClose={vi.fn()} />);
    const info = screen.getByRole('button', { name: 'Attachment details' });
    const sheet = document.querySelector<HTMLElement>('[data-media-details]');
    if (!sheet) throw new Error('Missing details sheet');
    info.setPointerCapture = vi.fn();
    sheet.setPointerCapture = vi.fn();
    fireEvent.pointerDown(info, { pointerId: 1, button: 0, clientY: 720 });
    fireEvent.pointerMove(info, { pointerId: 1, clientY: 610 });
    expect(info).toHaveAttribute('aria-expanded', 'false');
    expect(sheet).not.toHaveAttribute('inert');
    expect(haptics.threshold).toHaveBeenCalledOnce();
    await waitFor(() => expect(sheet.style.transform).toContain('74px'));
    fireEvent.pointerUp(info, { pointerId: 1, clientY: 610 });
    expect(info).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(sheet.style.transform).toBe('none'));
    fireEvent.pointerDown(sheet, { pointerId: 2, button: 0, clientY: 580 });
    fireEvent.pointerMove(sheet, { pointerId: 2, clientY: 690 });
    expect(haptics.threshold).toHaveBeenCalledTimes(2);
    fireEvent.pointerCancel(sheet, { pointerId: 2, clientY: 690 });
    expect(info).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(sheet.style.transform).toBe('none'));
    fireEvent.pointerDown(sheet, { pointerId: 3, button: 0, clientY: 580 });
    fireEvent.pointerMove(sheet, { pointerId: 3, clientY: 690 });
    fireEvent.pointerUp(sheet, { pointerId: 3, clientY: 690 });
    expect(info).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(sheet).toHaveAttribute('inert'));
  });

  it('opens and dismisses details by dragging the fitted image, while zoomed drags pan', async () => {
    vi.stubGlobal('innerWidth', 380);
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(600);
    render(<MediaViewer file={file} onClose={vi.fn()} />);
    const { stage, image } = loadedStage();
    const info = screen.getByRole('button', { name: 'Attachment details' });
    const sheet = document.querySelector('[data-media-details]');
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 320, clientY: 300 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 320, clientY: 190 });
    expect(sheet).not.toHaveAttribute('inert');
    expect(info).toHaveAttribute('aria-expanded', 'false');
    expect(haptics.threshold).toHaveBeenCalledOnce();
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 320, clientY: 190 });
    expect(info).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%');
    await waitFor(() => expect(sheet).toHaveStyle({ transform: 'none' }));
    fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 320, clientY: 190 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 320, clientY: 300 });
    expect(info).toHaveAttribute('aria-expanded', 'true');
    expect(haptics.threshold).toHaveBeenCalledTimes(2);
    fireEvent.pointerCancel(stage, { pointerId: 2, clientX: 320, clientY: 300 });
    await waitFor(() => expect(sheet).toHaveStyle({ transform: 'none' }));
    expect(info).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(stage, { pointerId: 3, button: 0, clientX: 320, clientY: 190 });
    fireEvent.pointerMove(stage, { pointerId: 3, clientX: 320, clientY: 300 });
    fireEvent.pointerUp(stage, { pointerId: 3, clientX: 320, clientY: 300 });
    expect(info).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(sheet).toHaveAttribute('inert'));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 320, clientY: 300 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 320, clientY: 190 });
    fireEvent.pointerUp(stage, { pointerId: 2, clientX: 320, clientY: 190 });
    expect(image.style.transform).not.toContain('translate(0px, 0px)');
    expect(info).toHaveAttribute('aria-expanded', 'false');
    expect(sheet).toHaveAttribute('inert');
  });

  it.each(['cancel', 'pinch'])('cancels an image details drag on %s', async (action) => {
    vi.stubGlobal('innerWidth', 380);
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(600);
    render(<MediaViewer file={file} onClose={vi.fn()} />);
    const { stage } = loadedStage();
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 320, clientY: 300 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 320, clientY: 190 });
    if (action === 'pinch') {
      fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 400, clientY: 240 });
      fireEvent.pointerUp(stage, { pointerId: 2, clientX: 400, clientY: 240 });
      fireEvent.pointerUp(stage, { pointerId: 1, clientX: 320, clientY: 190 });
    } else fireEvent.pointerCancel(stage, { pointerId: 1, clientX: 320, clientY: 190 });
    expect(screen.getByRole('button', { name: 'Attachment details' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await waitFor(() =>
      expect(document.querySelector('[data-media-details]')).toHaveAttribute('inert'),
    );
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
