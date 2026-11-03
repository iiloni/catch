import {
  CARD_BLOCKS,
  cardBlocks,
  isPreviewCutoff,
  REVIEW_DELETED,
  REVIEW_INSERTED,
} from '@catch/shared';
import { Copy, Download, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { MediaPreview } from '@/components/MediaPreview/MediaPreview';
import { PREVIEW_CUTOFF_LABEL } from '@/components/NoteEditor/previewCutoffLabel';
import { codeLanguageIconProps, codeLanguageName } from '@/lib/codeLanguages';
import { cn } from '@/lib/utils';

type Json = Record<string, unknown>;

type Variant = 'card' | 'editor';

type Props = {
  content: readonly Json[];
  /** Blocks shown before the preview is cut off. A card's own cutoff replaces this limit. */
  maxBlocks?: number;
  /**
   * `editor` matches BlockNote's typography, so the editor can show this while it
   * animates open and swap in the real (heavier) editor once it settles.
   */
  variant?: Variant;
  /**
   * The preview is all its reader gets, as on a share link's page (ADR 0021): links open
   * and tables are drawn, where a card or an opening editor leaves both to the editor.
   */
  reading?: boolean;
  className?: string;
};

/** A link a stranger's note may send its reader to: nothing that runs in this page. */
const opensSafely = (href: unknown): href is string =>
  typeof href === 'string' && /^(https?:\/\/|mailto:)/i.test(href);

/** BlockNote's heading sizes, by level. */
const HEADING_SIZES: Record<number, string> = { 1: '3em', 2: '2em', 3: '1.3em' };

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;

function renderInline(content: unknown, variant: Variant, key = 0, reading = false): ReactNode {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((item, index) => renderInline(item, variant, index, reading));
  if (!isObject(content)) return null;

  if (content.type === 'link' && reading && opensSafely(content.href)) {
    return (
      <a
        key={key}
        href={content.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="underline underline-offset-2"
      >
        {renderInline(content.content, variant, 0, reading)}
      </a>
    );
  }

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
  // A comparison of two versions marks the words one of them lacks (ADR 0022).
  const Run = styles[REVIEW_INSERTED] ? 'ins' : styles[REVIEW_DELETED] ? 'del' : 'span';
  return (
    <Run
      key={key}
      className={cn(
        Run === 'ins' && 'review-inserted',
        Run === 'del' && 'review-deleted',
        Boolean(styles.bold) && (variant === 'editor' ? 'font-bold' : 'font-semibold'),
        Boolean(styles.italic) && 'italic',
        Boolean(styles.underline) && 'underline',
        Boolean(styles.strike) && 'line-through',
        Boolean(styles.code) &&
          'rounded-[0.375em] bg-foreground/10 px-[0.4em] py-[0.15em] font-mono text-[0.9em]',
      )}
    >
      {content.text}
    </Run>
  );
}

function PreviewBlock({
  block,
  isTitle,
  variant,
  listIndex,
  reading,
}: {
  block: Json;
  isTitle: boolean;
  variant: Variant;
  listIndex: number;
  reading: boolean;
}) {
  const props = isObject(block.props) ? block.props : {};
  const children = Array.isArray(block.children) ? block.children.filter(isObject) : [];
  const inline = renderInline(block.content, variant, 0, reading);
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
            dir="auto"
            className="pt-[18px]! font-bold font-display leading-normal tracking-[-0.01em]"
            style={{ fontSize: HEADING_SIZES[Number(props.level)] ?? HEADING_SIZES[3] }}
          >
            {text}
          </h3>
        ) : isTitle ? (
          <h3
            dir="auto"
            className="font-display font-semibold text-[0.9375rem] leading-snug tracking-[-0.01em]"
          >
            {inline}
          </h3>
        ) : (
          <p dir="auto" className="font-semibold">
            {inline}
          </p>
        );
      break;
    case 'checkListItem': {
      body = (
        <div dir="auto" data-content-type="checkListItem" className="note-preview-checklist">
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
          <p dir="auto" data-content-type="bulletListItem" className="note-preview-list">
            <span className="note-preview-list-marker" aria-hidden>
              •
            </span>
            <span className="min-w-0 whitespace-pre-wrap">{text}</span>
          </p>
        ) : (
          <p dir="auto" className="before:me-2 before:content-['•']">
            {inline}
          </p>
        );
      break;
    case 'numberedListItem':
      body =
        variant === 'editor' ? (
          <p dir="auto" data-content-type="numberedListItem" className="note-preview-list">
            <span className="note-preview-list-marker" aria-hidden>
              {listIndex}.
            </span>
            <span className="min-w-0 whitespace-pre-wrap">{text}</span>
          </p>
        ) : (
          <p dir="auto" className="before:me-2 before:content-['–']">
            {inline}
          </p>
        );
      break;
    case 'quote':
      body = (
        <blockquote dir="auto" className="border-current/30 border-s-2 ps-2 italic">
          {inline}
        </blockquote>
      );
      break;
    case 'codeBlock':
      // Highlighting needs the editor's grammars, so previews show code in one color.
      body =
        variant === 'editor' ? (
          <div data-content-type="codeBlock" className="note-code-block">
            <div className="note-code-toolbar glass">
              <div className="note-code-language">
                <span>
                  <span
                    aria-hidden
                    className="code-language-icon"
                    {...codeLanguageIconProps(props.language)}
                  />
                  <span className="note-code-label truncate">
                    {codeLanguageName(props.language)}
                  </span>
                </span>
              </div>
              <span aria-hidden className="note-code-action">
                <Copy />
              </span>
              <span aria-hidden className="note-code-action">
                <Download />
              </span>
            </div>
            <pre>
              <code>{text}</code>
            </pre>
          </div>
        ) : (
          <pre
            dir="ltr"
            className="overflow-hidden rounded-md bg-(--code-background) p-2 font-mono text-xs"
          >
            {inline}
          </pre>
        );
      break;
    case 'image':
      if (variant === 'editor' && typeof props.url === 'string' && props.url) {
        body = (
          <div
            style={{
              width: typeof props.previewWidth === 'number' ? props.previewWidth : '100%',
              maxWidth: '100%',
              marginInlineStart: ['center', 'right'].includes(String(props.textAlignment))
                ? 'auto'
                : undefined,
              marginInlineEnd: props.textAlignment === 'center' ? 'auto' : undefined,
            }}
          >
            <MediaPreview
              url={props.url}
              name={String(props.name || '')}
              kind="image"
              editorImage
            />
            {Boolean(props.caption) && <p className="py-1 text-[0.8em]">{String(props.caption)}</p>}
          </div>
        );
        break;
      }
      body =
        typeof props.url === 'string' && props.url ? (
          <MediaPreview
            url={props.url}
            name={String(props.caption || props.name || 'Attachment')}
            kind="image"
            compact
          />
        ) : null;
      break;
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
    case 'divider':
      // A card's gaps already part its blocks.
      body =
        variant === 'card' ? null : (
          <div data-content-type="divider">
            {isPreviewCutoff(block) ? (
              <div className="note-preview-cutoff">
                <span>{PREVIEW_CUTOFF_LABEL}</span>
                <span className="note-preview-cutoff-line" />
                {!reading && (
                  <span aria-hidden className="note-checklist-delete">
                    <X />
                  </span>
                )}
              </div>
            ) : (
              <hr />
            )}
          </div>
        );
      break;
    case 'table': {
      const rows =
        reading && isObject(block.content) && Array.isArray(block.content.rows)
          ? block.content.rows.filter(isObject)
          : [];
      body = rows.length ? (
        <div className="overflow-x-auto">
          <table className="border-collapse text-start">
            <tbody>
              {rows.map((row, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a table's rows have no ids and never reorder here
                <tr key={rowIndex}>
                  {(Array.isArray(row.cells) ? row.cells : []).map((cell, cellIndex) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: as for the rows
                      key={cellIndex}
                      dir="auto"
                      className="border border-foreground/20 px-2 py-1 align-top"
                    >
                      {renderInline(isObject(cell) ? cell.content : cell, variant, 0, reading)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null;
      break;
    }
    default:
      body =
        inline || variant === 'editor' ? (
          <p dir="auto" className="whitespace-pre-wrap">
            {text}
          </p>
        ) : null;
  }

  const nested = children.length > 0 && (
    <div className={variant === 'editor' ? 'ps-6' : 'ps-4'}>
      {renderBlocks(children, variant, false, reading)}
    </div>
  );
  return variant === 'editor' ? (
    // Like the editor's blocks, so nested blocks indent from the side their parent reads from.
    <div dir="auto" className="note-preview-block" data-preview-block={block.id}>
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

function renderBlocks(
  blocks: readonly Json[],
  variant: Variant,
  topLevel: boolean,
  reading: boolean,
) {
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
        reading={reading}
      />
    );
  });
}

/** Read-only rendering of a BlockNote document, light enough for a grid of cards. */
export function NotePreview({
  content,
  maxBlocks = CARD_BLOCKS,
  variant = 'card',
  reading = false,
  className,
}: Props) {
  const { shown, more } =
    variant === 'card'
      ? cardBlocks(content, maxBlocks)
      : { shown: content.slice(0, maxBlocks), more: content.length > maxBlocks };

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
      {renderBlocks(shown, variant, true, reading)}
      {more && <p className="text-muted-foreground">…</p>}
    </div>
  );
}
