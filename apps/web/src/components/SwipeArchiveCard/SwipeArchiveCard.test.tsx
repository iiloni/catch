import type { Note } from '@catch/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { haptics } from '@/lib/haptics';
import { SwipeArchiveCard } from './SwipeArchiveCard';

// Cards read link previews; these notes have no links, so no sync is needed.
vi.mock('@/lib/collections', () => ({ useLinkPreviews: () => new Map() }));

vi.mock('@/lib/haptics', () => ({
  haptics: { threshold: vi.fn(), success: vi.fn() },
}));

afterEach(() => vi.clearAllMocks());

const note: Note = {
  id: '0199a0a0-0000-7000-8000-000000000001',
  userId: 'user-1',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Groceries' }] }],
  color: 'default',
  status: null,
  isPinned: false,
  isArchived: false,
  position: 'a0',
  hiddenLinks: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function renderCard() {
  const onOpen = vi.fn();
  const onArchive = vi.fn();
  const view = render(
    <TooltipProvider>
      <SwipeArchiveCard note={note} onOpen={onOpen} onArchive={onArchive} />
    </TooltipProvider>,
  );
  const card = view.container.querySelector('[class*="touch-pan-y"]');
  if (!(card instanceof HTMLElement)) throw new Error('Swipe surface missing');
  return { card, onOpen, onArchive };
}

function swipe(card: HTMLElement, endX: number, endY = 0) {
  const pointer = { pointerId: 1, pointerType: 'touch' };
  const open = screen.getByRole('button', { name: 'Open note' });
  fireEvent.pointerDown(open, { ...pointer, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(card, { ...pointer, clientX: endX, clientY: endY });
  fireEvent.pointerUp(card, { ...pointer, clientX: endX, clientY: endY });
  fireEvent.click(open);
}

describe('SwipeArchiveCard', () => {
  it('opens on a tap', () => {
    const { onOpen, onArchive } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Open note' }));
    expect(onOpen).toHaveBeenCalledWith(note, expect.any(HTMLElement));
    expect(onArchive).not.toHaveBeenCalled();
  });

  it.each([80, -80])('archives on a %s px sideways touch without opening', async (distance) => {
    const { card, onOpen, onArchive } = renderCard();
    swipe(card, distance);
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith(note));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not archive or open a short sideways drag', () => {
    const { card, onOpen, onArchive } = renderCard();
    swipe(card, 30);
    expect(onArchive).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ticks when crossing the midpoint, including after pulling back', () => {
    const { card, onArchive } = renderCard();
    const pointer = { pointerId: 1, pointerType: 'touch', clientY: 0 };
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open note' }), {
      ...pointer,
      clientX: 0,
    });
    fireEvent.pointerMove(card, { ...pointer, clientX: 47 });
    expect(haptics.threshold).not.toHaveBeenCalled();
    fireEvent.pointerMove(card, { ...pointer, clientX: 48 });
    fireEvent.pointerMove(card, { ...pointer, clientX: 200 });
    expect(haptics.threshold).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(card, { ...pointer, clientX: 40 });
    fireEvent.pointerMove(card, { ...pointer, clientX: 50 });
    expect(haptics.threshold).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(card, { ...pointer, clientX: 40 });
    expect(onArchive).not.toHaveBeenCalled();
  });

  it('leaves vertical scrolling alone', () => {
    const { card, onArchive } = renderCard();
    swipe(card, 80, 100);
    expect(onArchive).not.toHaveBeenCalled();
  });
});
