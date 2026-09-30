import { Maximize, Minimize, ZoomIn, ZoomOut } from 'lucide-react';
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  constrain,
  fittedSize,
  initialTransform,
  type Point,
  type Size,
  type Transform,
  zoomAt,
} from './transform';

export function ImageStage({
  source,
  name,
  onError,
  onNavigate,
  onSize,
}: {
  source: string;
  name: string;
  onError: () => void;
  onNavigate?: (direction: number) => void;
  onSize: (size: Size) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [image, setImage] = useState<Size>({ width: 0, height: 0 });
  const [fill, setFill] = useState(false);
  const [transform, setTransform] = useState(initialTransform);
  const [dragging, setDragging] = useState(false);
  const [swipe, setSwipe] = useState(0);
  const live = useRef(transform);
  const pointers = useRef(new Map<number, Point>());
  const start = useRef<Point | null>(null);
  const moved = useRef(false);
  const pinched = useRef(false);
  const lastTap = useRef<{ time: number; point: Point } | null>(null);
  const media = useMemo(() => fittedSize(image, viewport, fill), [image, viewport, fill]);
  const pannable = transform.scale > 1 || fill;

  const update = useCallback(
    (next: Transform) => {
      const bounded = constrain(next, media, viewport);
      live.current = bounded;
      setTransform(bounded);
    },
    [media, viewport],
  );

  const point = useCallback((clientX: number, clientY: number): Point => {
    const rect = stage.current?.getBoundingClientRect();
    return {
      x: clientX - (rect?.left ?? 0) - (rect?.width ?? 0) / 2,
      y: clientY - (rect?.top ?? 0) - (rect?.height ?? 0) / 2,
    };
  }, []);

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    update(live.current);
  }, [update]);

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? viewport.height : 1);
      const factor = Math.exp(-delta * (event.ctrlKey ? 0.006 : 0.002));
      update(
        zoomAt(live.current, live.current.scale * factor, point(event.clientX, event.clientY)),
      );
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [point, update, viewport.height]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      const current = live.current;
      if (event.key === '+' || event.key === '=')
        update(zoomAt(current, current.scale * 1.3, { x: 0, y: 0 }));
      else if (event.key === '-') update(zoomAt(current, current.scale / 1.3, { x: 0, y: 0 }));
      else if (event.key === '0') {
        setFill(false);
        update(initialTransform);
      } else if (event.key.startsWith('Arrow')) {
        if (current.scale > 1 || fill) {
          const dx = event.key === 'ArrowLeft' ? 80 : event.key === 'ArrowRight' ? -80 : 0;
          const dy = event.key === 'ArrowUp' ? 80 : event.key === 'ArrowDown' ? -80 : 0;
          update({ ...current, x: current.x + dx, y: current.y + dy });
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
          onNavigate?.(event.key === 'ArrowLeft' ? -1 : 1);
        else return;
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [update, fill, onNavigate]);

  function finish(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size) {
      start.current = null;
      return;
    }
    setDragging(false);
    setSwipe(0);
    const end = point(event.clientX, event.clientY);
    if (!cancelled && !pinched.current && start.current) {
      const dx = end.x - start.current.x;
      const dy = end.y - start.current.y;
      if (moved.current) {
        if (!pannable && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy))
          onNavigate?.(dx < 0 ? 1 : -1);
      } else {
        const previous = lastTap.current;
        if (
          previous &&
          Date.now() - previous.time < 300 &&
          Math.hypot(previous.point.x - end.x, previous.point.y - end.y) < 30
        ) {
          update(live.current.scale > 1 ? initialTransform : zoomAt(live.current, 2.5, end));
          lastTap.current = null;
        } else lastTap.current = { time: Date.now(), point: end };
      }
    }
    if (moved.current || pinched.current || cancelled) lastTap.current = null;
    start.current = null;
  }

  return (
    <>
      <div
        ref={stage}
        data-media-stage
        className={cn(
          'absolute inset-0 flex touch-none items-center justify-center overflow-hidden select-none',
          pannable ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in',
        )}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const next = point(event.clientX, event.clientY);
          if (!pointers.current.size) {
            start.current = next;
            moved.current = false;
            pinched.current = false;
          } else {
            pinched.current = true;
            moved.current = true;
            setSwipe(0);
          }
          pointers.current.set(event.pointerId, next);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId);
          if (!previous) return;
          const next = point(event.clientX, event.clientY);
          const other = Array.from(pointers.current.entries()).find(
            ([id]) => id !== event.pointerId,
          )?.[1];
          pointers.current.set(event.pointerId, next);
          if (other) {
            const distance = Math.hypot(previous.x - other.x, previous.y - other.y);
            if (distance > 0) {
              const ratio = Math.hypot(next.x - other.x, next.y - other.y) / distance;
              const from = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
              const to = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
              update(zoomAt(live.current, live.current.scale * ratio, from, to));
              setDragging(true);
            }
          } else {
            if (start.current && Math.hypot(next.x - start.current.x, next.y - start.current.y) > 5)
              moved.current = true;
            if (live.current.scale > 1 || fill) {
              update({
                ...live.current,
                x: live.current.x + next.x - previous.x,
                y: live.current.y + next.y - previous.y,
              });
              setDragging(true);
            } else if (onNavigate && start.current) {
              setSwipe((next.x - start.current.x) * 0.5);
              setDragging(true);
            }
          }
        }}
        onPointerUp={(event) => finish(event, false)}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => finish(event, true)}
      >
        <img
          src={source}
          alt={name}
          draggable={false}
          onError={onError}
          onLoad={(event) => {
            const size = {
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            };
            setImage(size);
            onSize(size);
          }}
          className="pointer-events-none max-w-none shrink-0 object-contain"
          style={{
            width: media.width || undefined,
            height: media.height || undefined,
            transform: `translate(${transform.x + swipe}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        />
        {!image.width && (
          <p role="status" className="absolute text-sm text-white/70">
            Loading preview…
          </p>
        )}
      </div>
      <fieldset
        className="absolute bottom-[calc(var(--safe-bottom)+1rem)] left-1/2 z-10 flex -translate-x-1/2 items-center gap-0 rounded-full glass-thick p-1 text-foreground sm:gap-1"
        aria-label="Image controls"
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-10"
          aria-label="Zoom out"
          title="Zoom out (−)"
          disabled={transform.scale <= 1}
          onClick={() => update(zoomAt(live.current, live.current.scale / 1.3, { x: 0, y: 0 }))}
        >
          <ZoomOut />
        </Button>
        <Button
          variant="ghost"
          className="h-9 min-w-12 rounded-full px-2 text-xs tabular-nums sm:h-10 sm:min-w-16"
          aria-label="Reset zoom"
          title="Reset zoom (0)"
          onClick={() => {
            setFill(false);
            update(initialTransform);
          }}
        >
          {Math.round(transform.scale * 100)}%
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-10"
          aria-label="Zoom in"
          title="Zoom in (+)"
          disabled={transform.scale >= 8}
          onClick={() => update(zoomAt(live.current, live.current.scale * 1.3, { x: 0, y: 0 }))}
        >
          <ZoomIn />
        </Button>
        <span className="mx-0.5 h-5 w-px bg-border sm:mx-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-10"
          aria-label={fill ? 'Fit image to screen' : 'Fill screen'}
          title={fill ? 'Fit image to screen' : 'Fill screen'}
          onClick={() => {
            setFill(!fill);
            update(initialTransform);
          }}
        >
          {fill ? <Minimize /> : <Maximize />}
        </Button>
      </fieldset>
    </>
  );
}
