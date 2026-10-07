import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { attachmentId, type Note } from '@catch/shared';

// This module loads only when the share panel offers note content.
const exporter = BlockNoteEditor.create();

function textContent(blocks: Note['content']): Note['content'] {
  return blocks.map((block) => {
    const props =
      typeof block.props === 'object' && block.props !== null
        ? (block.props as Record<string, unknown>)
        : {};
    // Device attachment references cannot be read by someone receiving a text copy.
    if (typeof props.url === 'string' && attachmentId(props.url)) {
      return { type: 'paragraph', content: String(props.caption || props.name || 'Attachment') };
    }
    return {
      ...block,
      ...(Array.isArray(block.children)
        ? { children: textContent(block.children as Note['content']) }
        : {}),
    };
  });
}

export function noteMarkdown(content: Note['content']) {
  return exporter.blocksToMarkdownLossy(textContent(content) as PartialBlock[]).trim();
}
