import { type PointerEvent, useRef, useState } from 'react';
import { useHour12 } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';

type Props = {
  /** The chosen time of day, as `HH:MM`. */
  value: string;
  onChange: (value: string) => void;
  /** Whether hours run 1 to 12 with AM and PM. Follows the clock setting unless given. */
  hour12?: boolean;
  className?: string;
};

const pad = (value: number) => String(value).padStart(2, '0');

/** How far from the dial's center its numbers sit, as a share of its width. */
const OUTER = 39;
const INNER = 23;

/** Where a twelfth (or sixtieth) of the way round the dial is, in percent of its box. */
function place(turn: number, radius: number) {
  const angle = turn * 2 * Math.PI;
  return { x: 50 + radius * Math.sin(angle), y: 50 - radius * Math.cos(angle) };
}

/**
 * A clock face: the hour is tapped or dragged to, then the minute. Dragging the hand
 * reaches every minute; the numbers on the face are the fives.
 */
export function TimePicker({ value, onChange, hour12: given, className }: Props) {
  const setting = useHour12();
  const hour12 = given ?? setting;
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const dragging = useRef(false);
  const afternoon = hour >= 12;
  const set = (nextHour: number, nextMinute: number) => {
    if (nextHour === hour && nextMinute === minute) return;
    haptics.selection();
    onChange(`${pad(nextHour)}:${pad(nextMinute)}`);
  };

  // Twelve hours go round once; on a 24 hour clock the afternoon is an inner ring.
  const hours = Array.from({ length: hour12 ? 12 : 24 }, (_, index) => {
    const inner = index >= 12;
    const position = index % 12;
    const value24 = hour12
      ? position + (afternoon ? 12 : 0)
      : inner
        ? (position + 12) % 24 === 12
          ? 0
          : position + 12
        : position === 0
          ? 12
          : position;
    return {
      hour: value24,
      shown: hour12 ? String(position === 0 ? 12 : position) : pad(value24),
      ...place(position / 12, inner ? INNER : OUTER),
    };
  });
  const minutes = Array.from({ length: 12 }, (_, index) => ({
    minute: index * 5,
    shown: pad(index * 5),
    ...place(index / 12, OUTER),
  }));
  const hand =
    mode === 'hour'
      ? (hours.find((option) => option.hour === hour) ?? place(0, OUTER))
      : place(minute / 60, OUTER);

  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return;
    const x = event.clientX - (bounds.left + bounds.width / 2);
    const y = event.clientY - (bounds.top + bounds.height / 2);
    const turn = (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1;
    if (mode === 'minute') {
      set(hour, Math.round(turn * 60) % 60);
      return;
    }
    const position = Math.round(turn * 12) % 12;
    const inner = !hour12 && Math.hypot(x, y) < (bounds.width * (OUTER + INNER)) / 200;
    const match = hours[position + (inner ? 12 : 0)];
    if (match) set(match.hour, minute);
  }

  const readout = (shown: string, of: 'hour' | 'minute', label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={mode === of}
      onClick={() => {
        haptics.toggle();
        setMode(of);
      }}
      className={cn(
        'flex h-12 min-w-14 items-center justify-center rounded-xl px-2 font-medium text-3xl tabular-nums outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
        mode === of ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.06]',
      )}
    >
      {shown}
    </button>
  );

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div className="flex items-center gap-1.5">
        {readout(hour12 ? String(hour % 12 === 0 ? 12 : hour % 12) : pad(hour), 'hour', 'Hour')}
        <span aria-hidden className="font-medium text-2xl text-muted-foreground">
          :
        </span>
        {readout(pad(minute), 'minute', 'Minute')}
        {hour12 && (
          <div className="ml-1.5 flex h-12 gap-1 rounded-xl bg-foreground/[0.06] p-1">
            {(['AM', 'PM'] as const).map((period) => {
              const selected = (period === 'PM') === afternoon;
              return (
                <button
                  key={period}
                  type="button"
                  data-period={period}
                  aria-pressed={selected}
                  onClick={() => {
                    if (!selected) set((hour + 12) % 24, minute);
                  }}
                  className={cn(
                    'h-full min-w-11 rounded-lg px-2 font-medium text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
                    selected ? 'bg-primary text-primary-foreground' : 'text-foreground/80',
                  )}
                >
                  {period}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* A fieldset lays its children out in a box of its own, so the face is a div inside it. */}
      <fieldset
        aria-label={mode === 'hour' ? 'Hours' : 'Minutes'}
        className="w-full min-w-0 max-w-60"
      >
        <div
          // The face takes the drag itself, rather than scrolling the panel under it.
          className="relative aspect-square w-full touch-none select-none rounded-full bg-foreground/[0.06]"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            dragging.current = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            point(event);
          }}
          onPointerMove={(event) => {
            if (dragging.current) point(event);
          }}
          onPointerUp={() => {
            if (!dragging.current) return;
            dragging.current = false;
            // With the hour chosen, the minute is next.
            if (mode === 'hour') setMode('minute');
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        >
          <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 size-full">
            <line
              x1="50"
              y1="50"
              x2={hand.x}
              y2={hand.y}
              strokeWidth="0.8"
              className="stroke-primary"
            />
            <circle cx="50" cy="50" r="1.5" className="fill-primary" />
            <circle cx={hand.x} cy={hand.y} r="7.5" className="fill-primary" />
          </svg>
          {mode === 'hour'
            ? hours.map((option) => (
                <button
                  key={option.hour}
                  type="button"
                  data-hour={option.hour}
                  aria-pressed={option.hour === hour}
                  onClick={() => {
                    set(option.hour, minute);
                    setMode('minute');
                  }}
                  style={{ left: `${option.x}%`, top: `${option.y}%` }}
                  className={cn(
                    'absolute flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                    option.hour === hour
                      ? 'font-medium text-primary-foreground'
                      : 'text-foreground/80',
                    !hour12 && option.hour !== 12 && (option.hour === 0 || option.hour > 12)
                      ? 'text-xs'
                      : 'text-sm',
                  )}
                >
                  {option.shown}
                </button>
              ))
            : minutes.map((option) => (
                <button
                  key={option.minute}
                  type="button"
                  data-minute={option.minute}
                  aria-pressed={option.minute === minute}
                  onClick={() => set(hour, option.minute)}
                  style={{ left: `${option.x}%`, top: `${option.y}%` }}
                  className={cn(
                    'absolute flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                    option.minute === minute
                      ? 'font-medium text-primary-foreground'
                      : 'text-foreground/80',
                  )}
                >
                  {option.shown}
                </button>
              ))}
        </div>
      </fieldset>
    </div>
  );
}
