import { NOTE_COLORS, type NoteColor } from '@catch/shared';
import { Check, Palette } from 'lucide-react';
import { IconButton } from '@/components/IconButton/IconButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const COLOR_NAMES: Record<NoteColor, string> = {
  default: 'Default',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  'dark-blue': 'Dark blue',
  purple: 'Purple',
  pink: 'Pink',
  brown: 'Brown',
  gray: 'Gray',
};

type Props = {
  value: NoteColor;
  onChange: (color: NoteColor) => void;
};

export function ColorPicker({ value, onChange }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Background color">
          <Palette />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        className="grid w-auto grid-cols-6 gap-1.5 p-2"
        onClick={(event) => event.stopPropagation()}
      >
        {NOTE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            data-note-color={color}
            aria-label={COLOR_NAMES[color]}
            aria-pressed={value === color}
            title={COLOR_NAMES[color]}
            onClick={() => onChange(color)}
            className={cn(
              'flex size-8 items-center justify-center rounded-full border-2 bg-note outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              value === color ? 'border-foreground' : 'border-border hover:border-foreground/60',
            )}
          >
            {value === color && <Check className="size-4" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
