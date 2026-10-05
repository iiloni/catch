import { type Tag, tagSubtreeIds } from '@catch/shared';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { COLOR_NAMES } from '@/components/ColorPicker/ColorPicker';
import { IconButton } from '@/components/IconButton/IconButton';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { TagForm } from '@/components/TagForm/TagForm';
import { TagIcon } from '@/components/TagIcon/TagIcon';
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
import { useSyncedNotes, useTagReadiness, useTags } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { deleteTag } from '@/lib/tags';

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
