import { motionValue, useReducedMotion, useTransform } from 'motion/react';

/** Shared by the settings content and its fixed chrome so a pull moves the whole page. */
export const settingsDragY = motionValue(0);

export function useSettingsSwipeY() {
  const reducedMotion = useReducedMotion();
  return useTransform(() => (reducedMotion ? 0 : settingsDragY.get()));
}
