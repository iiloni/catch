import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedLink } from '@/lib/linkPreviews';
import { hideLinkPreview } from '@/lib/notes';
import { makePreview } from '@/test/links';
import { LinkNoteFace, LinkPreviewCard } from './LinkPreviewCard';

vi.mock('@/lib/notes');
vi.mock('@/lib/api');

const url = 'https://www.theverge.com/tech';
const ready: ResolvedLink = {
  url,
  href: url,
  preview: makePreview(url, {
    title: 'Tech news',
    siteName: 'The Verge',
    hue: 283,
    iconHash: 'a'.repeat(64),
  }),
};

function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Link options' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}

describe('LinkPreviewCard', () => {
  it('links to the page and shows its title, site and color', () => {
    render(<LinkPreviewCard link={ready} noteId="n1" />);
    const anchor = screen.getByRole('link');
    expect(anchor).toHaveAttribute('href', url);
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByText('Tech news')).toBeInTheDocument();
    expect(screen.getByText('The Verge')).toBeInTheDocument();
    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('data-link-hue', '283');
    expect(card.style.getPropertyValue('--link-hue')).toBe('283');
  });

  it('shows where the link points before the server has a preview', () => {
    render(<LinkPreviewCard link={{ url, href: url, preview: undefined }} noteId="n1" />);
    expect(screen.getByText('theverge.com/tech')).toBeInTheDocument();
    expect(screen.getByRole('article')).not.toHaveAttribute('data-link-hue');
  });

  it('removes the preview from the note', async () => {
    render(<LinkPreviewCard link={ready} noteId="n1" />);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove preview' }));
    expect(hideLinkPreview).toHaveBeenCalledWith('n1', url);
  });

  it('offers only harmless actions for notes in the trash', async () => {
    render(<LinkPreviewCard link={ready} noteId="n1" readOnly />);
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remove preview' })).not.toBeInTheDocument();
  });
});

describe('LinkNoteFace', () => {
  it('shows the image and title, tinted only when asked', () => {
    const link = { ...ready, preview: { ...ready.preview!, imageHash: 'b'.repeat(64) } };
    const { container, rerender } = render(<LinkNoteFace link={link} tinted />);
    expect(screen.getByRole('heading', { name: 'Tech news' })).toBeInTheDocument();
    expect(container.querySelector('img[src*="bbbb"]')).not.toBeNull();
    expect(container.firstElementChild).toHaveAttribute('data-link-tint');
    rerender(<LinkNoteFace link={link} tinted={false} />);
    expect(container.firstElementChild).not.toHaveAttribute('data-link-tint');
  });
});
