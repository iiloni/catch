type Json = Record<string, unknown>;

const MEDIA_BLOCKS = new Set(['image', 'video', 'audio', 'file']);

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null;
}

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
    return Array.isArray(block.children) && blocksHaveContent(block.children.filter(isObject));
  });
}
