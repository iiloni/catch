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

/** Plain text retains checklist state without handing native code BlockNote JSON. */
export function widgetText(content: Note['content']) {
  const lines: string[] = [];
  const visit = (blocks: Note['content']) => {
    for (const block of blocks) {
      const text = blocksToPlainText([{ ...block, children: [] }]);
      const props = block.props;
      const checked =
        typeof props === 'object' && props !== null && 'checked' in props && props.checked === true;
      if (text) {
        const line = block.type === 'checkListItem' ? `${checked ? '☑' : '☐'} ${text}` : text;
        for (const part of line.split('\n')) lines.push(part);
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
  let titleEnd = 160;
  const lastTitleUnit = heading?.charCodeAt(titleEnd - 1);
  if (
    heading &&
    heading.length > titleEnd &&
    lastTitleUnit !== undefined &&
    lastTitleUnit >= 0xd800 &&
    lastTitleUnit <= 0xdbff
  )
    titleEnd--;
  const body = [heading?.slice(titleEnd) ?? '', ...lines].filter(Boolean).join('\n');
  const sections: string[] = [];
  for (let start = 0; start < body.length; ) {
    let end = Math.min(start + 1600, body.length);
    if (end < body.length) {
      const chunk = body.slice(start, end);
      const boundary = Math.max(chunk.lastIndexOf('\n'), chunk.lastIndexOf(' '));
      if (boundary > 800) end = start + boundary + 1;
      const last = body.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
    }
    sections.push(body.slice(start, end));
    start = end;
  }
  return {
    title: (heading || 'Untitled note').slice(0, titleEnd),
    body: body.slice(0, 1600),
    ...(body.length > 1600 ? { sections } : {}),
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
