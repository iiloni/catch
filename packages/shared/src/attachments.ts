import { z } from 'zod';

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const attachmentKindSchema = z.enum(['image', 'video', 'audio', 'file']);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

export const attachmentSchema = z.object({
  id: z.uuid({ version: 'v7' }),
  userId: z.string(),
  noteId: z.uuid({ version: 'v7' }),
  name: z.string().trim().min(1).max(255),
  mimeType: z
    .string()
    .regex(/^[\w.+-]+\/[\w.+-]+$/)
    .max(127),
  size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
  kind: attachmentKindSchema,
  status: z.enum(['pending', 'ready']),
  sourceId: z.uuid({ version: 'v7' }).nullable(),
  createdAt: z.coerce.date(),
  deletedAt: z.coerce.date().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export const createAttachmentSchema = attachmentSchema.omit({
  userId: true,
  status: true,
  deletedAt: true,
});
export type CreateAttachment = z.infer<typeof createAttachmentSchema>;
export const updateAttachmentSchema = attachmentSchema
  .pick({ name: true, deletedAt: true })
  .partial();
export type UpdateAttachment = z.infer<typeof updateAttachmentSchema>;
export const attachmentAccessSchema = z.object({ url: z.url() });
export type AttachmentAccess = z.infer<typeof attachmentAccessSchema>;

export function attachmentKind(mimeType: string): AttachmentKind {
  // SVGs and other active formats remain downloadable files.
  if (/^image\/(jpeg|png|gif|webp|avif|heic|heif|bmp)$/i.test(mimeType)) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

export const attachmentUrl = (id: string) => `attachment:${id}`;
export function attachmentId(url: string): string | null {
  const parsed = z.uuid({ version: 'v7' }).safeParse(url.replace(/^attachment:/, ''));
  return url.startsWith('attachment:') && parsed.success ? parsed.data : null;
}

type Block = Record<string, unknown>;
const isBlock = (value: unknown): value is Block =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export function mapAttachmentBlocks(
  blocks: readonly Block[],
  ids: ReadonlyMap<string, string>,
): Block[] {
  return blocks.map((block) => {
    const props = block.props && typeof block.props === 'object' ? block.props : {};
    const url = 'url' in props && typeof props.url === 'string' ? props.url : '';
    const id = attachmentId(url);
    return {
      ...block,
      ...(id && ids.has(id) ? { props: { ...props, url: attachmentUrl(ids.get(id)!) } } : {}),
      ...(Array.isArray(block.children)
        ? { children: mapAttachmentBlocks(block.children.filter(isBlock), ids) }
        : {}),
    };
  });
}

export function removeAttachmentBlocks(blocks: readonly Block[], id: string): Block[] {
  return blocks.flatMap((block) => {
    const props = block.props && typeof block.props === 'object' ? block.props : {};
    if ('url' in props && props.url === attachmentUrl(id)) return [];
    return [
      {
        ...block,
        ...(Array.isArray(block.children)
          ? { children: removeAttachmentBlocks(block.children.filter(isBlock), id) }
          : {}),
      },
    ];
  });
}
