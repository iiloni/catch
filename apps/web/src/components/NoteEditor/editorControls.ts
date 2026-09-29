/** Inline styles the formatting bar can toggle. */
export type TextStyle = 'bold' | 'italic' | 'underline' | 'strike';

/** Block types the formatting bar can switch between. */
export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'bulletListItem'
  | 'numberedListItem'
  | 'checkListItem';

export type FormattingState = {
  styles: Record<TextStyle, boolean>;
  /** The type of the block holding the cursor. */
  block: string;
  canIndent: boolean;
  canOutdent: boolean;
};

/**
 * A small handle on a mounted editor, so controls outside it (the formatting bar) can
 * format text without importing BlockNote, which is lazy-loaded.
 */
export type EditorControls = {
  getState(): FormattingState;
  /** Calls the listener whenever `getState()` may have changed. */
  subscribe(listener: () => void): () => void;
  toggleStyle(style: TextStyle): void;
  /** Turns the selected blocks into `kind`, or back into paragraphs if they already are. */
  toggleBlock(kind: BlockKind): void;
  indent(): void;
  outdent(): void;
  /** Puts the caret at the end of the note, for taps on the blank space below it. */
  focusEnd(): void;
};
