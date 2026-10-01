import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EditorControls, FormattingState } from '@/components/NoteEditor/editorControls';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FormattingBar } from './FormattingBar';

function fakeControls(state: Partial<FormattingState> = {}): EditorControls {
  const full: FormattingState = {
    attachmentIds: [],
    styles: { bold: false, italic: false, underline: false, strike: false },
    block: 'paragraph',
    canIndent: false,
    canOutdent: false,
    canUndo: false,
    canRedo: false,
    ...state,
  };
  return {
    getState: () => full,
    getContent: () => [],
    attachmentInserter: vi.fn(() => vi.fn()),
    removeAttachment: vi.fn(),
    showAttachment: vi.fn(),
    subscribe: () => () => {},
    toggleStyle: vi.fn(),
    toggleBlock: vi.fn(),
    insertSlash: vi.fn(),
    indent: vi.fn(),
    outdent: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    focusEnd: vi.fn(),
  };
}

describe('FormattingBar', () => {
  it('opens the attachment panel without opening the slash menu', () => {
    const controls = fakeControls();
    const onAttachments = vi.fn();
    render(
      <TooltipProvider>
        <FormattingBar controls={controls} onAttachments={onAttachments} attachmentsOpen />
      </TooltipProvider>,
    );
    const attach = screen.getByRole('button', { name: 'Attach files' });
    expect(attach).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(attach);
    expect(onAttachments).toHaveBeenCalledOnce();
    expect(controls.insertSlash).not.toHaveBeenCalled();
  });

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
    fireEvent.click(screen.getByRole('button', { name: 'Slash menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Numbered list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Indent' }));
    expect(controls.toggleStyle).toHaveBeenCalledWith('italic');
    expect(controls.insertSlash).toHaveBeenCalledOnce();
    expect(controls.toggleBlock).toHaveBeenCalledWith('numberedListItem');
    expect(controls.indent).toHaveBeenCalled();
  });

  it('shows the slash button first', () => {
    render(
      <TooltipProvider>
        <FormattingBar controls={fakeControls()} />
      </TooltipProvider>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName('Slash menu');
    expect(buttons[0]).toHaveTextContent('/');
    expect(buttons[1]).toHaveAccessibleName('Attach files');
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
