import { z } from 'zod';
import { noteColorSchema } from './notes';

/** Device-only display data. Never contains vault notes, tokens or an editable document. */
export const widgetNoteSchema = z.object({
  id: z.uuid(),
  title: z.string().max(160),
  body: z.string().max(1600),
  color: noteColorSchema,
  pinned: z.boolean(),
  column: z.string().nullable(),
  tags: z.array(z.string()),
});
const widgetChoiceSchema = z.object({ id: z.string(), name: z.string() });
export const widgetSnapshotSchema = z.object({
  version: z.literal(1),
  notes: z.array(widgetNoteSchema),
  tags: z.array(widgetChoiceSchema),
  columns: z.array(widgetChoiceSchema),
});
export type WidgetSnapshot = z.infer<typeof widgetSnapshotSchema>;

const widgetLaunchBase = z.object({
  id: z.string().min(1),
  account: z.string().min(1),
  server: z.string(),
});
export const widgetLaunchSchema = z.discriminatedUnion('action', [
  widgetLaunchBase.extend({ action: z.literal('note'), noteId: z.uuid() }),
  widgetLaunchBase.extend({
    action: z.literal('compose'),
    column: z.string().min(1).max(64).optional(),
  }),
  widgetLaunchBase.extend({ action: z.literal('search') }),
]);
export type WidgetLaunch = z.infer<typeof widgetLaunchSchema>;
