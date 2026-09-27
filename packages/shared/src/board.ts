/**
 * Board columns for notes in the deck. A note's `status` is one of these ids;
 * a null status means the note lives in the gallery.
 */
export const BOARD_COLUMNS = [
  { id: 'new', name: 'New' },
  { id: 'in_progress', name: 'In progress' },
  { id: 'hold', name: 'On hold' },
] as const;

export type BoardColumnId = (typeof BOARD_COLUMNS)[number]['id'];

export const DEFAULT_BOARD_STATUS: BoardColumnId = 'new';
