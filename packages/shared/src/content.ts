type Json = Record<string, unknown>;

const MEDIA_BLOCKS = new Set(['image', 'video', 'audio', 'file']);

/** Blocks a card shows of a note with no preview cutoff. */
export const CARD_BLOCKS = 10;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null;
}

const childBlocks = (block: Json) =>
  Array.isArray(block.children) ? block.children.filter(isObject) : [];

function inlineHasContent(content: unknown): boolean {
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) return content.some(inlineHasContent);
  if (!isObject(content)) return false;
  if (content.type === 'link') return true;
  if (typeof content.text === 'string') return content.text.trim().length > 0;
  if (Array.isArray(content.rows)) {
    return content.rows.some(
      (row) => isObject(row) && Array.isArray(row.cells) && row.cells.some(inlineHasContent),
    );
  }
  return inlineHasContent(content.content);
}

/**
 * Whether a BlockNote document holds anything worth saving: non-blank text, a
 * link, or a media block with a URL. Empty headings and paragraphs do not count.
 */
export function blocksHaveContent(blocks: readonly Json[] | undefined): boolean {
  if (!blocks) return false;
  return blocks.some((block) => {
    if (MEDIA_BLOCKS.has(String(block.type))) {
      const props = isObject(block.props) ? block.props : {};
      if (typeof props.url === 'string' && props.url.trim()) return true;
    }
    if (inlineHasContent(block.content)) return true;
    return blocksHaveContent(childBlocks(block));
  });
}

/**
 * The marker that ends a note's card (ADR 0024): a divider with a prop, so a client that
 * predates it loads an ordinary divider where a new block type would stop the note opening.
 */
export function isPreviewCutoff(block: Json) {
  return block.type === 'divider' && isObject(block.props) && block.props.previewEnd === true;
}

/** A note as it reads without its preview cutoff, for anyone who never sees its card. */
export function withoutPreviewCutoff(blocks: readonly Json[]): Json[] {
  return blocks
    .filter((block) => !isPreviewCutoff(block))
    .map((block) =>
      Array.isArray(block.children)
        ? { ...block, children: withoutPreviewCutoff(childBlocks(block)) }
        : block,
    );
}

type Split = { before: Json[]; after: Json[] };

/** Divides a document at its first cutoff in reading order, at any depth. */
function splitAtCutoff(blocks: readonly Json[]): Split | null {
  for (const [index, block] of blocks.entries()) {
    if (isPreviewCutoff(block)) {
      return { before: blocks.slice(0, index), after: blocks.slice(index + 1) };
    }
    const split = splitAtCutoff(childBlocks(block));
    if (split) {
      return {
        before: [...blocks.slice(0, index), { ...block, children: split.before }],
        after: [...split.after, ...blocks.slice(index + 1)],
      };
    }
  }
  return null;
}

function isEmptyBlock(block: Json) {
  const empty = Array.isArray(block.content) ? block.content.length === 0 : !block.content;
  return empty && childBlocks(block).length === 0 && !MEDIA_BLOCKS.has(String(block.type));
}

/**
 * What a note's card shows, and whether the note holds more. A cutoff replaces the block
 * limit, unless nothing is above it: a card is never blank because of its marker.
 */
export function cardBlocks(
  blocks: readonly Json[],
  limit = CARD_BLOCKS,
): { shown: Json[]; more: boolean } {
  const split = splitAtCutoff(blocks);
  const shown = split?.before.filter((block) => !isEmptyBlock(block));
  if (split && shown?.length) {
    return { shown, more: split.after.some((block) => !isEmptyBlock(block)) };
  }
  const present = blocks.filter((block) => !isEmptyBlock(block));
  return { shown: present.slice(0, limit), more: present.length > limit };
}
