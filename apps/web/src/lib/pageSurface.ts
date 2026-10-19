import type { MotionValue } from 'motion/react';
import { createContext, use } from 'react';

/** A page's fixed header moves beside its content, outside the transformed content layer. */
export const PageSurface = createContext<{
  active: boolean;
  headerHost: HTMLElement | null;
  x: MotionValue<number>;
  scrollY: MotionValue<number>;
} | null>(null);

export function usePageSurface() {
  return use(PageSurface);
}
