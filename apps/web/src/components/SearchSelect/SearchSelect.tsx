import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useBackHandler } from '@/lib/backButton';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';

export type SelectOption = {
  value: string;
  label: string;
  /** Shown under the label, to tell apart options that share one. */
  detail?: string;
  /** Other words that find the option, such as a language's aliases. */
  keywords?: readonly string[];
  icon?: ReactNode;
  /** Indents the option under the ones before it, while the list is not narrowed. */
  depth?: number;
};

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Names the search field, such as "Search languages". */
  searchLabel: string;
  /** Shown when the search matches nothing. */
  emptyText: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Where focus goes when the list closes, if not back to what opened it. */
  onCloseAutoFocus?: (event: Event) => void;
};

const plain = (text: string) => text.trim().toLowerCase();

/** How well an option answers a search, best first, or null when it does not. */
function rank(option: SelectOption, wanted: string) {
  const label = plain(option.label);
  const words = [label, ...(option.keywords ?? []).map(plain)];
  if (words.includes(wanted)) return 0;
  if (label.startsWith(wanted)) return 1;
  if (words.some((word) => word.startsWith(wanted))) return 2;
  return words.some((word) => word.includes(wanted)) ? 3 : null;
}

/** The options a search leaves, the closest first. Without one, all of them as given. */
export function searchOptions(options: readonly SelectOption[], query: string) {
  const wanted = plain(query);
  if (!wanted) return [...options];
  return options
    .flatMap((option) => {
      const score = rank(option, wanted);
      return score === null ? [] : [{ option, score }];
    })
    .sort((a, b) => a.score - b.score)
    .map(({ option }) => option);
}

const coarsePointer = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Picks one of a list of options, narrowed by a search. It takes the place of a native
 * select menu where the list is long enough to need searching.
 */
export function SearchSelectDialog({
  open,
  onOpenChange,
  title,
  onCloseAutoFocus,
  ...list
}: DialogProps) {
  useBackHandler(open, () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-search-select
        aria-describedby={undefined}
        showCloseButton={false}
        // Above the tag form and the note it may be opened from.
        overlayClassName="z-[90]"
        // On touch it sits above the keyboard, which covers the page instead of resizing it.
        className="z-[90] flex max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-1.5rem)] flex-col gap-3 p-4 sm:max-w-sm pointer-coarse:top-auto pointer-coarse:bottom-[calc(var(--keyboard)+var(--safe-bottom)+0.75rem)] pointer-coarse:translate-y-0"
        onOpenAutoFocus={(event) => {
          // A long list is easier to scroll than to search with the keyboard over half of
          // it, so touch leaves the field until it is tapped.
          if (!coarsePointer()) return;
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        // React hands a portal's events to its parents in the tree: the quick note would
        // take this Escape as its own, and the tag form this Enter.
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DialogTitle className="px-1 text-base">{title}</DialogTitle>
        <Options
          title={title}
          {...list}
          onChange={(value) => {
            list.onChange(value);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function Options({
  title,
  searchLabel,
  emptyText,
  options,
  value,
  onChange,
}: Omit<DialogProps, 'open' | 'onOpenChange' | 'onCloseAutoFocus'>) {
  const id = useId();
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => searchOptions(options, query), [options, query]);
  const searching = plain(query) !== '';
  // The option Enter takes: the chosen one, or the best match once there is a search.
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const activeOption = shown[Math.min(active, shown.length - 1)];

  // Opens with the chosen option in the middle of the list rather than at its far end. Moving
  // the list itself keeps the page behind it from scrolling, as scrollIntoView would.
  useLayoutEffect(() => {
    const box = list.current;
    const chosen = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (box && chosen) {
      box.scrollTop =
        chosen.offsetTop - box.offsetTop - (box.clientHeight - chosen.offsetHeight) / 2;
    }
  }, []);

  function move(to: number) {
    if (!shown.length) return;
    const next = Math.min(Math.max(to, 0), shown.length - 1);
    setActive(next);
    const box = list.current;
    const row = box?.querySelectorAll('[role="option"]')[next];
    if (!box || !(row instanceof HTMLElement)) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + row.offsetHeight - box.clientHeight;
    }
  }

  const choose = (option: SelectOption) => {
    haptics.selection();
    onChange(option.value);
  };

  return (
    <>
      <label className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-foreground/[0.06] px-3 focus-within:ring-2 focus-within:ring-ring/70 focus-within:ring-inset">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          role="combobox"
          aria-label={searchLabel}
          aria-expanded
          aria-controls={`${id}-list`}
          aria-activedescendant={activeOption ? `${id}-${activeOption.value}` : undefined}
          aria-autocomplete="list"
          placeholder="Search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            if (list.current) list.current.scrollTop = 0;
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') move(active + 1);
            else if (event.key === 'ArrowUp') move(active - 1);
            else if (event.key === 'Home') move(0);
            else if (event.key === 'End') move(shown.length - 1);
            else if (event.key === 'Enter') {
              if (activeOption) choose(activeOption);
            } else return;
            event.preventDefault();
          }}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <div ref={list} className="h-72 min-h-24 shrink overflow-y-auto overscroll-contain">
        <div id={`${id}-list`} role="listbox" aria-label={title}>
          {shown.map((option) => {
            const selected = option.value === value;
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the search field holds focus and takes the keys for the list
              <div
                key={option.value}
                id={`${id}-${option.value}`}
                role="option"
                tabIndex={-1}
                aria-selected={selected}
                data-active={option === activeOption || undefined}
                onClick={() => choose(option)}
                style={{
                  paddingLeft: searching
                    ? undefined
                    : `${0.75 + Math.min(option.depth ?? 0, 8) * 0.75}rem`,
                }}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-sm outline-none transition-colors duration-200',
                  selected
                    ? 'glass-chosen'
                    : 'hover:bg-foreground/[0.06] data-active:bg-foreground/[0.06]',
                )}
              >
                {option.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.detail && (
                    <span
                      className={cn('block truncate text-xs', !selected && 'text-muted-foreground')}
                    >
                      {option.detail}
                    </span>
                  )}
                </span>
                {selected && <Check className="size-4 shrink-0" aria-hidden />}
              </div>
            );
          })}
        </div>
        {shown.length === 0 && (
          <p role="status" className="px-3 py-6 text-center text-muted-foreground text-sm">
            {emptyText}
          </p>
        )}
      </div>
    </>
  );
}

type Props = Omit<DialogProps, 'open' | 'onOpenChange'> & {
  /** The id of the text that names the field, read with the chosen option. */
  labelId: string;
  className?: string;
};

/** A form field that shows the chosen option and opens the searchable list to change it. */
export function SearchSelect({ labelId, className, ...dialog }: Props) {
  const valueId = useId();
  const [open, setOpen] = useState(false);
  const chosen = dialog.options.find((option) => option.value === dialog.value);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => {
          haptics.toggle();
          setOpen(true);
        }}
        className={cn(
          'flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-input bg-background px-3 text-left font-normal text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        {chosen?.icon}
        <span id={valueId} className="min-w-0 flex-1 truncate">
          {chosen?.label}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <SearchSelectDialog open={open} onOpenChange={setOpen} {...dialog} />
    </>
  );
}
