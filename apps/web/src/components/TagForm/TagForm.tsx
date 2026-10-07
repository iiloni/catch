import { TAG_ICONS, type Tag, tagPath, tagSchema, tagSubtreeIds, tagTree } from '@catch/shared';
import { Plus, X } from 'lucide-react';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { COLOR_NAMES, ColorSwatches } from '@/components/ColorPicker/ColorPicker';
import { SearchSelect, type SelectOption } from '@/components/SearchSelect/SearchSelect';
import { TAG_ICON_LABELS, TagIcon } from '@/components/TagIcon/TagIcon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { getSignedInUser } from '@/lib/auth';
import { useBackHandler } from '@/lib/backButton';
import { useTags } from '@/lib/collections';
import { tagFormOpen } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { createTag, updateTag } from '@/lib/tags';
import { cn } from '@/lib/utils';

/** Creates a tag, or edits `initial.tag`. */
export function TagForm({
  userId,
  tags,
  initial,
  onDone,
  onCreated,
}: {
  userId: string;
  tags: readonly Tag[];
  initial: { tag?: Tag; parentId: string | null };
  onDone: () => void;
  onCreated?: (id: string) => void;
}) {
  const nameId = useId();
  const parentLabelId = useId();
  useBackHandler(true, onDone);
  useEffect(() => {
    tagFormOpen.set(true);
    return () => tagFormOpen.set(false);
  }, []);
  const [name, setName] = useState(initial.tag?.name ?? '');
  const [parentId, setParentId] = useState(initial.parentId);
  const [icon, setIcon] = useState<Tag['icon']>(initial.tag?.icon ?? null);
  const [color, setColor] = useState<Tag['color']>(initial.tag?.color ?? null);
  const [iconSearch, setIconSearch] = useState('');
  const [error, setError] = useState('');
  // A tag cannot go under itself or its own branch.
  const parents = useMemo(() => {
    const excluded = initial.tag ? tagSubtreeIds(tags, initial.tag.id) : new Set<string>();
    const options: SelectOption[] = [{ value: '', label: 'Top level' }];
    for (const { tag, depth } of tagTree(tags)) {
      if (excluded.has(tag.id)) continue;
      const path = tagPath(tags, tag.id);
      const root = path[0];
      options.push({
        value: tag.id,
        label: tag.name,
        detail:
          path
            .slice(0, -1)
            .map((ancestor) => ancestor.name)
            .join(' / ') || undefined,
        keywords: [path.map((ancestor) => ancestor.name).join(' / ')],
        depth,
        icon: (
          <span
            data-note-color={root?.color ?? 'default'}
            className={root?.color ? 'text-note-icon' : 'text-muted-foreground'}
          >
            <TagIcon name={root?.icon} className="size-4 shrink-0" />
          </span>
        ),
      });
    }
    return options;
  }, [tags, initial.tag]);
  const usedColors = new Set(
    tags
      .filter((tag) => tag.id !== initial.tag?.id)
      .flatMap((tag) => (tag.color ? [tag.color] : [])),
  );
  function save(event: FormEvent) {
    event.preventDefault();
    const values = {
      name: name.trim(),
      parentId,
      icon: parentId ? null : icon,
      color: parentId ? null : color,
    };
    const valid = tagSchema.omit({ id: true, userId: true }).safeParse(values);
    if (!valid.success) {
      setError(valid.error.issues[0]?.message ?? 'Check the tag details');
      return;
    }
    if (values.color && usedColors.has(values.color)) {
      setError('That color is already linked to another tag.');
      return;
    }
    if (initial.tag) updateTag(initial.tag.id, values);
    else {
      const { id } = createTag(userId, values);
      onCreated?.(id);
    }
    haptics.success();
    onDone();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          if (initial.tag) event.preventDefault();
        }}
        // Above the dock, whose pickers open this form.
        overlayClassName="z-[80]"
        className="z-[80] top-auto bottom-[calc(var(--keyboard)+var(--safe-bottom)+0.75rem)] max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-1.5rem)] translate-y-0 overflow-y-auto overscroll-contain p-5 sm:max-w-md"
      >
        <DialogTitle>{initial.tag ? 'Edit tag' : 'New tag'}</DialogTitle>
        <DialogDescription>
          {parentId
            ? 'This tag inherits its branch’s icon and color.'
            : 'Link a color to tag existing notes of that color that have no primary tag.'}
        </DialogDescription>
        <form onSubmit={save} className="flex flex-col gap-4">
          <label htmlFor={nameId} className="flex flex-col gap-1.5 text-sm font-medium">
            Name
            <Input
              id={nameId}
              value={name}
              maxLength={100}
              required
              onChange={(event) => setName(event.target.value)}
              className="h-11 rounded-xl"
            />
          </label>
          <div className="flex flex-col gap-1.5 text-sm font-medium">
            <span id={parentLabelId}>Parent tag</span>
            <SearchSelect
              labelId={parentLabelId}
              title="Parent tag"
              searchLabel="Search tags"
              emptyText="No tag matches."
              options={parents}
              value={parentId ?? ''}
              onChange={(value) => setParentId(value || null)}
            />
          </div>
          {!parentId && (
            <>
              <fieldset className="min-w-0">
                <legend className="mb-2 text-sm font-medium">Color</legend>
                <ColorSwatches
                  value={color ?? 'default'}
                  onChange={(value) => {
                    if (value !== 'default' && usedColors.has(value)) {
                      setError(`${COLOR_NAMES[value]} is already linked to another tag.`);
                      return;
                    }
                    setColor(value === 'default' ? null : value);
                    setError('');
                  }}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {color ? COLOR_NAMES[color] : 'No color'} · Each color can be linked to one
                  top-level tag.
                </p>
              </fieldset>
              <fieldset className="min-w-0">
                <legend className="mb-2 text-sm font-medium">Icon</legend>
                <Input
                  aria-label="Find icons"
                  placeholder="Find icons"
                  value={iconSearch}
                  onChange={(event) => setIconSearch(event.target.value)}
                  className="mb-2 h-10 rounded-xl"
                />
                <div className="grid max-h-36 grid-cols-7 gap-1 overflow-y-auto overscroll-contain p-1">
                  <button
                    type="button"
                    aria-label="No icon"
                    aria-pressed={icon === null}
                    onClick={() => setIcon(null)}
                    className={cn(
                      'flex size-10 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      icon === null && 'bg-brand/20',
                    )}
                  >
                    <X className="size-4" />
                  </button>
                  {TAG_ICONS.filter(
                    (value) =>
                      TAG_ICON_LABELS[value].toLowerCase().includes(iconSearch.toLowerCase()) ||
                      value.replaceAll('-', ' ').includes(iconSearch.toLowerCase()),
                  ).map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-label={TAG_ICON_LABELS[value]}
                      aria-pressed={icon === value}
                      title={TAG_ICON_LABELS[value]}
                      onClick={() => setIcon(value)}
                      className={cn(
                        'flex size-10 items-center justify-center rounded-xl outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring',
                        icon === value && 'bg-brand/20',
                      )}
                    >
                      <TagIcon name={value} className="size-5" />
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" className="h-11 rounded-full" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 rounded-full">
              Save tag
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Opens the form for a new tag from a picker, which then assigns the tag it made. */
export function NewTagButton({
  parentId = null,
  onCreated,
  disabled,
  className,
}: {
  parentId?: string | null;
  onCreated?: (id: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const tags = useTags();
  const [open, setOpen] = useState(false);
  const userId = getSignedInUser()?.id;
  return (
    <>
      <button
        type="button"
        aria-label="New tag"
        title="New tag"
        disabled={disabled || !userId}
        onClick={(event) => {
          event.stopPropagation();
          haptics.toggle();
          setOpen(true);
        }}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
          className,
        )}
      >
        <Plus className="size-4" aria-hidden />
      </button>
      {open && userId && (
        <TagForm
          userId={userId}
          tags={tags}
          initial={{ parentId }}
          onDone={() => setOpen(false)}
          onCreated={onCreated}
        />
      )}
    </>
  );
}
