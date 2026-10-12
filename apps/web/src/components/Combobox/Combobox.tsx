import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { haptics } from '@/lib/haptics';
import { keyboardHeight } from '@/lib/keyboard';
import { cn } from '@/lib/utils';

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Suggested values. Any other text may still be typed. */
  options: readonly string[];
  /** Names the list of suggestions, such as "Discovered models". */
  listLabel: string;
  placeholder?: string;
};

/** A text field that suggests values in a list under it, without limiting what is typed. */
export function Combobox({ id, value, onChange, options, listLabel, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Typing narrows the list; a value picked from it, or there before, shows them all.
  const [narrowing, setNarrowing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();
  const shown = useMemo(() => {
    const wanted = value.trim().toLowerCase();
    if (!narrowing || !wanted) return options;
    return options.filter((option) => option.toLowerCase().includes(wanted));
  }, [options, value, narrowing]);
  const expanded = open && shown.length > 0;
  const offered = useRef(options);
  useEffect(() => {
    // Suggestions that have just arrived are shown, rather than waiting to be asked for.
    if (offered.current !== options && options.length > 0) {
      setNarrowing(false);
      setOpen(true);
    }
    offered.current = options;
  }, [options]);

  function pick(option: string) {
    haptics.selection();
    onChange(option);
    setNarrowing(false);
    setOpen(false);
    setActive(-1);
  }

  return (
    <Popover open={expanded} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded={expanded}
            aria-controls={list}
            aria-autocomplete="list"
            aria-activedescendant={expanded && active >= 0 ? `${list}-${active}` : undefined}
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            className={options.length > 0 ? 'pr-9' : undefined}
            onChange={(event) => {
              onChange(event.target.value);
              setNarrowing(true);
              setActive(-1);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (shown.length === 0) return;
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setActive(expanded ? (active + step + shown.length) % shown.length : 0);
                setOpen(true);
              } else if (event.key === 'Enter' && expanded && shown[active]) {
                event.preventDefault();
                pick(shown[active]);
              } else if (event.key === 'Escape' && expanded) {
                event.preventDefault();
                setOpen(false);
              }
            }}
          />
          {options.length > 0 && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={listLabel}
              aria-expanded={expanded}
              // Focus stays in the field, so the on-screen keyboard neither opens nor closes.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                setNarrowing(false);
                setOpen(!expanded);
              }}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-md text-muted-foreground outline-none"
            >
              <ChevronDown
                className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                aria-hidden
              />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        collisionPadding={{ top: 8, bottom: keyboardHeight.get() + 8 }}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // The field and its button open and close the list themselves.
          if (event.target instanceof Node && input.current?.parentElement?.contains(event.target))
            event.preventDefault();
        }}
        className="max-h-[min(18rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) overflow-y-auto p-1"
      >
        <div id={list} role="listbox" aria-label={listLabel} className="flex flex-col">
          {shown.map((option, index) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the field holds focus and takes the keys
            <div
              key={option}
              id={`${list}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={option === value}
              data-active={index === active || undefined}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(index)}
              onClick={() => pick(option)}
              className="flex min-h-10 cursor-default items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm data-active:bg-foreground/[0.08]"
            >
              <span className="min-w-0 break-all">{option}</span>
              {option === value && <Check className="size-4 shrink-0" aria-hidden />}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
