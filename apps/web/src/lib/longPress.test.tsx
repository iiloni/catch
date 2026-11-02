import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, LONG_PRESS_TOLERANCE, useLongPress } from './longPress';

function Card({ onHold, onMove }: { onHold: () => void; onMove?: () => void }) {
  return (
    <button type="button" {...useLongPress(onHold, onMove)}>
      Card
    </button>
  );
}

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no PointerEvent, so preserve the fields React reads from the gesture.
    vi.stubGlobal(
      'PointerEvent',
      class extends MouseEvent {
        pointerId = 1;
        pointerType = 'touch';
        isPrimary = true;
      },
    );
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('undoes only the selection made by the held press, even after its callback changes', () => {
    const onHold = vi.fn();
    const undoSelection = vi.fn();
    const view = render(<Card onHold={onHold} onMove={undoSelection} />);
    const card = view.getByRole('button');
    fireEvent.pointerDown(card, { clientX: 20, clientY: 20 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onHold).toHaveBeenCalledOnce();
    // Selection re-renders the card; the current gesture retains its original undo.
    view.rerender(<Card onHold={onHold} />);
    fireEvent.pointerMove(card, { clientX: 20 + LONG_PRESS_TOLERANCE, clientY: 20 });
    expect(undoSelection).not.toHaveBeenCalled();
    fireEvent.pointerMove(card, { clientX: 40, clientY: 20 });
    fireEvent.pointerMove(card, { clientX: 60, clientY: 20 });
    expect(undoSelection).toHaveBeenCalledOnce();
  });

  it('keeps selection after release, so a later press cannot undo it', () => {
    const onHold = vi.fn();
    const undoSelection = vi.fn();
    const view = render(<Card onHold={onHold} onMove={undoSelection} />);
    const card = view.getByRole('button');
    fireEvent.pointerDown(card);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.pointerUp(card);
    fireEvent.pointerMove(card, { clientX: 30 });
    view.rerender(<Card onHold={onHold} />);
    fireEvent.pointerDown(card);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.pointerMove(card, { clientX: 30 });
    expect(onHold).toHaveBeenCalledTimes(2);
    expect(undoSelection).not.toHaveBeenCalled();
  });

  it('does not select or undo when movement cancels the hold before it fires', () => {
    const onHold = vi.fn();
    const onMove = vi.fn();
    const view = render(<Card onHold={onHold} onMove={onMove} />);
    fireEvent.pointerDown(view.getByRole('button'));
    fireEvent.pointerMove(view.getByRole('button'), { clientX: 30 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onHold).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});
