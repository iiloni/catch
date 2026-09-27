import { Check, Square } from 'lucide-react';
import type { ReactNode } from 'react';
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

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;

function renderInline(content: unknown, key = 0): ReactNode {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item, index) => renderInline(item, index));
  if (!isObject(content)) return null;

  // Cards are buttons, so links render as text here; they are clickable in the editor.
  if (content.type === 'link') {
    return (
      <span key={key} data-href={String(content.href)} className="underline underline-offset-2">
        {renderInline(content.content)}
      </span>
    );
  }
  if (typeof content.text !== 'string') return null;

  const styles = isObject(content.styles) ? content.styles : {};
  return (
    <span
      key={key}
      className={cn(
        Boolean(styles.bold) && 'font-semibold',
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
}: {
  block: Json;
  isTitle: boolean;
  variant: Variant;
}) {
  const props = isObject(block.props) ? block.props : {};
  const children = Array.isArray(block.children) ? block.children.filter(isObject) : [];
  const inline = renderInline(block.content);

  let body: ReactNode;
  switch (block.type) {
    case 'heading':
      body = isTitle ? (
        <h3
          className={cn(
            variant === 'card'
              ? 'font-display font-semibold text-[0.9375rem] leading-snug tracking-[-0.01em]'
              : 'font-bold font-display text-[1.3em] leading-normal tracking-[-0.01em]',
          )}
        >
          {inline}
        </h3>
      ) : (
        <p className="font-semibold">{inline}</p>
      );
      break;
    case 'checkListItem': {
      const Icon = props.checked ? Check : Square;
      body = (
        <p
          className={cn(
            'flex gap-2',
            Boolean(props.checked) && 'text-muted-foreground line-through',
          )}
        >
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{inline}</span>
        </p>
      );
      break;
    }
    case 'bulletListItem':
      body = <p className="before:mr-2 before:content-['•']">{inline}</p>;
      break;
    case 'numberedListItem':
      body = <p className="before:mr-2 before:content-['–']">{inline}</p>;
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
      body =
        typeof props.url === 'string' && props.url ? (
          <img src={props.url} alt={String(props.caption ?? '')} className="w-full rounded" />
        ) : null;
      break;
    default:
      body = inline ? <p>{inline}</p> : null;
  }

  return (
    <>
      {body}
      {children.length > 0 && (
        <div className="pl-4">
          {children.map((child, index) => (
            <PreviewBlock
              key={String(child.id ?? index)}
              block={child}
              isTitle={false}
              variant={variant}
            />
          ))}
        </div>
      )}
    </>
  );
}

function isEmptyBlock(block: Json) {
  const children = Array.isArray(block.children) ? block.children : [];
  const empty = Array.isArray(block.content) ? block.content.length === 0 : !block.content;
  return empty && children.length === 0 && block.type !== 'image';
}

/** Read-only rendering of a BlockNote document, light enough for a grid of cards. */
export function NotePreview({ content, maxBlocks = 10, variant = 'card', className }: Props) {
  const blocks = content.filter((block) => !isEmptyBlock(block));
  const shown = blocks.slice(0, maxBlocks);

  return (
    <div
      className={cn(
        'flex flex-col break-words',
        variant === 'card'
          ? 'gap-1 text-sm leading-snug'
          : 'note-preview-editor text-base leading-6 [&>*]:py-[3px]',
        className,
      )}
    >
      {shown.map((block, index) => (
        <PreviewBlock
          key={String(block.id ?? index)}
          block={block}
          isTitle={index === 0 && block.type === 'heading'}
          variant={variant}
        />
      ))}
      {blocks.length > shown.length && <p className="text-muted-foreground">…</p>}
    </div>
  );
}
