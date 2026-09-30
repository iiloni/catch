import type { ReactNode } from 'react';
import { MediaPreview } from '@/components/MediaPreview/MediaPreview';
import { cn } from '@/lib/utils';

type Json = Record<string, unknown>;

type Variant = 'card' | 'editor';

type Props = {
  content: readonly Json[];
  /** Blocks shown before the preview is cut off. */
  maxBlocks?: number;
  /**
   * `editor` matches BlockNote's typography, so the editor can show this while it
   * animates open and swap in the real (heavier) editor once it settles.
   */
  variant?: Variant;
  className?: string;
};

/** BlockNote's heading sizes, by level. */
const HEADING_SIZES: Record<number, string> = { 1: '3em', 2: '2em', 3: '1.3em' };

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;

function renderInline(content: unknown, variant: Variant, key = 0): ReactNode {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((item, index) => renderInline(item, variant, index));
  if (!isObject(content)) return null;

  // Cards are buttons, so links render as text here; they are clickable in the editor.
  if (content.type === 'link') {
    return (
      <span key={key} data-href={String(content.href)} className="underline underline-offset-2">
        {renderInline(content.content, variant)}
      </span>
    );
  }
  if (typeof content.text !== 'string') return null;

  const styles = isObject(content.styles) ? content.styles : {};
  return (
    <span
      key={key}
      className={cn(
        Boolean(styles.bold) && (variant === 'editor' ? 'font-bold' : 'font-semibold'),
        Boolean(styles.italic) && 'italic',
        Boolean(styles.underline) && 'underline',
        Boolean(styles.strike) && 'line-through',
        Boolean(styles.code) && 'rounded bg-foreground/10 px-1 font-mono text-[0.9em]',
      )}
    >
      {content.text}
    </span>
  );
}

function PreviewBlock({
  block,
  isTitle,
  variant,
  listIndex,
}: {
  block: Json;
  isTitle: boolean;
  variant: Variant;
  listIndex: number;
}) {
  const props = isObject(block.props) ? block.props : {};
  const children = Array.isArray(block.children) ? block.children.filter(isObject) : [];
  const inline = renderInline(block.content, variant);
  const empty = Array.isArray(block.content) ? block.content.length === 0 : !block.content;
  const text = empty && variant === 'editor' ? <br /> : inline;

  let body: ReactNode;
  switch (block.type) {
    case 'heading':
      // Set like BlockNote's headings (size by level, room above), so the editor can swap
      // in without the text moving.
      body =
        variant === 'editor' ? (
          <h3
            className="pt-[18px]! font-bold font-display leading-normal tracking-[-0.01em]"
            style={{ fontSize: HEADING_SIZES[Number(props.level)] ?? HEADING_SIZES[3] }}
          >
            {text}
          </h3>
        ) : isTitle ? (
          <h3 className="font-display font-semibold text-[0.9375rem] leading-snug tracking-[-0.01em]">
            {inline}
          </h3>
        ) : (
          <p className="font-semibold">{inline}</p>
        );
      break;
    case 'checkListItem': {
      body = (
        <div data-content-type="checkListItem" className="note-preview-checklist">
          <div className="note-checkbox-target" aria-hidden>
            <span className="note-checkbox" data-checked={Boolean(props.checked)} />
          </div>
          <p
            className={cn(
              'min-w-0 whitespace-pre-wrap',
              Boolean(props.checked) && 'text-muted-foreground line-through',
            )}
          >
            {text}
          </p>
        </div>
      );
      break;
    }
    case 'bulletListItem':
      body =
        variant === 'editor' ? (
          <p data-content-type="bulletListItem" className="note-preview-list">
            <span className="note-preview-list-marker" aria-hidden>
              •
            </span>
            <span className="min-w-0 whitespace-pre-wrap">{text}</span>
          </p>
        ) : (
          <p className="before:mr-2 before:content-['•']">{inline}</p>
        );
      break;
    case 'numberedListItem':
      body =
        variant === 'editor' ? (
          <p data-content-type="numberedListItem" className="note-preview-list">
            <span className="note-preview-list-marker" aria-hidden>
              {listIndex}.
            </span>
            <span className="min-w-0 whitespace-pre-wrap">{text}</span>
          </p>
        ) : (
          <p className="before:mr-2 before:content-['–']">{inline}</p>
        );
      break;
    case 'quote':
      body = <blockquote className="border-current/30 border-l-2 pl-2 italic">{inline}</blockquote>;
      break;
    case 'codeBlock':
      body = (
        <pre className="overflow-hidden rounded bg-foreground/10 p-2 font-mono text-xs">
          {inline}
        </pre>
      );
      break;
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
      body =
        typeof props.url === 'string' && props.url ? (
          <MediaPreview
            url={props.url}
            name={String(props.caption || props.name || 'Attachment')}
            kind={String(block.type)}
            compact={variant === 'card'}
          />
        ) : null;
      break;
    default:
      body = inline || variant === 'editor' ? <p className="whitespace-pre-wrap">{text}</p> : null;
  }

  const nested = children.length > 0 && (
    <div className={variant === 'editor' ? 'pl-6' : 'pl-4'}>
      {renderBlocks(children, variant, false)}
    </div>
  );
  return variant === 'editor' ? (
    <div className="note-preview-block" data-preview-block={block.id}>
      {body}
      {nested}
    </div>
  ) : (
    <>
      {body}
      {nested}
    </>
  );
}

function renderBlocks(blocks: readonly Json[], variant: Variant, topLevel: boolean) {
  let listIndex = 0;
  return blocks.map((block, index) => {
    const props = isObject(block.props) ? block.props : {};
    listIndex =
      block.type === 'numberedListItem'
        ? listIndex > 0
          ? listIndex + 1
          : typeof props.start === 'number'
            ? props.start
            : 1
        : 0;
    return (
      <PreviewBlock
        key={String(block.id ?? index)}
        block={block}
        isTitle={topLevel && index === 0 && block.type === 'heading'}
        variant={variant}
        listIndex={listIndex}
      />
    );
  });
}

function isEmptyBlock(block: Json) {
  const children = Array.isArray(block.children) ? block.children : [];
  const empty = Array.isArray(block.content) ? block.content.length === 0 : !block.content;
  return (
    empty &&
    children.length === 0 &&
    !['image', 'video', 'audio', 'file'].includes(String(block.type))
  );
}

/** Read-only rendering of a BlockNote document, light enough for a grid of cards. */
export function NotePreview({ content, maxBlocks = 10, variant = 'card', className }: Props) {
  const blocks = variant === 'editor' ? content : content.filter((block) => !isEmptyBlock(block));
  const shown = blocks.slice(0, maxBlocks);

  return (
    <div
      className={cn(
        'flex flex-col break-words',
        variant === 'card'
          ? 'note-preview-card gap-1 text-sm leading-snug'
          : 'note-preview-editor text-base leading-6',
        className,
      )}
    >
      {renderBlocks(shown, variant, true)}
      {blocks.length > shown.length && <p className="text-muted-foreground">…</p>}
    </div>
  );
}
