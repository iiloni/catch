import {
  type BoardColumn,
  blocksToPlainText,
  comparePositions,
  type Note,
  type NoteTags,
  type Tag,
  tagColor,
  tagPath,
  type WidgetSnapshot,
} from '@catch/shared';

/** Small text previews retain checklist state without handing native code BlockNote JSON. */
export function widgetText(content: Note['content']) {
  const lines: string[] = [];
  let length = 0;
  const visit = (blocks: Note['content']) => {
    for (const block of blocks) {
      if (length >= 1800) break;
      const text = blocksToPlainText([{ ...block, children: [] }]);
      const props = block.props;
      const checked =
        typeof props === 'object' && props !== null && 'checked' in props && props.checked === true;
      if (text) {
        const line = block.type === 'checkListItem' ? `${checked ? '☑' : '☐'} ${text}` : text;
        lines.push(...line.split('\n'));
        length += line.length;
      }
      if (Array.isArray(block.children)) {
        visit(
          block.children.filter(
            (child): child is Record<string, unknown> =>
              typeof child === 'object' && child !== null,
          ),
        );
      }
    }
  };
  visit(content);
  // A checklist without a heading keeps its first item in the body.
  const heading = lines[0] && !/^[☐☑]/u.test(lines[0]) ? lines.shift() : undefined;
  return {
    title: (heading || 'Untitled note').slice(0, 160),
    body: [heading?.slice(160) ?? '', ...lines].filter(Boolean).join('\n').slice(0, 1600),
  };
}

/** Call only with ordinary owned collections: the vault view and shared copies stay out. */
export function widgetSnapshot(
  account: string,
  notes: readonly Note[],
  tags: readonly Tag[],
  assignments: readonly NoteTags[],
  columns: readonly BoardColumn[],
): WidgetSnapshot {
  const ownedTags = tags.filter((tag) => tag.userId === account);
  const byNote = new Map(
    assignments.filter((item) => item.userId === account).map((item) => [item.id, item]),
  );
  return {
    version: 1,
    notes: notes
      .filter((note) => note.userId === account && !note.deletedAt && !note.isArchived)
      .sort(
        (a, b) =>
          Number(b.isPinned) - Number(a.isPinned) ||
          comparePositions(a.position, b.position) ||
          comparePositions(a.id, b.id),
      )
      .map((note) => {
        const assignment = byNote.get(note.id);
        const ids = [assignment?.primaryTagId, ...(assignment?.secondaryTagIds ?? [])].filter(
          (id): id is string => Boolean(id),
        );
        return {
          id: note.id,
          ...widgetText(note.content),
          color: assignment?.primaryTagId
            ? tagColor(ownedTags, assignment.primaryTagId)
            : note.color,
          pinned: note.isPinned,
          column: note.status,
          tags: [...new Set(ids.flatMap((id) => tagPath(ownedTags, id).map((tag) => tag.id)))],
        };
      }),
    tags: ownedTags
      .map((tag) => ({
        id: tag.id,
        name: tagPath(ownedTags, tag.id)
          .map((part) => part.name)
          .join(' / '),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    columns: columns
      .filter((column) => column.userId === account)
      .sort((a, b) => comparePositions(a.position, b.position))
      .map(({ id, name }) => ({ id, name })),
  };
}
