import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAttachmentUrl } from '@/lib/attachmentFiles';
import { MediaPreview } from './MediaPreview';

vi.mock('@/lib/attachmentFiles', () => ({
  useAttachmentUrl: vi.fn(() => ({ source: 'blob:poster', error: false })),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const url = 'attachment:0199a0a0-0000-7000-8000-000000000001';

describe('video previews', () => {
  it.each(['thumbnail', 'compact'] as const)(
    'uses a poster for %s and falls back on failure',
    (mode) => {
      render(<MediaPreview url={url} name="video.mp4" kind="video" {...{ [mode]: true }} />);
      expect(useAttachmentUrl).toHaveBeenCalledWith(url, true);
      expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:poster');
      fireEvent.error(screen.getByRole('img'));
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(document.querySelector('video')).toBeNull();
    },
  );

  it('uses the original video for an inline player', () => {
    render(<MediaPreview url={url} name="video.mp4" kind="video" />);
    expect(useAttachmentUrl).toHaveBeenCalledWith(url, false);
    expect(document.querySelector('video')).toHaveAttribute('controls');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

it('reserves a previously displayed image while its source resolves on a new mount', () => {
  render(<MediaPreview url={url} name="photo.png" kind="image" />);
  const image = screen.getByRole('img');
  Object.defineProperties(image, {
    naturalWidth: { value: 800 },
    naturalHeight: { value: 600 },
  });
  fireEvent.load(image);
  cleanup();

  vi.mocked(useAttachmentUrl).mockReturnValueOnce({ source: null, error: false });
  const { container } = render(
    <MediaPreview url={url} name="photo.png" kind="image" editorImage />,
  );
  expect(container.firstChild).toHaveStyle({ aspectRatio: '800 / 600' });
});
