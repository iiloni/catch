import { afterEach, expect, it } from 'vitest';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'virtualKeyboard');
  document.body.replaceChildren();
});

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
