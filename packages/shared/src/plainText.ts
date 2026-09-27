type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null;
}

function inlineText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    // Table blocks hold rows of cells, each cell being inline content.
    if (isObject(content) && Array.isArray(content.rows)) {
      return content.rows
        .flatMap((row) => (isObject(row) && Array.isArray(row.cells) ? row.cells : []))
        .map((cell) => inlineText(Array.isArray(cell) || !isObject(cell) ? cell : cell.content))
        .filter(Boolean)
        .join(' ');
    }
    return '';
  }
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!isObject(item)) return '';
      if (typeof item.text === 'string') return item.text;
      return inlineText(item.content);
    })
    .join('');
}

/** Flattens a BlockNote document into plain text, one block per line. */
export function blocksToPlainText(blocks: readonly Json[]): string {
  const lines: string[] = [];
  const visit = (block: Json) => {
    const text = inlineText(block.content).trim();
    if (text) lines.push(text);
    if (Array.isArray(block.children)) {
      for (const child of block.children) if (isObject(child)) visit(child);
    }
  };
  for (const block of blocks) visit(block);
  return lines.join('\n');
}
