import { Info } from 'lucide-react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';

export type DetailsPointer = Pick<PointerEvent, 'pointerId' | 'clientY' | 'timeStamp'>;
export interface DetailsGesture {
  isOpen: boolean;
  begin: (event: DetailsPointer) => void;
  move: (event: DetailsPointer) => void;
  finish: (event: DetailsPointer, cancelled?: boolean) => void;
}

export function DetailsSheet({
  children,
  ref,
}: {
  children: ReactNode;
  ref?: Ref<DetailsGesture>;
}) {
  const [open, setOpen] = useState(false);
  const [exposed, setExposed] = useState(false);
  const [travel, setTravel] = useState(320);
  const panel = useRef<HTMLDivElement>(null);
  const infoButton = useRef<HTMLButtonElement>(null);
  const progress = useMotionValue(0);
  const y = useTransform(progress, (value) => (1 - value) * travel);
  const reducedMotion = useReducedMotion();
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const suppressClick = useRef(false);
  const drag = useRef<{
    id: number;
    start: number;
    progress: number;
    last: number;
    time: number;
    velocity: number;
    moved: boolean;
    armed: boolean;
  } | null>(null);

  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const measure = () => setTravel(window.innerHeight - node.offsetTop + 16);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      animation.current?.stop();
    };
  }, []);

  function settle(next: boolean) {
    if (next !== open) haptics.toggle();
    setOpen(next);
    if (next) setExposed(true);
    else if (panel.current?.contains(document.activeElement)) infoButton.current?.focus();
    animation.current?.stop();
    animation.current = animate(progress, next ? 1 : 0, {
      ...(reducedMotion ? { duration: 0 } : springs.pane),
      onComplete: () => setExposed(next),
    });
  }

  useImperativeHandle(ref, () => ({ isOpen: open, begin, move, finish }));

  function begin(event: DetailsPointer) {
    if (drag.current) return;
    animation.current?.stop();
    suppressClick.current = false;
    drag.current = {
      id: event.pointerId,
      start: event.clientY,
      progress: progress.get(),
      last: event.clientY,
      time: event.timeStamp,
      velocity: 0,
      moved: false,
      armed: progress.get() >= 0.5,
    };
  }

  function start(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || drag.current) return;
    if (
      event.target instanceof Element &&
      event.target.closest('button') &&
      !event.target.closest('[data-details-handle]')
    )
      return;
    begin(event);
    // Capture on the handle itself so a tap still delivers its click to the button.
    const target =
      event.target instanceof Element
        ? (event.target.closest<HTMLElement>('[data-details-handle]') ?? event.currentTarget)
        : event.currentTarget;
    target.setPointerCapture(event.pointerId);
  }

  function move(event: DetailsPointer) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const distance = current.start - event.clientY;
    if (Math.abs(distance) > 5) current.moved = true;
    if (!current.moved) return;
    setExposed(true);
    const elapsed = event.timeStamp - current.time;
    if (elapsed > 0) current.velocity = ((current.last - event.clientY) / elapsed) * 1000;
    current.last = event.clientY;
    current.time = event.timeStamp;
    const next = Math.max(0, Math.min(1, current.progress + distance / travel));
    progress.set(next);
    const armed = next >= 0.5;
    if (armed !== current.armed) haptics.threshold();
    current.armed = armed;
  }

  function finish(event: DetailsPointer, cancelled = false) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    suppressClick.current = current.moved;
    if (cancelled || !current.moved) {
      settle(open);
      return;
    }
    const velocity = event.timeStamp - current.time < 100 ? current.velocity : 0;
    settle(Math.abs(velocity) > 600 ? velocity > 0 : progress.get() >= 0.5);
  }

  const gestures = {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, true),
  };
  function toggle(event: MouseEvent) {
    if (suppressClick.current && event.detail > 0) {
      suppressClick.current = false;
      return;
    }
    suppressClick.current = false;
    settle(!open);
  }

  return (
    <>
      <motion.div
        ref={panel}
        id="media-details"
        data-media-details
        role="region"
        aria-label="Attachment details"
        aria-hidden={!exposed}
        inert={!exposed}
        style={{ y, pointerEvents: exposed ? 'auto' : 'none' }}
        className="absolute right-3 bottom-[calc(var(--safe-bottom)+5rem)] left-3 z-20 touch-none rounded-2xl glass-thick px-3 pb-3 text-foreground"
        {...gestures}
      >
        <button
          type="button"
          data-details-handle
          aria-label="Hide attachment details"
          className="flex h-8 w-full touch-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={toggle}
        >
          <span className="h-1 w-8 rounded-full bg-muted-foreground/40" />
        </button>
        {children}
      </motion.div>
      <Button
        ref={infoButton}
        variant="ghost"
        size="icon"
        data-details-handle
        aria-label="Attachment details"
        aria-expanded={open}
        aria-controls="media-details"
        className="absolute bottom-[calc(var(--safe-bottom)+1rem)] left-3 z-30 size-11 touch-none rounded-full glass-thick text-foreground"
        {...gestures}
        onClick={toggle}
      >
        <Info />
      </Button>
    </>
  );
}
