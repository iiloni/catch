import { CloudAlert, CloudCheck, CloudOff, LoaderCircle } from 'lucide-react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { springs } from '@/lib/motion';
import { useSyncStatus } from '@/lib/syncStatus';
import type { SaveState } from '@/lib/useNoteAutosave';
import { cn } from '@/lib/utils';

export function SaveStatus({ state, compact = false }: { state: SaveState; compact?: boolean }) {
  // Offline, a save waits in the outbox until the connection comes back.
  const { offline, pending } = useSyncStatus();
  const syncing = state === 'saving' || pending > 0;
  const wasSyncing = useRef(syncing);
  const [recentlySynced, setRecentlySynced] = useState(false);

  useEffect(() => {
    const finished = wasSyncing.current && !syncing && state === 'saved';
    wasSyncing.current = syncing;
    setRecentlySynced(finished);
    if (!finished) return;
    const timer = window.setTimeout(() => setRecentlySynced(false), 2000);
    return () => window.clearTimeout(timer);
  }, [syncing, state]);

  const local = syncing && offline;
  const visible = syncing || recentlySynced || state === 'error';
  const mode = state === 'error' ? 'error' : local ? 'local' : syncing ? 'syncing' : 'synced';
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 -top-2 -bottom-2 flex items-center justify-center overflow-hidden py-2"
    >
      <AnimatePresence>
        {visible && <StatusPill key="pill" mode={mode} compact={compact} />}
      </AnimatePresence>
    </div>
  );
}

type Mode = 'error' | 'local' | 'syncing' | 'synced';

const labels = {
  error: 'Not saved',
  local: 'Saved on this device',
  syncing: 'Syncing…',
  synced: 'Synced',
} satisfies Record<Mode, string>;

const icons = { error: CloudAlert, local: CloudOff, syncing: LoaderCircle, synced: CloudCheck };

function StatusPill({ mode, compact }: { mode: Mode; compact: boolean }) {
  const reducedMotion = useReducedMotion();
  const pillRef = useRef<HTMLDivElement>(null);
  const width = useMotionValue<number | 'auto'>('auto');
  // Animate the measured width, like the header toolbars, so text and icons never stretch.
  const measure = useCallback(
    (element: HTMLParagraphElement | null) => {
      if (!element) return;
      const update = () => {
        const next = element.offsetWidth + 2;
        if (width.get() === 'auto' || reducedMotion) width.jump(next);
        else animate(width, next, springs.smooth);
      };
      update();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [width, reducedMotion],
  );
  const Icon = icons[mode];
  // The header clips the slide below the status bar. Pixel translations avoid resolving
  // a percentage/calc transform against Android's changing safe-area insets.
  const hidden = () => ({
    opacity: 0,
    y: reducedMotion ? 0 : -(pillRef.current?.parentElement?.clientHeight ?? 64),
  });

  return (
    <motion.div
      ref={pillRef}
      data-sync-pill
      title={compact ? labels[mode] : undefined}
      className={cn(
        'glass relative h-9 overflow-hidden rounded-full text-muted-foreground text-xs',
        compact && 'pointer-events-auto',
      )}
      onPointerDown={(event) => event.preventDefault()}
      style={{ width }}
      variants={{ hidden, shown: { opacity: 1, y: 0 } }}
      initial="hidden"
      animate="shown"
      exit="hidden"
      transition={reducedMotion ? { duration: 0 } : springs.smooth}
    >
      <AnimatePresence initial={false}>
        <motion.p
          key={mode}
          ref={measure}
          className={cn(
            'absolute inset-y-0 left-0 flex w-max items-center gap-1.5 whitespace-nowrap',
            compact ? 'px-2' : 'px-3',
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.14 }}
        >
          <Icon
            className={
              mode === 'syncing'
                ? 'size-3.5 shrink-0 motion-safe:animate-spin'
                : mode === 'error'
                  ? 'size-3.5 shrink-0 text-destructive'
                  : 'size-3.5 shrink-0'
            }
            aria-hidden
          />
          <span className={compact ? 'sr-only' : undefined}>{labels[mode]}</span>
        </motion.p>
      </AnimatePresence>
    </motion.div>
  );
}
