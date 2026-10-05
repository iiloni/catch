import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { animate, motionValue } from 'motion/react';
import { useSyncExternalStore } from 'react';
import { springs } from './motion';

type KeyboardAnimation = {
  from: number;
  to: number;
  /** Milliseconds; 0 when the keyboard jumped without animating. */
  duration: number;
  /** The keyboard's easing curve, sampled evenly from t = 0 to 1. */
  curve: number[];
};

type Insets = { top: number; right: number; bottom: number; left: number; keyboard: number };

// A local plugin in the Android project (KeyboardInsetsPlugin.java).
const KeyboardInsets = registerPlugin<{
  current(): Promise<Insets>;
  addListener(
    event: 'keyboard',
    listener: (animation: KeyboardAnimation) => void,
  ): Promise<PluginListenerHandle>;
}>('KeyboardInsets');

// The VirtualKeyboard API (Chromium). Not in TypeScript's DOM types yet.
type VirtualKeyboard = EventTarget & { overlaysContent: boolean; boundingRect: DOMRect };

/**
 * Height of the on-screen keyboard in CSS pixels, moving in step with it. Also mirrored
 * to the `--keyboard` CSS variable, which the dock and editor use to sit above it.
 */
export const keyboardHeight = motionValue(0);

/** Turns sampled easing values into an easing function by linear interpolation. */
function sampledEase(curve: readonly number[]) {
  const last = curve.length - 1;
  return (t: number) => {
    if (last < 1) return t;
    const position = Math.min(Math.max(t, 0), 1) * last;
    const index = Math.floor(position);
    const from = curve[index] ?? 1;
    const to = curve[Math.min(index + 1, last)] ?? 1;
    return from + (to - from) * (position - index);
  };
}

/**
 * Gives up focus once the keyboard is dismissed (the back button, the keyboard's own hide
 * key). Left focused, the field would bring the keyboard back on the next tap anywhere on the
 * page, such as on a dock button: Chrome shows it again after any tap while a field has focus.
 */
function releaseFocus() {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) return;
  if (focused.isContentEditable || focused.matches('input, textarea, select')) focused.blur();
}

let started = false;
/** Where the keyboard is heading, ahead of `keyboardHeight`, which is still animating there. */
let target = 0;

function keyboardMovesTo(height: number) {
  if (height <= 0 && target > 0) releaseFocus();
  target = height;
}

/**
 * Starts tracking the keyboard. On Android the WebView is not resized for the keyboard
 * (see KeyboardInsetsPlugin.java); the native side reports each keyboard animation once and
 * this replays it with the same duration and curve. In Chromium browsers the VirtualKeyboard
 * API does the same job with a spring; elsewhere the browser resizes the page as usual.
 */
export function startKeyboardTracking() {
  if (started) return;
  started = true;
  const root = document.documentElement;
  keyboardHeight.on('change', (height) => root.style.setProperty('--keyboard', `${height}px`));

  if (Capacitor.getPlatform() === 'android') {
    void KeyboardInsets.current()
      .then((insets) => {
        for (const side of ['top', 'right', 'bottom', 'left'] as const) {
          root.style.setProperty(`--safe-area-inset-${side}`, `${insets[side]}px`);
        }
        target = insets.keyboard;
        keyboardHeight.jump(insets.keyboard);
      })
      // An app build without the plugin: fall back to the WebView resizing.
      .catch(() => {});
    void KeyboardInsets.addListener('keyboard', ({ to, duration, curve }) => {
      keyboardMovesTo(to);
      if (duration <= 0) keyboardHeight.jump(to);
      else
        void animate(keyboardHeight, to, { duration: duration / 1000, ease: sampledEase(curve) });
    }).catch(() => {});
    return;
  }

  const virtualKeyboard = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard })
    .virtualKeyboard;
  if (virtualKeyboard) {
    virtualKeyboard.overlaysContent = true;
    virtualKeyboard.addEventListener('geometrychange', () => {
      keyboardMovesTo(virtualKeyboard.boundingRect.height);
      void animate(keyboardHeight, virtualKeyboard.boundingRect.height, springs.smooth);
    });
  }
}

function subscribe(listener: () => void) {
  return keyboardHeight.on('change', listener);
}

/** Whether the keyboard is open (or opening). Re-renders only when that flips. */
export function useKeyboardOpen() {
  return useSyncExternalStore(subscribe, () => keyboardHeight.get() > 40);
}
