import {
  Archive,
  ArrowDown,
  Bell,
  ChevronLeft,
  LayoutDashboard,
  type LucideIcon,
  Palette,
  Paperclip,
  Pin,
  Share2,
  Tag,
  Tags,
  Trash2,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { NotePreview } from '@/components/NotePreview/NotePreview';

/** After the page is up and its entry animations are over. */
const START_MS = 1200;
/** How long each sample stays: several frames, so it is certain to be drawn. */
const STAGE_MS = 250;

type Stage = 'waiting' | 'note' | 'dock' | 'done';

/**
 * Draws a sample of what an opening note shows, all but invisibly, a moment after the app
 * starts.
 *
 * Why: a phone's GPU builds a pipeline the first time each kind of thing is drawn (text,
 * glass, icons, pictures in rounded boxes, ...). The first note opened after a launch drew
 * some twenty kinds for the first time, about 50 ms of building, half of it while the note
 * grew out of its card, which dropped frames in that one transition. Drawn here first, they
 * are built while nothing moves.
 *
 * How: the samples sit in a full-screen box at 1% opacity. The browser skips what cannot be
 * seen (no opacity, hidden, off screen or clipped away), so they have to be faintly there;
 * at 1% they change no pixel by more than a few levels in 255. The note and the dock go in
 * turns, which spreads the one slow frame this costs over two.
 *
 * Keeping it useful: a pipeline goes with a kind of drawing, not with its content, so one of
 * each is enough and the text is filler. When a note or its dock gains something that looks
 * new, add one here. Nothing breaks if it is left out or if a browser stops needing this:
 * the first open only goes back to building pipelines as it draws. To check, trace the
 * Android WebView during a first open and count `VulkanCreateGraphicsPipelines`.
 *
 * It names nothing a person or a test could find: no roles, labels or `data-` hooks.
 */
export function GpuWarmup({ skip = false }: { skip?: boolean }) {
  const [stage, setStage] = useState<Stage>('waiting');

  useEffect(() => {
    if (stage === 'done') return;
    const timer = setTimeout(
      () => setStage(stage === 'waiting' ? 'note' : stage === 'note' ? 'dock' : 'done'),
      stage === 'waiting' ? START_MS : STAGE_MS,
    );
    return () => clearTimeout(timer);
  }, [stage]);

  // A note that is already open has drawn all of this itself.
  if (skip || stage === 'waiting' || stage === 'done') return null;
  return (
    <div
      aria-hidden
      inert
      className="pointer-events-none fixed inset-0 z-[1] opacity-[0.01]"
      style={SAMPLE_COLORS}
    >
      {stage === 'note' ? <NoteSample /> : <DockSample />}
    </div>
  );
}

/**
 * A note's and a link's colors come from attributes the samples leave out, so they are set
 * here: with none, the surface and the link's card would have no fill to draw.
 */
const SAMPLE_COLORS = {
  '--note-bg': 'var(--card)',
  '--link-bg': 'var(--muted)',
  '--link-accent': 'var(--muted-foreground)',
} as CSSProperties;

const icon = (Icon: LucideIcon, className = 'size-6') => (
  <span className="flex size-10 items-center justify-center">
    <Icon className={className} />
  </span>
);

const text = (value: string, styles: Record<string, boolean> = {}) => ({
  type: 'text',
  text: value,
  styles,
});
const block = (type: string, content: unknown[], props: Record<string, unknown> = {}) => ({
  type,
  props,
  content,
  children: [],
});

/** One of each block and inline style the editor's stand-in draws. */
const SAMPLE_NOTE = [
  block('heading', [text('Aa Bb Cc')], { level: 3 }),
  block('paragraph', [
    text('Aa Bb Cc 123 '),
    text('Aa', { bold: true }),
    text(' Bb', { italic: true }),
    text(' Cc', { underline: true }),
    text(' Dd', { strike: true }),
    text(' Ee', { code: true }),
    { type: 'link', href: 'https://example.com', content: [text(' Ff Gg')] },
  ]),
  block('bulletListItem', [text('Aa Bb')]),
  block('numberedListItem', [text('Aa Bb')]),
  block('checkListItem', [text('Aa Bb')], { checked: false }),
  block('checkListItem', [text('Aa Bb')], { checked: true }),
  block('quote', [text('Aa Bb')]),
  block('codeBlock', [text('const a = 1;')], { language: 'javascript' }),
];

/** A picture to draw: one transparent pixel, stretched by its box. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The open note: its colored surface, edge blurs, glass header, text, tags and a link. */
function NoteSample() {
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden rounded-3xl bg-note text-card-foreground">
      <div className="page-top-blur absolute inset-x-0 top-0 z-10 h-32" />
      <div className="page-bottom-blur absolute inset-x-0 bottom-0 z-10 h-32" />
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-[calc(var(--safe-top)+0.5rem)]">
        <div className="glass flex rounded-[var(--dock-radius)] p-1">{icon(ChevronLeft)}</div>
        <div className="glass flex items-center rounded-[var(--dock-radius)] p-1">
          {icon(Pin, 'size-6 fill-current')}
          <span className="mx-1 h-6 w-px bg-foreground/15" />
          {icon(Share2)}
          {icon(Archive)}
          <span className="text-destructive">{icon(Trash2)}</span>
        </div>
      </div>
      <div className="px-4 pt-[calc(var(--safe-top)+4rem)]">
        <NotePreview content={SAMPLE_NOTE} variant="editor" />
        <div className="flex flex-wrap items-center gap-1.5 pt-5">
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.08] px-2 py-0.5 font-medium text-xs">
            <Tag className="size-3.5" />
            Aa
          </span>
        </div>
        <LinkCardSample />
        <p className="pt-6 text-center text-muted-foreground text-xs">Aa 12:34</p>
      </div>
    </div>
  );
}

/** A link's card below the note: a tinted, ringed card with a cropped picture and a favicon. */
function LinkCardSample() {
  return (
    <div className="mt-5 flex min-w-0 items-center gap-3 rounded-2xl bg-link p-2 shadow-[0_1px_2px_oklch(0_0_0/0.06)] ring-1 ring-foreground/[0.06] ring-inset">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-link-accent/12">
        <img alt="" className="size-full object-cover" src={PIXEL} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="line-clamp-2 font-medium text-sm leading-snug">Aa Bb Cc</p>
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <img alt="" className="size-3.5 rounded-[4px] object-contain" src={PIXEL} />
          <span className="truncate">aa.bb</span>
        </p>
      </div>
    </div>
  );
}

const toolbarButton = (Icon: LucideIcon): ReactNode => (
  <span className="flex items-center justify-center text-foreground/80">
    <Icon className="size-6" />
  </span>
);

/** The dock under a note: its toolbar, the link tray tucked behind it and the button above. */
function DockSample() {
  return (
    <div className="absolute inset-x-3 bottom-[var(--dock-bottom)]">
      <div className="relative isolate mx-auto max-w-md">
        <div className="-z-10 absolute inset-x-0 bottom-[calc(100%-0.75rem)] flex flex-col">
          <div className="glass-thick mx-3 flex h-14 items-center gap-2 rounded-t-[var(--dock-radius)] border-b-0 px-4 pb-3 text-sm">
            <img alt="" className="size-4.5 shrink-0 rounded-[4px] object-contain" src={PIXEL} />
            <span className="min-w-0 flex-1 truncate font-medium">Aa Bb Cc</span>
            <span className="shrink-0 font-medium text-muted-foreground tabular-nums">+1</span>
          </div>
        </div>
        <div className="-translate-y-11 absolute right-0 bottom-full mb-3">
          <div className="glass flex rounded-[var(--dock-radius)] p-1">
            {icon(ArrowDown, 'size-5')}
          </div>
        </div>
        <div className="glass relative grid h-[var(--dock-height)] auto-cols-fr grid-flow-col gap-1 rounded-[var(--dock-radius)] p-1">
          {toolbarButton(Palette)}
          {toolbarButton(Tags)}
          {toolbarButton(Paperclip)}
          {toolbarButton(LayoutDashboard)}
          {toolbarButton(Bell)}
        </div>
      </div>
    </div>
  );
}
