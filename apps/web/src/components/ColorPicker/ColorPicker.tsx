import type { Note } from '@catch/shared';
import { NOTE_COLORS, type NoteColor, type Tag, tagPath } from '@catch/shared';
import { Check, ChevronLeft, ChevronRight, Palette, Slash } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { type ComponentProps, useState } from 'react';
import { AnimatedHeight } from '@/components/AnimatedHeight/AnimatedHeight';
import { IconButton } from '@/components/IconButton/IconButton';
import { TagBadge } from '@/components/TagBadge/TagBadge';
import { NewTagButton } from '@/components/TagForm/TagForm';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNoteTagAssignments, useTagReadiness, useTags } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { useNoteColor } from '@/lib/tags';
import { cn } from '@/lib/utils';

export const COLOR_NAMES: Record<NoteColor, string> = {
  default: 'No color',
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
  primaryTagId?: string | null;
  onTagChange?: (id: string) => void;
};

/**
 * Every note color as a swatch, in a wrapping grid or one scrolling row. A null value
 * (notes of different colors) checks no swatch.
 */
export function ColorSwatches({
  value,
  onChange,
  layout = 'grid',
  className,
  tags = [],
  disabled = false,
}: {
  value: NoteColor | null;
  onChange: (color: NoteColor) => void;
  layout?: 'grid' | 'row';
  className?: string;
  tags?: readonly Tag[];
  disabled?: boolean;
}) {
  return (
    <fieldset
      disabled={disabled}
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
          aria-label={
            tags.find((tag) => tag.color === color)?.name
              ? `${COLOR_NAMES[color]}: ${tags.find((tag) => tag.color === color)?.name}`
              : COLOR_NAMES[color]
          }
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
          {color === 'default' ? (
            <Slash className="size-4" aria-hidden />
          ) : tags.find((tag) => tag.color === color) ? (
            <TagIcon name={tags.find((tag) => tag.color === color)?.icon} className="size-4" />
          ) : value === color ? (
            <Check className="size-4" aria-hidden />
          ) : null}
        </motion.button>
      ))}
    </fieldset>
  );
}

/** A palette button that opens the swatches in a popover. */
export function ColorPicker({ value, onChange, primaryTagId, onTagChange }: Props) {
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
        <ColorTagSelector
          value={value}
          onChange={onChange}
          primaryTagId={primaryTagId}
          onTagChange={onTagChange}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Each selection is committed before opening its children; closing keeps that selection. */
export function ColorTagSelector({
  value,
  onChange,
  primaryTagId,
  onTagChange,
  className,
  disabled,
}: Omit<Props, 'value'> & { value: NoteColor | null; className?: string; disabled?: boolean }) {
  const tags = useTags();
  const [branch, setBranch] = useState<string | 'uncolored' | null>(null);
  const [direction, setDirection] = useState(1);
  const reducedMotion = useReducedMotion();
  const { awaitingTags, awaitingAssignments } = useTagReadiness();
  const unavailable = disabled ?? (awaitingTags || awaitingAssignments);
  const selected = tags.find((tag) => tag.id === primaryTagId);
  const current = tags.find((tag) => tag.id === branch);
  const children = tags
    .filter((tag) =>
      branch === 'uncolored'
        ? tag.parentId === null && tag.color === null
        : tag.parentId === branch,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  function select(tag: Tag) {
    haptics.selection();
    if (onTagChange) onTagChange(tag.id);
    else if (tag.color) onChange(tag.color);
    if (onTagChange && tags.some((child) => child.parentId === tag.id)) {
      setDirection(1);
      setBranch(tag.id);
    }
  }
  // Tags without a color can only be primary where the picker assigns tags.
  const assignCreated = onTagChange && ((id: string) => onTagChange(id));
  const slideVariants = {
    enter: (travel: number) => ({ x: reducedMotion ? 0 : travel * 32, opacity: 0 }),
    visible: { x: 0, opacity: 1 },
    leave: (travel: number) => ({ x: reducedMotion ? 0 : -travel * 32, opacity: 0 }),
  };
  const slideTransition = { duration: reducedMotion ? 0 : 0.16 };
  return (
    <fieldset
      disabled={unavailable}
      aria-busy={unavailable}
      className={cn('min-w-0 overflow-hidden', className)}
    >
      <legend className="sr-only">Primary tag</legend>
      <AnimatedHeight>
        <AnimatePresence initial={false} mode="wait" custom={direction}>
          <PickerView
            key={branch === null ? 'colors' : 'tags'}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="visible"
            exit="leave"
            transition={slideTransition}
          >
            {branch === null ? (
              <>
                <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center px-3 pt-2">
                  <div className="col-start-2 flex min-w-0 justify-center">
                    {selected && <TagBadge tag={selected} tags={tags} primary morph />}
                  </div>
                  <NewTagButton onCreated={assignCreated} />
                </div>
                <ColorSwatches
                  tags={tags}
                  value={value}
                  onChange={(color) => {
                    const root = tags.find((tag) => tag.color === color);
                    if (root) select(root);
                    else onChange(color);
                  }}
                  className="justify-items-center p-3 [&_button]:size-10"
                />
                {onTagChange && tags.some((tag) => tag.parentId === null && tag.color === null) && (
                  <div className="px-3 pb-1">
                    <button
                      type="button"
                      onClick={() => {
                        setDirection(1);
                        setBranch('uncolored');
                      }}
                      className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-sm hover:bg-foreground/5"
                    >
                      Tags without a color
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="px-3">
                <div className="mb-2 grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center border-b border-foreground/10 pb-2">
                  <button
                    type="button"
                    aria-label="Back to parent tags"
                    onClick={() => {
                      setDirection(-1);
                      setBranch(current?.parentId ?? null);
                    }}
                    className="flex min-h-11 items-center gap-1 justify-self-start rounded-xl px-2 text-sm text-muted-foreground outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronLeft className="size-4 shrink-0" />
                    <span>Back</span>
                  </button>
                  <div className="flex min-w-0 justify-center">
                    {selected && <TagBadge tag={selected} tags={tags} primary morph />}
                  </div>
                  <NewTagButton
                    parentId={current?.id}
                    onCreated={assignCreated}
                    className="justify-self-end"
                  />
                </div>
                <div className="overflow-hidden">
                  <AnimatePresence initial={false} mode="wait" custom={direction}>
                    <PickerView
                      key={branch}
                      custom={direction}
                      variants={slideVariants}
                      initial="enter"
                      animate="visible"
                      exit="leave"
                      transition={slideTransition}
                      className="max-h-[min(20rem,40dvh)] overflow-y-auto overscroll-contain"
                    >
                      {children.map((tag) => (
                        <button
                          type="button"
                          key={tag.id}
                          aria-pressed={tag.id === primaryTagId}
                          onClick={() => select(tag)}
                          className={cn(
                            'flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring',
                            tag.id === primaryTagId && 'bg-foreground/[0.08] font-medium',
                          )}
                        >
                          <TagIcon
                            name={tagPath(tags, tag.id)[0]?.icon}
                            className="size-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                          {tag.id === primaryTagId && <Check className="size-4 shrink-0" />}
                          {tags.some((child) => child.parentId === tag.id) && (
                            <ChevronRight className="size-4 shrink-0" />
                          )}
                        </button>
                      ))}
                    </PickerView>
                  </AnimatePresence>
                </div>
              </div>
            )}
          </PickerView>
        </AnimatePresence>
      </AnimatedHeight>
    </fieldset>
  );
}

export function NoteColorPicker({
  note,
  onChange,
  onTagChange,
}: {
  note: Note;
  onChange: (color: NoteColor) => void;
  onTagChange: (id: string) => void;
}) {
  const value = useNoteColor(note);
  const primaryTagId = useNoteTagAssignments().get(note.id)?.primaryTagId;
  return (
    <ColorPicker
      value={value}
      primaryTagId={primaryTagId}
      onChange={onChange}
      onTagChange={onTagChange}
    />
  );
}

function PickerView(props: ComponentProps<typeof motion.div>) {
  const isPresent = useIsPresent();
  return <motion.div {...props} inert={!isPresent} aria-hidden={!isPresent} />;
}
