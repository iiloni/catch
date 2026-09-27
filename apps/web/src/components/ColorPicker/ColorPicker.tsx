import { NOTE_COLORS, type NoteColor } from '@catch/shared';
import { Check, Palette } from 'lucide-react';
import { motion } from 'motion/react';
import { IconButton } from '@/components/IconButton/IconButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

export const COLOR_NAMES: Record<NoteColor, string> = {
  default: 'Default',
  red: 'Red',
  orange: 'Orange',
  amber: 'Amber',
  yellow: 'Yellow',
  lime: 'Lime',
  green: 'Green',
  mint: 'Mint',
  teal: 'Teal',
  cyan: 'Cyan',
  blue: 'Blue',
  'dark-blue': 'Indigo',
  violet: 'Violet',
  purple: 'Purple',
  magenta: 'Magenta',
  pink: 'Pink',
  brown: 'Brown',
  gray: 'Gray',
};

type Props = {
  value: NoteColor;
  onChange: (color: NoteColor) => void;
};

/** Every note color as a swatch, in a wrapping grid or one scrolling row. */
export function ColorSwatches({
  value,
  onChange,
  layout = 'grid',
  className,
}: Props & { layout?: 'grid' | 'row'; className?: string }) {
  return (
    <fieldset
      className={cn(
        'min-w-0',
        layout === 'grid'
          ? 'grid grid-cols-6 gap-2'
          : '-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none]',
        className,
      )}
    >
      <legend className="sr-only">Background color</legend>
      {NOTE_COLORS.map((color) => (
        <motion.button
          key={color}
          type="button"
          data-note-color={color}
          aria-label={COLOR_NAMES[color]}
          aria-pressed={value === color}
          title={COLOR_NAMES[color]}
          whileTap={{ scale: 0.85 }}
          transition={springs.snappy}
          onClick={(event) => {
            event.stopPropagation();
            if (color !== value) haptics.selection();
            onChange(color);
          }}
          className={cn(
            'flex shrink-0 snap-start items-center justify-center rounded-full border bg-note outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            layout === 'grid' ? 'size-9' : 'size-8',
            value === color
              ? 'border-foreground/70 ring-2 ring-foreground/15'
              : 'border-foreground/10',
          )}
        >
          {value === color && <Check className="size-4" aria-hidden />}
        </motion.button>
      ))}
    </fieldset>
  );
}

/** A palette button that opens the swatches in a popover. */
export function ColorPicker({ value, onChange }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Background color">
          <Palette />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto rounded-3xl p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <ColorSwatches value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
