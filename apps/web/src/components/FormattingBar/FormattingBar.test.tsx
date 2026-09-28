import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EditorControls, FormattingState } from '@/components/NoteEditor/editorControls';
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
  };
}

describe('FormattingBar', () => {
  it('shows which styles and block type are active', () => {
    render(
      <FormattingBar
        controls={fakeControls({
          styles: { bold: true, italic: false, underline: false, strike: false },
          block: 'checkListItem',
        })}
      />,
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
    render(<FormattingBar controls={controls} />);
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Numbered list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Indent' }));
    expect(controls.toggleStyle).toHaveBeenCalledWith('italic');
    expect(controls.toggleBlock).toHaveBeenCalledWith('numberedListItem');
    expect(controls.indent).toHaveBeenCalled();
  });

  it('disables indenting when the block cannot move', () => {
    render(<FormattingBar controls={fakeControls()} />);
    expect(screen.getByRole('button', { name: 'Indent' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Outdent' })).toBeDisabled();
  });

  it('waits for the editor', () => {
    render(<FormattingBar controls={null} />);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
  });
});
