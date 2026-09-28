import {
  Bold,
  Heading,
  Italic,
  List,
  ListChecks,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  type LucideIcon,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useSyncExternalStore } from 'react';
import type {
  BlockKind,
  EditorControls,
  FormattingState,
  TextStyle,
} from '@/components/NoteEditor/editorControls';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

type Tool =
  | { label: string; icon: LucideIcon; style: TextStyle }
  | { label: string; icon: LucideIcon; block: BlockKind }
  | { label: string; icon: LucideIcon; action: 'indent' | 'outdent' };

const TOOLS: Tool[] = [
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

function isActive(tool: Tool, state: FormattingState | null) {
  if (!state) return undefined;
  if ('style' in tool) return state.styles[tool.style];
  if ('block' in tool) return state.block === tool.block;
  return undefined;
}

function isEnabled(tool: Tool, state: FormattingState | null) {
  if (!state) return false;
  if ('action' in tool) return tool.action === 'indent' ? state.canIndent : state.canOutdent;
  return true;
}

/**
 * A scrolling row of text formatting buttons for the editor that `controls` belongs to.
 * The buttons never take focus, so the keyboard stays up while formatting.
 */
export function FormattingBar({
  controls,
  className,
}: {
  controls: EditorControls | null;
  className?: string;
}) {
  const state = useSyncExternalStore(
    controls?.subscribe ?? noSubscribe,
    controls?.getState ?? noState,
  );

  function run(tool: Tool) {
    if (!controls) return;
    haptics.selection();
    if ('style' in tool) controls.toggleStyle(tool.style);
    else if ('block' in tool) controls.toggleBlock(tool.block);
    else if (tool.action === 'indent') controls.indent();
    else controls.outdent();
  }

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className={cn(
        // The fade hints that the row scrolls when it does not fit.
        '-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto px-1 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none]',
        className,
      )}
    >
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        const active = isActive(tool, state);
        return (
          <motion.button
            key={tool.label}
            type="button"
            aria-label={tool.label}
            aria-pressed={active}
            disabled={!isEnabled(tool, state)}
            // Keeps focus (and the keyboard) in the editor.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => run(tool)}
            whileTap={{ scale: 0.86 }}
            transition={springs.snappy}
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-xl outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-35',
              active ? 'bg-foreground/[0.12] text-foreground' : 'text-foreground/75',
            )}
          >
            <Icon className="size-[18px]" strokeWidth={active ? 2.5 : 2} aria-hidden />
          </motion.button>
        );
      })}
    </div>
  );
}
