import { ChevronUp } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { type PointerEvent, useEffect, useRef } from 'react';
import { haptics } from '@/lib/haptics';
import { HOLD_MS, LONG_PRESS_TOLERANCE, swallowNextClick } from '@/lib/longPress';
import { springs } from '@/lib/motion';
import { SETTINGS_TABS, type SettingsPath, type SettingsTab } from '@/lib/settings';
import { cn } from '@/lib/utils';

/**
 * The Settings page under a point on screen, for a finger sliding up from the dock's tab
 * selector. The selector holds pointer capture, so this is a geometric hit test rather than
 * elementFromPoint. Rows take the finger anywhere across the card's width and in the gaps
 * between them, so the gesture does not need fingertip precision.
 */
export function settingsTabAt(root: ParentNode | null, x: number, y: number): SettingsPath | null {
  const card = root?.querySelector<HTMLElement>('[data-settings-tabs]');
  if (!card) return null;
  const bounds = card.getBoundingClientRect();
  if (x < bounds.left - 24 || x > bounds.right + 24) return null;
  if (y < bounds.top - 32 || y > bounds.bottom + 8) return null;
  let nearest: { path: SettingsPath; distance: number } | null = null;
  for (const row of card.querySelectorAll<HTMLElement>('[data-settings-tab]')) {
    const rect = row.getBoundingClientRect();
    const distance = Math.abs(y - (rect.top + rect.bottom) / 2);
    const path = SETTINGS_TABS.find((tab) => tab.path === row.dataset.settingsTab)?.path;
    if (path && (!nearest || distance < nearest.distance)) nearest = { path, distance };
  }
  return nearest?.path ?? null;
}

type PickerProps = {
  open: boolean;
  current: SettingsTab | null;
  /** The page under a finger held on the selector; the indicator follows it. */
  hovered: SettingsPath | null;
  onSelect: (path: SettingsPath) => void;
};

/**
 * Settings' pages as a card floating above the dock with a gap, like the Gallery switcher.
 * The dock's tab selector opens it.
 */
export function SettingsTabPicker({ open, current, hovered, onSelect }: PickerProps) {
  const shown = hovered ?? current?.path;

  return (
    <AnimatePresence initial={false}>
      {open && (
        // No `filter` in this animation, and the glass on the animated element itself: a
        // filter on an ancestor makes a backdrop root, so the glass would stop blurring the
        // page behind it.
        <motion.nav
          key="settings-tabs"
          aria-label="Settings pages"
          data-settings-tabs
          className="glass absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-10 flex origin-bottom touch-none select-none flex-col gap-1 rounded-[var(--dock-radius)] p-1 [-webkit-touch-callout:none]"
          initial={{ opacity: 0, y: 16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.16 } }}
          transition={springs.snappy}
        >
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = shown === tab.path;
            return (
              <motion.button
                key={tab.path}
                type="button"
                data-settings-tab={tab.path}
                aria-current={current?.path === tab.path ? 'page' : undefined}
                onClick={() => onSelect(tab.path)}
                animate={{ scale: hovered === tab.path ? 1.03 : 1 }}
                transition={springs.snappy}
                className={cn(
                  'relative z-0 flex h-12 items-center gap-3 rounded-[calc(var(--dock-radius)-0.25rem)] px-4 text-left font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
                  selected ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {selected && (
                  <motion.span
                    layoutId="settings-tab"
                    aria-hidden
                    className="-z-10 absolute inset-0 rounded-[calc(var(--dock-radius)-0.25rem)] bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]"
                    transition={springs.snappy}
                  />
                )}
                <Icon className="size-5" aria-hidden />
                {tab.label}
              </motion.button>
            );
          })}
        </motion.nav>
      )}
    </AnimatePresence>
  );
}

type Hold = {
  pointerId: number;
  x: number;
  y: number;
  timer: number;
  /** The picker is open under the finger. */
  holding: boolean;
  path: SettingsPath | null;
};

type SelectorProps = {
  current: SettingsTab | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHover: (path: SettingsPath | null) => void;
  onSelect: (path: SettingsPath) => void;
  /** Where to find the picker for the hold-and-slide hit test. */
  pickerRoot: () => ParentNode | null;
};

/**
 * What the dock shows in Settings: the open page's name, which opens the picker above it.
 * Holding it (or sliding off it) opens the picker under the finger, and letting go on a page
 * picks it.
 */
export function SettingsTabSelector({
  current,
  open,
  onOpenChange,
  onHover,
  onSelect,
  pickerRoot,
}: SelectorProps) {
  // The selector lingers while it fades out; it must not catch taps.
  const isPresent = useIsPresent();
  const hold = useRef<Hold | null>(null);
  useEffect(() => () => window.clearTimeout(hold.current?.timer), []);

  function endHold() {
    window.clearTimeout(hold.current?.timer);
    hold.current = null;
    onHover(null);
  }

  function openUnderFinger() {
    const state = hold.current;
    if (!state || state.holding) return;
    window.clearTimeout(state.timer);
    state.holding = true;
    haptics.longPress();
    onOpenChange(true);
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    endHold();
    hold.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(openUnderFinger, HOLD_MS),
      holding: false,
      path: null,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const state = hold.current;
    if (state?.pointerId !== event.pointerId) return;
    if (!state.holding) {
      const distance = Math.hypot(event.clientX - state.x, event.clientY - state.y);
      if (distance <= LONG_PRESS_TOLERANCE) return;
      openUnderFinger();
    }
    const path = settingsTabAt(pickerRoot(), event.clientX, event.clientY);
    if (path === state.path) return;
    state.path = path;
    if (path) haptics.selection();
    onHover(path);
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const state = hold.current;
    if (state?.pointerId !== event.pointerId) return;
    endHold();
    if (!state.holding) return;
    swallowNextClick();
    // Hit-test at release too: the last move may have been dropped. Letting go anywhere
    // else leaves the picker open to tap.
    const path = settingsTabAt(pickerRoot(), event.clientX, event.clientY) ?? state.path;
    if (path) onSelect(path);
  }

  const Icon = current?.icon;
  return (
    <motion.div
      className="absolute inset-0 p-1"
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      initial={{ opacity: 0, scale: 0.92, filter: 'blur(6px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scale: 0.92, filter: 'blur(6px)', transition: { duration: 0.16 } }}
      transition={springs.smooth}
    >
      <motion.button
        type="button"
        aria-label={current ? `Settings page: ${current.label}` : 'Settings pages'}
        aria-expanded={open}
        onClick={() => {
          haptics.toggle();
          onOpenChange(!open);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endHold}
        onContextMenu={(event) => event.preventDefault()}
        whileTap={{ scale: 0.97 }}
        transition={springs.snappy}
        className={cn(
          'flex size-full touch-none select-none items-center gap-3 rounded-[calc(var(--dock-radius)-0.25rem)] pr-4 pl-5 font-medium text-[1.0625rem] outline-none transition-colors duration-200 [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring/70',
          open && 'bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]',
        )}
      >
        {Icon && <Icon className="size-5 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? 'Settings'}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={springs.snappy}>
          <ChevronUp className="size-5 text-muted-foreground" aria-hidden />
        </motion.span>
      </motion.button>
    </motion.div>
  );
}
