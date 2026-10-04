import { TAG_ICONS, type Tag, tagPath, tagSchema, tagSubtreeIds, tagTree } from '@catch/shared';
import { MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { COLOR_NAMES, ColorSwatches } from '@/components/ColorPicker/ColorPicker';
import { IconButton } from '@/components/IconButton/IconButton';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { TAG_ICON_LABELS, TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useSyncedNotes, useTagReadiness, useTags } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { createTag, deleteTag, updateTag } from '@/lib/tags';
import { cn } from '@/lib/utils';

export function TagSettings({ userId }: { userId: string }) {
  const tags = useTags();
  // Hierarchy edits also change notes and assignments, even on a direct settings load.
  useSyncedNotes();
  useTagReadiness();
  const [editing, setEditing] = useState<{ tag?: Tag; parentId: string | null } | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Tags"
        description="A note’s primary tag sets its color. Secondary tags add context."
      >
        <SettingsRow label="Your tags" description="Children inherit color and icon">
          <Button
            variant="secondary"
            className="h-11 rounded-xl"
            onClick={() => setEditing({ parentId: null })}
          >
            <Plus />
            New tag
          </Button>
        </SettingsRow>
        <div className="p-3">
          {!tags.length ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              Create your first tag, then add children to group related topics.
            </p>
          ) : (
            <TagTree
              estimatedRowHeight={48}
              tags={tags}
              renderTag={(tag, path) => {
                const root = path[0] ?? tag;
                return (
                  <>
                    <button
                      type="button"
                      aria-label={`Edit ${tag.name}`}
                      title={path.map((ancestor) => ancestor.name).join(' / ')}
                      onClick={() => setEditing({ tag, parentId: tag.parentId })}
                      className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        data-note-color={root.color ?? 'default'}
                        className={root.color ? 'text-note-icon' : 'text-muted-foreground'}
                      >
                        <TagIcon name={root.icon} className="size-4 shrink-0" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{tag.name}</span>
                      {!tag.parentId && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {root.color ? COLOR_NAMES[root.color] : 'No color'}
                        </span>
                      )}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          label={`Manage ${tag.name}`}
                          className="size-11 shrink-0 rounded-xl"
                        >
                          <MoreHorizontal />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="min-h-11"
                          onSelect={() => setEditing({ parentId: tag.id })}
                        >
                          <Plus />
                          Add child to {tag.name}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="min-h-11"
                          onSelect={() => setEditing({ tag, parentId: tag.parentId })}
                        >
                          <Pencil />
                          Edit {tag.name}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="min-h-11 text-destructive"
                          onSelect={() => setDeleting(tag)}
                        >
                          <Trash2 />
                          Delete {tag.name}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                );
              }}
            />
          )}
        </div>
      </SettingsSection>
      {editing && (
        <TagForm
          key={editing.tag?.id ?? editing.parentId ?? 'new'}
          userId={userId}
          tags={tags}
          initial={editing}
          onDone={() => setEditing(null)}
        />
      )}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Delete {deleting?.name}?</DialogTitle>
          <DialogDescription>
            {deleting && tagSubtreeIds(tags, deleting.id).size > 1
              ? 'This tag and all its children will be removed from your notes.'
              : 'This tag will be removed from your notes.'}{' '}
            Your notes will be kept.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) deleteTag(deleting.id);
                haptics.warning();
                setDeleting(null);
              }}
            >
              Delete tag
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TagForm({
  userId,
  tags,
  initial,
  onDone,
}: {
  userId: string;
  tags: readonly Tag[];
  initial: { tag?: Tag; parentId: string | null };
  onDone: () => void;
}) {
  const nameId = useId();
  const [name, setName] = useState(initial.tag?.name ?? '');
  const [parentId, setParentId] = useState(initial.parentId);
  const [icon, setIcon] = useState<Tag['icon']>(initial.tag?.icon ?? null);
  const [color, setColor] = useState<Tag['color']>(initial.tag?.color ?? null);
  const [iconSearch, setIconSearch] = useState('');
  const [error, setError] = useState('');
  const excluded = initial.tag ? tagSubtreeIds(tags, initial.tag.id) : new Set<string>();
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
    else createTag(userId, values);
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
        className="top-auto bottom-[calc(var(--keyboard)+var(--safe-bottom)+0.75rem)] max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-1.5rem)] translate-y-0 overflow-y-auto overscroll-contain p-5 sm:max-w-md"
      >
        <DialogTitle>{initial.tag ? 'Edit tag' : 'New tag'}</DialogTitle>
        <DialogDescription>
          {parentId
            ? 'This tag inherits its branch’s icon and color.'
            : 'Link a color to tag all existing notes of that color.'}
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
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Parent tag
            <select
              value={parentId ?? ''}
              onChange={(event) => setParentId(event.target.value || null)}
              className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Top level</option>
              {tagTree(tags)
                .filter(({ tag }) => !excluded.has(tag.id))
                .map(({ tag }) => (
                  <option key={tag.id} value={tag.id}>
                    {tagPath(tags, tag.id)
                      .map((ancestor) => ancestor.name)
                      .join(' / ')}
                  </option>
                ))}
            </select>
          </label>
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
