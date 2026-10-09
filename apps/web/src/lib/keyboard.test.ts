import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let removeListeners: () => void;

beforeEach(() => {
  vi.resetModules();
  const targets = [window, document];
  const spies = targets.map((target) => vi.spyOn(target, 'addEventListener'));
  removeListeners = () => {
    for (const [index, spy] of spies.entries()) {
      for (const [type, listener, options] of spy.mock.calls) {
        targets[index]?.removeEventListener(type, listener, options);
      }
    }
  };
});

afterEach(async () => {
  removeListeners();
  (await import('./keyboard')).keyboardHeight.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'virtualKeyboard');
  document.body.replaceChildren();
  document.documentElement.style.removeProperty('--keyboard');
});

function visualViewport() {
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
  return viewport;
}

function focusField() {
  const field = document.createElement('textarea');
  document.body.append(field);
  field.focus();
  return field;
}

it('releases focus when the keyboard is dismissed, so the next tap does not raise it again', async () => {
  const virtualKeyboard = Object.assign(new EventTarget(), {
    overlaysContent: false,
    boundingRect: { height: 0 },
  });
  Object.defineProperty(navigator, 'virtualKeyboard', {
    value: virtualKeyboard,
    configurable: true,
  });
  const { startKeyboardTracking } = await import('./keyboard');
  startKeyboardTracking();

  const field = document.createElement('input');
  document.body.append(field);
  field.focus();

  virtualKeyboard.boundingRect = { height: 300 };
  virtualKeyboard.dispatchEvent(new Event('geometrychange'));
  expect(document.activeElement).toBe(field);

  virtualKeyboard.boundingRect = { height: 0 };
  virtualKeyboard.dispatchEvent(new Event('geometrychange'));
  expect(document.activeElement).toBe(document.body);
});

it('keeps fixed controls above a keyboard that only shrinks the visual viewport', async () => {
  const viewport = visualViewport();
  const { startKeyboardTracking, keyboardHeight } = await import('./keyboard');
  startKeyboardTracking();
  const field = focusField();

  viewport.height = 480;
  viewport.dispatchEvent(new Event('resize'));
  expect(keyboardHeight.get()).toBe(320);
  expect(document.documentElement.style.getPropertyValue('--keyboard')).toBe('320px');

  viewport.offsetTop = 100;
  viewport.dispatchEvent(new Event('scroll'));
  expect(keyboardHeight.get()).toBe(220);

  viewport.height = 800;
  viewport.offsetTop = 0;
  viewport.dispatchEvent(new Event('resize'));
  expect(keyboardHeight.get()).toBe(0);
  expect(document.activeElement).toBe(field);
});

it('detects a keyboard already open when tracking starts for a contenteditable note', async () => {
  const viewport = visualViewport();
  viewport.height = 480;
  const editor = document.createElement('div');
  editor.tabIndex = 0;
  Object.defineProperty(editor, 'isContentEditable', { value: true });
  document.body.append(editor);
  editor.focus();

  const { startKeyboardTracking, keyboardHeight } = await import('./keyboard');
  startKeyboardTracking();
  expect(keyboardHeight.get()).toBe(320);
});

it('does not mistake pinch zoom or an unfocused viewport change for the keyboard', async () => {
  const viewport = visualViewport();
  const { startKeyboardTracking, keyboardHeight } = await import('./keyboard');
  startKeyboardTracking();
  viewport.height = 480;
  viewport.dispatchEvent(new Event('resize'));
  expect(keyboardHeight.get()).toBe(0);

  viewport.scale = 2;
  focusField();
  viewport.dispatchEvent(new Event('resize'));
  expect(keyboardHeight.get()).toBe(0);

  viewport.scale = 1;
  viewport.dispatchEvent(new Event('resize'));
  expect(keyboardHeight.get()).toBe(320);
});

it('recalculates on layout resize and does not double count a resized layout viewport', async () => {
  const viewport = visualViewport();
  const { startKeyboardTracking, keyboardHeight } = await import('./keyboard');
  startKeyboardTracking();
  focusField();
  viewport.height = 480;
  viewport.dispatchEvent(new Event('resize'));
  expect(keyboardHeight.get()).toBe(320);

  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(480);
  window.dispatchEvent(new Event('resize'));
  expect(keyboardHeight.get()).toBe(0);

  viewport.offsetTop = 20;
  viewport.dispatchEvent(new Event('scroll'));
  expect(keyboardHeight.get()).toBe(0);
});

it('keeps the inset when focus moves between fields and clears it when editing ends', async () => {
  const viewport = visualViewport();
  const { startKeyboardTracking, keyboardHeight } = await import('./keyboard');
  startKeyboardTracking();
  const first = focusField();
  viewport.height = 480;
  viewport.dispatchEvent(new Event('resize'));

  const second = focusField();
  await Promise.resolve();
  expect(document.activeElement).toBe(second);
  expect(keyboardHeight.get()).toBe(320);
  expect(first).not.toBe(document.activeElement);

  second.blur();
  await Promise.resolve();
  expect(keyboardHeight.get()).toBe(0);
});

it('uses VirtualKeyboard geometry when both browser APIs are present', async () => {
  const viewport = visualViewport();
  const virtualKeyboard = Object.assign(new EventTarget(), {
    overlaysContent: false,
    boundingRect: { height: 0 },
  });
  Object.defineProperty(navigator, 'virtualKeyboard', {
    value: virtualKeyboard,
    configurable: true,
  });
  const { startKeyboardTracking, keyboardHeight } = await import('./keyboard');
  startKeyboardTracking();
  focusField();
  viewport.height = 480;
  viewport.dispatchEvent(new Event('resize'));
  expect(virtualKeyboard.overlaysContent).toBe(true);
  expect(keyboardHeight.get()).toBe(0);
});
