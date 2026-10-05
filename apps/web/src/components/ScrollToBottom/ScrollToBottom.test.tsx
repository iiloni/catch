import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { editorScrollToBottom } from '@/lib/dockState';
import { ScrollToBottom } from './ScrollToBottom';

describe('ScrollToBottom', () => {
  afterEach(() => {
    act(() => editorScrollToBottom.set(null));
  });

  it('appears while the note offers a jump and keeps the editor focused', () => {
    render(
      <TooltipProvider>
        <ScrollToBottom />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument();

    const jump = vi.fn();
    act(() => editorScrollToBottom.set(jump));
    const button = screen.getByRole('button', { name: 'Scroll to bottom' });
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    fireEvent(button, pointer);
    expect(pointer.defaultPrevented).toBe(true);
    fireEvent.click(button);
    expect(jump).toHaveBeenCalledOnce();
  });
});
