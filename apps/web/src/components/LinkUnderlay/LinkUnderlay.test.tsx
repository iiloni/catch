import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedLink } from '@/lib/linkPreviews';
import { makePreview } from '@/test/links';
import { LinkUnderlay } from './LinkUnderlay';

const resolved = (url: string, title?: string): ResolvedLink => ({
  url,
  href: url,
  preview: title ? makePreview(url, { title }) : undefined,
});

describe('LinkUnderlay', () => {
  it('names the first link and counts the rest', () => {
    const onOpen = vi.fn();
    render(
      <LinkUnderlay
        variant="card"
        color="blue"
        links={[resolved('https://a.example/', 'First'), resolved('https://b.example/')]}
        onOpen={onOpen}
      />,
    );
    const underlay = screen.getByRole('button', { name: '2 links, first First' });
    expect(underlay).toHaveTextContent('First');
    expect(underlay).toHaveTextContent('+1');
    expect(underlay).toHaveAttribute('data-note-color', 'blue');
    fireEvent.click(underlay);
    expect(onOpen).toHaveBeenCalled();
  });

  it('shows no count for a single link and nothing without links', () => {
    const { rerender } = render(
      <LinkUnderlay variant="dock" links={[resolved('https://a.example/')]} onOpen={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Link: a.example' })).not.toHaveTextContent('+');
    rerender(<LinkUnderlay variant="dock" links={[]} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
