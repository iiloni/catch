import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EditorControls, FormattingState } from '@/components/NoteEditor/editorControls';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FormattingBar } from './FormattingBar';

function fakeControls(state: Partial<FormattingState> = {}): EditorControls {
  const full: FormattingState = {
    styles: { bold: false, italic: false, underline: false, strike: false },
    block: 'paragraph',
    canIndent: false,
    canOutdent: false,
    ...state,
  };
  return {
    getState: () => full,
    subscribe: () => () => {},
    toggleStyle: vi.fn(),
    toggleBlock: vi.fn(),
    indent: vi.fn(),
    outdent: vi.fn(),
    focusEnd: vi.fn(),
  };
}

describe('FormattingBar', () => {
  it('shows which styles and block type are active', () => {
    render(
      <TooltipProvider>
        <FormattingBar
          controls={fakeControls({
            styles: { bold: true, italic: false, underline: false, strike: false },
            block: 'checkListItem',
          })}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Checklist' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('formats through the controls', () => {
    const controls = fakeControls({ canIndent: true });
    render(
      <TooltipProvider>
        <FormattingBar controls={controls} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Numbered list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Indent' }));
    expect(controls.toggleStyle).toHaveBeenCalledWith('italic');
    expect(controls.toggleBlock).toHaveBeenCalledWith('numberedListItem');
    expect(controls.indent).toHaveBeenCalled();
  });

  it('disables indenting when the block cannot move', () => {
    render(
      <TooltipProvider>
        <FormattingBar controls={fakeControls()} />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Indent' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Outdent' })).toBeDisabled();
  });

  it('waits for the editor', () => {
    render(
      <TooltipProvider>
        <FormattingBar controls={null} />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
  });

  it('shows the label on touch hold without applying formatting', () => {
    vi.useFakeTimers();
    try {
      const controls = fakeControls();
      render(
        <TooltipProvider>
          <FormattingBar controls={controls} />
        </TooltipProvider>,
      );
      const bold = screen.getByRole('button', { name: 'Bold' });
      fireEvent.pointerDown(bold, { pointerType: 'touch', clientX: 30, clientY: 30 });
      act(() => vi.advanceTimersByTime(500));
      expect(screen.getByRole('tooltip')).toHaveTextContent('Bold');
      fireEvent.pointerUp(bold, { pointerType: 'touch' });
      fireEvent.click(bold, { detail: 1 });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(controls.toggleStyle).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the hold when the finger scrolls', () => {
    vi.useFakeTimers();
    try {
      const controls = fakeControls();
      render(
        <TooltipProvider>
          <FormattingBar controls={controls} />
        </TooltipProvider>,
      );
      const bold = screen.getByRole('button', { name: 'Bold' });
      fireEvent.pointerDown(bold, { pointerType: 'touch', clientX: 30, clientY: 30 });
      fireEvent.pointerMove(bold, { pointerType: 'touch', clientX: 50, clientY: 30 });
      act(() => vi.advanceTimersByTime(500));
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
