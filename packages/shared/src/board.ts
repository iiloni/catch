import { z } from 'zod';
import { notePositionSchema } from './notes';

export const DEFAULT_BOARD_STATUS = 'new';

export const BOARD_COLUMNS = [
  { id: 'new', name: 'New', color: 'amber' },
  { id: 'in_progress', name: 'In progress', color: 'blue' },
  { id: 'hold', name: 'On hold', color: 'violet' },
] as const;

export const COLUMN_COLORS = ['amber', 'red', 'green', 'teal', 'blue', 'violet', 'gray'] as const;
export const columnColorSchema = z.enum(COLUMN_COLORS);
export type ColumnColor = z.infer<typeof columnColorSchema>;

export const boardColumnSchema = z.object({
  id: z.string().min(1).max(64),
  userId: z.string(),
  name: z.string().trim().min(1).max(40),
  color: columnColorSchema,
  position: notePositionSchema,
});
export type BoardColumn = z.infer<typeof boardColumnSchema>;

export const createBoardColumnSchema = boardColumnSchema.pick({
  id: true,
  name: true,
  color: true,
  position: true,
});
export type CreateBoardColumn = z.infer<typeof createBoardColumnSchema>;
export const updateBoardColumnSchema = boardColumnSchema
  .pick({ name: true, color: true, position: true })
  .partial();
export type UpdateBoardColumn = z.infer<typeof updateBoardColumnSchema>;
