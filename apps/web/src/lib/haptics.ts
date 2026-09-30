import { Capacitor, registerPlugin } from '@capacitor/core';

type Effect = 'tick' | 'light' | 'medium' | 'success' | 'warning' | 'threshold';

// A local plugin in the Android project (HapticFeedbackPlugin.java).
const HapticFeedback = registerPlugin<{ perform(options: { effect: Effect }): Promise<void> }>(
  'HapticFeedback',
);

const native = Capacitor.isNativePlatform();

function perform(effect: Effect) {
  if (native) void HapticFeedback.perform({ effect }).catch(() => {});
}

/**
 * Haptics named by what happened, so components never choose raw strengths.
 * They are no-ops on the web.
 */
export const haptics = {
  /** Tab change, or scrubbing across a tab. */
  selection: () => perform('tick'),
  /** A control changes state: + becomes ×, search opens. */
  toggle: () => perform('light'),
  /** Long-press picks up an item or starts selecting notes. */
  longPress: () => perform('medium'),
  /** A note was saved or dropped into place. */
  success: () => perform('success'),
  /** A drag crossed the point where letting go commits. */
  threshold: () => perform('threshold'),
  /** Something destructive, like moving to the trash. */
  warning: () => perform('warning'),
};
