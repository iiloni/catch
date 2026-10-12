import { Capacitor, registerPlugin } from '@capacitor/core';

const KeyboardInsets = registerPlugin<{
  ready(): Promise<void>;
  show(): Promise<void>;
}>('KeyboardInsets');

/** Widget taps have no WebView touch gesture, and a cold window may not yet own input. */
export function focusWidgetInput(focus: () => void, finish: () => void) {
  let cancelled = false;
  focus();
  if (Capacitor.getPlatform() === 'android') {
    void KeyboardInsets.ready()
      .then(async () => {
        if (cancelled) return;
        focus();
        await KeyboardInsets.show();
      })
      .catch((error: unknown) => console.error('Widget keyboard could not be opened', error))
      .finally(() => {
        if (!cancelled) finish();
      });
  } else finish();
  return () => {
    cancelled = true;
  };
}
