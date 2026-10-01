import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EditorControls, FormattingState } from '@/components/NoteEditor/editorControls';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HistoryToolbar } from './HistoryToolbar';

describe('HistoryToolbar', () => {
  it('appears on the first edit and follows the undo and redo availability', () => {
    let state: FormattingState = {
      attachmentIds: [],
      styles: { bold: false, italic: false, underline: false, strike: false },
      block: 'paragraph',
      canIndent: false,
      canOutdent: false,
      canUndo: false,
      canRedo: false,
    };
    const listeners = new Set<() => void>();
    const controls: EditorControls = {
      getContent: () => [],
      attachmentInserter: vi.fn(() => vi.fn()),
      removeAttachment: vi.fn(),
      showAttachment: vi.fn(),
      getState: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      toggleStyle: vi.fn(),
      toggleBlock: vi.fn(),
      insertSlash: vi.fn(),
      indent: vi.fn(),
      outdent: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      focusEnd: vi.fn(),
    };
    function history(canUndo: boolean, canRedo: boolean) {
      act(() => {
        state = { ...state, canUndo, canRedo };
        for (const listener of listeners) listener();
      });
    }
    render(
      <TooltipProvider>
        <HistoryToolbar controls={controls} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    history(true, false);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    fireEvent(undo, pointer);
    expect(pointer.defaultPrevented).toBe(true);
    fireEvent.click(undo);
    expect(controls.undo).toHaveBeenCalledOnce();

    history(false, true);
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();
    fireEvent.click(redo);
    expect(controls.redo).toHaveBeenCalledOnce();
  });
});
