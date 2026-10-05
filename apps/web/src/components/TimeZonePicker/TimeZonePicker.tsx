import { Check, Search } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { haptics } from '@/lib/haptics';
import { timeZoneOffset } from '@/lib/reminders';
import { cn } from '@/lib/utils';

type Props = {
  /** The chosen zone, as an IANA name. */
  value: string;
  onChange: (value: string) => void;
  /** The moment the offsets are for, as a zone's changes with its daylight saving. */
  at: Date;
  className?: string;
};

/** Every zone the device knows, with the chosen one among them. */
function timeZones(current: string) {
  // The list the device gives leaves UTC out.
  const zones = ['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])];
  return zones.includes(current) ? zones : [current, ...zones];
}

const plain = (text: string) => text.toLowerCase().replace(/[\s_/]+/g, ' ');

/** A list of time zones with their offsets, narrowed by a search and opened on the chosen one. */
export function TimeZonePicker({ value, onChange, at, className }: Props) {
  const [query, setQuery] = useState('');
  const list = useRef<HTMLUListElement>(null);
  // Offsets are asked of a formatter per zone, so once per moment rather than per keystroke.
  const moment = at.getTime();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the offsets are for the moment, not the Date object
  const zones = useMemo(
    () =>
      timeZones(value).map((zone) => {
        const name = zone.replaceAll('_', ' ');
        const offset = timeZoneOffset(zone, at);
        return { zone, name, offset, search: plain(`${name} ${offset}`) };
      }),
    [value, moment],
  );
  const wanted = plain(query).trim();
  const shown = wanted ? zones.filter((zone) => zone.search.includes(wanted)) : zones;

  // Opens with the chosen zone in the middle of the list rather than at its far end. Moving
  // the list itself keeps the panel behind it from scrolling, as scrollIntoView would.
  useLayoutEffect(() => {
    const box = list.current;
    const chosen = box?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (box && chosen) {
      box.scrollTop =
        chosen.offsetTop - box.offsetTop - (box.clientHeight - chosen.offsetHeight) / 2;
    }
  }, []);

  const choose = (zone: string) => {
    haptics.selection();
    onChange(zone);
  };

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      <label className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-foreground/[0.06] px-3 focus-within:ring-2 focus-within:ring-ring/70 focus-within:ring-inset">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          aria-label="Search time zones"
          placeholder="Search"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (list.current) list.current.scrollTop = 0;
          }}
          // Enter would otherwise send the form this sits in; here it takes the first match.
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const first = shown[0];
            if (first) choose(first.zone);
          }}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <ul ref={list} className="h-72 min-h-24 shrink overflow-y-auto overscroll-contain">
        {shown.map(({ zone, name, offset }) => {
          const selected = zone === value;
          return (
            <li key={zone}>
              <button
                type="button"
                data-zone={zone}
                aria-pressed={selected}
                onClick={() => choose(zone)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset',
                  selected ? 'glass-chosen' : 'hover:bg-foreground/[0.06]',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span
                  className={cn(
                    'shrink-0 text-xs tabular-nums',
                    !selected && 'text-muted-foreground',
                  )}
                >
                  {offset}
                </span>
                {selected && <Check className="size-4 shrink-0" aria-hidden />}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-3 py-6 text-center text-muted-foreground text-sm">
            No time zone matches.
          </li>
        )}
      </ul>
    </div>
  );
}
