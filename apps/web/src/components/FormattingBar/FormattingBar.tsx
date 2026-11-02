import {
  Bold,
  ChevronLeft,
  ChevronRight,
  Heading,
  Italic,
  Link2,
  List,
  ListChecks,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  type LucideIcon,
  Paperclip,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type PointerEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
  BlockKind,
  EditorControls,
  FormattingState,
  TextStyle,
} from '@/components/NoteEditor/editorControls';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useToolRowScroll } from './useToolRowScroll';

type Tool =
  | { label: string; action: 'slash' }
  | { label: string; icon: LucideIcon; action: 'attachments' }
  | { label: string; icon: LucideIcon; action: 'link' }
  | { label: string; icon: LucideIcon; style: TextStyle }
  | { label: string; icon: LucideIcon; block: BlockKind }
  | { label: string; icon: LucideIcon; action: 'indent' | 'outdent' };

const TOOLS: Tool[] = [
  { label: 'Slash menu', action: 'slash' },
  { label: 'Attach files', icon: Paperclip, action: 'attachments' },
  { label: 'Bold', icon: Bold, style: 'bold' },
  { label: 'Italic', icon: Italic, style: 'italic' },
  { label: 'Underline', icon: Underline, style: 'underline' },
  { label: 'Strikethrough', icon: Strikethrough, style: 'strike' },
  { label: 'Heading', icon: Heading, block: 'heading' },
  { label: 'Bulleted list', icon: List, block: 'bulletListItem' },
  { label: 'Numbered list', icon: ListOrdered, block: 'numberedListItem' },
  { label: 'Checklist', icon: ListChecks, block: 'checkListItem' },
  { label: 'Indent', icon: ListIndentIncrease, action: 'indent' },
  { label: 'Outdent', icon: ListIndentDecrease, action: 'outdent' },
];

const noSubscribe = () => () => {};
const noState = () => null;
const HOLD_MS = 500;

function isActive(tool: Tool, state: FormattingState | null) {
  if (!state) return undefined;
  if ('style' in tool) return state.styles[tool.style];
  if ('block' in tool) return state.block === tool.block;
  return undefined;
}

/** Files and links are saved to the note, so they need no editor to have loaded yet. */
function worksWithoutEditor(tool: Tool) {
  return 'action' in tool && (tool.action === 'attachments' || tool.action === 'link');
}

function isEnabled(tool: Tool, state: FormattingState | null) {
  if (worksWithoutEditor(tool)) return true;
  if (!state) return false;
  if ('action' in tool) {
    if (tool.action === 'slash') return true;
    return tool.action === 'indent' ? state.canIndent : state.canOutdent;
  }
  return true;
}

/**
 * A scrolling row of text formatting buttons for the editor that `controls` belongs to.
 * The buttons never take focus, so the keyboard stays up while formatting. With a mouse the
 * wheel scrolls it and arrows appear at whichever ends have more tools.
 */
export function FormattingBar({
  controls,
  attachmentsOpen = false,
  onAttachments,
  onLink,
  className,
}: {
  controls: EditorControls | null;
  attachmentsOpen?: boolean;
  onAttachments?: () => void;
  onLink?: () => void;
  className?: string;
}) {
  const state = useSyncExternalStore(
    controls?.subscribe ?? noSubscribe,
    controls?.getState ?? noState,
  );

  const frame = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const { more, page } = useToolRowScroll(frame, row);

  function run(tool: Tool) {
    if ('action' in tool && tool.action === 'attachments') {
      haptics.selection();
      onAttachments?.();
      return;
    }
    if ('action' in tool && tool.action === 'link') {
      haptics.selection();
      onLink?.();
      return;
    }
    if (!controls) return;
    haptics.selection();
    if ('style' in tool) controls.toggleStyle(tool.style);
    else if ('block' in tool) controls.toggleBlock(tool.block);
    else if (tool.action === 'slash') controls.insertSlash();
    else if (tool.action === 'indent') controls.indent();
    else controls.outdent();
  }

  return (
    <div ref={frame} className="relative flex min-w-0 flex-1 items-center">
      <div
        ref={row}
        role="toolbar"
        aria-label="Formatting"
        className={cn(
          // The fades hint that the row scrolls, and only where it does: see useToolRowScroll.
          // With arrows, `--arrow-share` clears a strip of each fade for an arrow to sit in.
          '-mx-1 -my-1 flex min-w-0 scroll-px-7 items-center gap-0.5 overflow-x-auto px-1 py-1 [--arrow-share:0] [mask-image:linear-gradient(to_right,transparent_calc(var(--fade-before,0px)*var(--arrow-share)),black_calc(var(--fade-before,0px)*(1+var(--arrow-share))),black_calc(100%-var(--fade-after,0px)*(1+var(--arrow-share))),transparent_calc(100%-var(--fade-after,0px)*var(--arrow-share)))] [scrollbar-width:none] any-pointer-fine:scroll-px-14 any-pointer-fine:[--arrow-share:0.85]',
          className,
        )}
      >
        {TOOLS.flatMap((tool) =>
          onLink && 'action' in tool && tool.action === 'attachments'
            ? [tool, { label: 'Save link', icon: Link2, action: 'link' } satisfies Tool]
            : [tool],
        ).map((tool) => (
          <FormattingButton
            key={tool.label}
            tool={tool}
            active={
              'action' in tool && tool.action === 'attachments'
                ? attachmentsOpen
                : isActive(tool, state)
            }
            expanded={
              'action' in tool && tool.action === 'attachments' ? attachmentsOpen : undefined
            }
            enabled={isEnabled(tool, state)}
            onPress={() => run(tool)}
          />
        ))}
      </div>
      <ScrollArrow direction={-1} visible={more.before} onPress={page} />
      <ScrollArrow direction={1} visible={more.after} onPress={page} />
    </div>
  );
}

/**
 * For a mouse only: a finger drags the row, and Tab scrolls to the tool it lands on, which
 * is why the arrows stay out of the tab order and the accessibility tree.
 */
function ScrollArrow({
  direction,
  visible,
  onPress,
}: {
  direction: -1 | 1;
  visible: boolean;
  onPress: (direction: -1 | 1) => void;
}) {
  const Icon = direction < 0 ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-hidden
      tabIndex={-1}
      data-scroll-arrow={direction < 0 ? 'before' : 'after'}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => onPress(direction)}
      className={cn(
        'absolute inset-y-0 hidden w-6 items-center justify-center text-foreground/60 transition-opacity duration-150 hover:text-foreground any-pointer-fine:flex',
        direction < 0 ? '-left-1' : '-right-1',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function FormattingButton({
  tool,
  active,
  expanded,
  enabled,
  onPress,
}: {
  tool: Tool;
  active: boolean | undefined;
  expanded?: boolean;
  enabled: boolean;
  onPress: () => void;
}) {
  const Icon = 'icon' in tool ? tool.icon : null;
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const held = useRef(false);

  function stopHold() {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setOpen(false);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    // Keeps focus (and the keyboard) in the editor.
    event.preventDefault();
    held.current = false;
    if (event.pointerType !== 'touch' || !enabled) return;
    start.current = { x: event.clientX, y: event.clientY };
    timer.current = window.setTimeout(() => {
      held.current = true;
      setOpen(true);
    }, HOLD_MS);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (
      timer.current !== undefined &&
      Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10
    ) {
      stopHold();
    }
  }

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          aria-label={tool.label}
          aria-pressed={expanded === undefined ? active : undefined}
          aria-expanded={expanded}
          disabled={!enabled}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={stopHold}
          onPointerCancel={stopHold}
          onPointerLeave={stopHold}
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => {
            if (held.current && event.detail !== 0) {
              event.preventDefault();
              held.current = false;
              return;
            }
            onPress();
          }}
          whileTap={{ scale: 0.86 }}
          transition={springs.snappy}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-35',
            active ? 'bg-foreground/[0.12] text-foreground' : 'text-foreground/75',
          )}
        >
          {Icon ? (
            <Icon className="size-[18px]" strokeWidth={active ? 2.5 : 2} aria-hidden />
          ) : (
            <span aria-hidden className="text-xl font-semibold leading-none">
              /
            </span>
          )}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={16} className="z-[70]">
        {tool.label}
      </TooltipContent>
    </Tooltip>
  );
}
