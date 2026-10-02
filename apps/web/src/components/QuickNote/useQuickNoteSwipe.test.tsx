import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { motionValue } from 'motion/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptics } from '@/lib/haptics';
import { useQuickNoteSwipe } from './useQuickNoteSwipe';

vi.mock('@/lib/haptics', () => ({ haptics: { threshold: vi.fn() } }));

afterEach(() => {
  vi.clearAllMocks();
  window.getSelection()?.removeAllRanges();
});

function setup(scrollTop = 0, scrollHeight = 100, enabled = true) {
  const y = motionValue(0);
  const onSave = vi.fn();
  const onExpand = vi.fn();
  function Window() {
    const surface = useRef<HTMLElement>(null);
    const handle = useRef<HTMLDivElement>(null);
    useQuickNoteSwipe({ surface, handle, y, enabled, onSave, onExpand });
    return (
      <section ref={surface} data-testid="surface">
        <div ref={handle} data-testid="handle" />
        <div data-testid="scroll" style={{ overflowY: 'auto' }}>
          <div contentEditable suppressContentEditableWarning data-testid="editor">
            Draft text
          </div>
        </div>
        <button type="button" onClick={onSave}>
          Tool
        </button>
      </section>
    );
  }
  render(<Window />);
  const surface = screen.getByTestId('surface');
  const handle = screen.getByTestId('handle');
  const editor = screen.getByTestId('editor');
  const scroll = screen.getByTestId('scroll');
  const tool = screen.getByRole('button');
  Object.defineProperties(scroll, {
    clientHeight: { value: 100 },
    scrollHeight: { value: scrollHeight },
  });
  scroll.scrollTop = scrollTop;
  editor.focus();
  return { surface, handle, editor, scroll, tool, y, onSave, onExpand };
}

function touch(
  target: HTMLElement,
  type: 'start' | 'move' | 'end' | 'cancel',
  x = 100,
  y = 200,
  time = 0,
  count = 1,
) {
  const touches =
    type === 'end' || type === 'cancel'
      ? []
      : Array.from({ length: count }, (_, identifier) => ({ clientX: x, clientY: y, identifier }));
  const factory = {
    start: createEvent.touchStart,
    move: createEvent.touchMove,
    end: createEvent.touchEnd,
    cancel: createEvent.touchCancel,
  }[type];
  const event = factory(target, { touches, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  fireEvent(target, event);
  return event;
}

describe('quick-note swipes', () => {
  it.each(['surface', 'handle', 'editor', 'tool'] as const)(
    'saves from the %s without clicking the tool',
    (part) => {
      const window = setup();
      const target = window[part];
      touch(target, 'start');
      expect(touch(target, 'move', 100, 350, 50).defaultPrevented).toBe(true);
      expect(window.y.get()).toBe(75);
      expect(haptics.threshold).toHaveBeenCalledOnce();
      touch(target, 'end', 100, 350, 80);
      fireEvent.click(window.tool);
      expect(window.onSave).toHaveBeenCalledOnce();
      expect(window.onExpand).not.toHaveBeenCalled();
    },
  );

  it('expands from editable content and caps the pull', () => {
    const { editor, y, onExpand, onSave } = setup();
    touch(editor, 'start');
    touch(editor, 'move', 100, -100, 50);
    expect(y.get()).toBe(-56);
    touch(editor, 'end', 100, -100, 80);
    expect(onExpand).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('claims the first small Android move before native scrolling takes over', () => {
    const { editor, onExpand } = setup();
    touch(editor, 'start');
    const firstMove = touch(editor, 'move', 100, 192, 80);
    expect(firstMove.defaultPrevented).toBe(true);
    const nextMove = createEvent.touchMove(editor, {
      touches: [{ clientX: 100, clientY: 70, identifier: 0 }],
      bubbles: true,
      cancelable: firstMove.defaultPrevented,
    });
    Object.defineProperty(nextMove, 'timeStamp', { value: 180 });
    fireEvent(editor, nextMove);
    touch(editor, 'end', 100, 70, 200);
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it('keeps following the original touch target when editing replaces it', () => {
    const { editor, y, onExpand } = setup();
    touch(editor, 'start');
    // Android can move the caret and replace a BlockNote node view during the touch.
    editor.replaceWith(document.createElement('div'));
    touch(editor, 'move', 100, 180, 30);
    expect(y.get()).toBe(-6);
    touch(editor, 'move', 100, 70, 90);
    touch(editor, 'end', 100, 70, 120);
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it.each([
    ['up from the top', 0, -150],
    ['down from the bottom', 200, 150],
    ['up from the middle', 100, -150],
    ['down from the middle', 100, 150],
  ])('preserves scrolling %s, even if that scroll reaches the edge', (_, scrollTop, delta) => {
    const { editor, scroll, y, onSave, onExpand } = setup(scrollTop, 300);
    touch(editor, 'start');
    scroll.scrollTop = delta > 0 ? 0 : 200;
    expect(touch(editor, 'move', 100, 200 + delta, 50).defaultPrevented).toBe(false);
    touch(editor, 'end', 100, 200 + delta, 80);
    expect(y.get()).toBe(0);
    expect(onSave).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });

  it.each([
    [0, 150],
    [200, -150],
  ])('allows an outward pull from the matching scroll edge', (scrollTop, delta) => {
    const { editor, onSave, onExpand } = setup(scrollTop, 300);
    touch(editor, 'start');
    touch(editor, 'move', 100, 200 + delta, 50);
    touch(editor, 'end', 100, 200 + delta, 80);
    expect(delta > 0 ? onSave : onExpand).toHaveBeenCalledOnce();
  });

  it('leaves taps, horizontal gestures, and long presses focused and unclaimed', () => {
    const { editor, tool, y, onSave, onExpand } = setup();
    touch(editor, 'start');
    touch(editor, 'end', 100, 200, 80);
    expect(editor).toHaveFocus();
    touch(editor, 'start');
    expect(touch(editor, 'move', 260, 240, 50).defaultPrevented).toBe(false);
    touch(editor, 'move', 260, 400, 80);
    touch(editor, 'end', 260, 400, 90);
    touch(editor, 'start');
    expect(touch(editor, 'move', 100, 400, 350).defaultPrevented).toBe(false);
    touch(editor, 'end', 100, 400, 380);
    expect(y.get()).toBe(0);
    expect(onSave).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
    expect(editor).toHaveFocus();
    fireEvent.click(tool);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('keeps selected text available to edit while the handle still works', () => {
    const { editor, handle, onSave, onExpand } = setup();
    const range = document.createRange();
    range.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    touch(editor, 'start');
    expect(touch(editor, 'move', 100, 400, 50).defaultPrevented).toBe(false);
    touch(editor, 'end', 100, 400, 80);
    expect(onSave).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
    touch(handle, 'start');
    touch(handle, 'move', 100, 400, 50);
    touch(handle, 'end', 100, 400, 80);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('returns a short pull without changing editor focus', () => {
    const { editor, onSave, onExpand } = setup();
    touch(editor, 'start');
    touch(editor, 'move', 100, 240, 100);
    touch(editor, 'end', 100, 240, 250);
    expect(onSave).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
    expect(editor).toHaveFocus();
  });

  it.each(['cancel', 'multitouch'] as const)('does not commit a %s gesture', (type) => {
    const { editor, onSave, onExpand } = setup();
    touch(editor, 'start');
    touch(editor, 'move', 100, 400, 50);
    if (type === 'multitouch') touch(editor, 'start', 100, 400, 60, 2);
    else touch(editor, 'cancel', 100, 400, 60);
    touch(editor, 'end', 100, 400, 80);
    expect(onSave).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });

  it('saves a deliberate downward flick but ignores small jitter', () => {
    const { editor, onSave } = setup();
    touch(editor, 'start');
    touch(editor, 'move', 100, 215, 10);
    touch(editor, 'end', 100, 215, 20);
    expect(onSave).not.toHaveBeenCalled();
    touch(editor, 'start', 100, 200, 100);
    touch(editor, 'move', 100, 250, 130);
    touch(editor, 'end', 100, 250, 150);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('does not claim gestures during the exit animation', () => {
    const { editor, y, onSave, onExpand } = setup(0, 100, false);
    touch(editor, 'start');
    expect(touch(editor, 'move', 100, 400, 50).defaultPrevented).toBe(false);
    touch(editor, 'end', 100, 400, 80);
    expect(y.get()).toBe(0);
    expect(onSave).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });
});
