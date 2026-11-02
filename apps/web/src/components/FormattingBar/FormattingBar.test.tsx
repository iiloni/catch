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
    focus: vi.fn(),
    focusEnd: vi.fn(),
  };
}

describe('FormattingBar', () => {
  it('places link capture immediately after attachments in the quick-note toolbar', () => {
    const onLink = vi.fn();
    render(
      <TooltipProvider>
        <FormattingBar controls={fakeControls()} onLink={onLink} />
      </TooltipProvider>,
    );
    const buttons = screen.getAllByRole('button');
    const attach = buttons.indexOf(screen.getByRole('button', { name: 'Attach files' }));
    expect(buttons[attach + 1]).toHaveAttribute('aria-label', 'Save link');
    fireEvent.click(buttons[attach + 1]!);
    expect(onLink).toHaveBeenCalledOnce();
  });
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

  it('waits for the editor to format, but not to attach a file or save a link', () => {
    const onAttachments = vi.fn();
    const onLink = vi.fn();
    render(
      <TooltipProvider>
        <FormattingBar controls={null} onAttachments={onAttachments} onLink={onLink} />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    expect(onAttachments).toHaveBeenCalledOnce();
    expect(onLink).toHaveBeenCalledOnce();
  });

  describe('scrolling', () => {
    function renderOverflowing({ scrollLeft = 0, clientWidth = 300, scrollWidth = 500 } = {}) {
      render(
        <TooltipProvider>
          <FormattingBar controls={fakeControls()} />
        </TooltipProvider>,
      );
      const row = screen.getByRole('toolbar', { name: 'Formatting' });
      Object.defineProperty(row, 'clientWidth', { configurable: true, value: clientWidth });
      Object.defineProperty(row, 'scrollWidth', { configurable: true, value: scrollWidth });
      row.scrollLeft = scrollLeft;
      fireEvent.scroll(row);
      return row;
    }
    const wheel = (row: HTMLElement, init: WheelEventInit) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
      row.dispatchEvent(event);
      return event;
    };

    it('fades only the ends with more tools', () => {
      const row = renderOverflowing({ scrollLeft: 0 });
      expect(row.style.getPropertyValue('--fade-before')).toBe('0px');
      expect(row.style.getPropertyValue('--fade-after')).toBe('28px');

      row.scrollLeft = 200;
      fireEvent.scroll(row);
      expect(row.style.getPropertyValue('--fade-before')).toBe('28px');
      expect(row.style.getPropertyValue('--fade-after')).toBe('0px');
    });

    it('grows a fade with the distance left, so the last tool is reached unfaded', () => {
      const row = renderOverflowing({ scrollLeft: 190 });
      expect(row.style.getPropertyValue('--fade-after')).toBe('10px');
    });

    it('scrolls sideways with a vertical wheel', () => {
      const row = renderOverflowing();
      const event = wheel(row, { deltaY: 120 });
      expect(row.scrollLeft).toBe(120);
      expect(event.defaultPrevented).toBe(true);
    });

    it('reads a wheel that counts in lines', () => {
      const row = renderOverflowing();
      wheel(row, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
      expect(row.scrollLeft).toBe(48);
    });

    it('leaves a wheel it cannot use to the page', () => {
      const row = renderOverflowing({ scrollLeft: 200 });
      expect(wheel(row, { deltaY: 120 }).defaultPrevented).toBe(false);
      expect(wheel(row, { deltaX: 40, deltaY: 10 }).defaultPrevented).toBe(false);
      expect(wheel(row, { deltaY: -120, ctrlKey: true }).defaultPrevented).toBe(false);
    });

    it('keeps its arrows away from screen readers and the tab order', () => {
      const row = renderOverflowing();
      const arrow = row.parentElement?.querySelector('[data-scroll-arrow="after"]');
      expect(arrow).toHaveAttribute('aria-hidden', 'true');
      expect(arrow).toHaveAttribute('tabindex', '-1');
      expect(screen.getAllByRole('button').some((button) => button === arrow)).toBe(false);
    });
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
