import { describe, expect, it } from 'vitest';
import {
  attachmentKind,
  attachmentUrl,
  mapAttachmentBlocks,
  removeAttachmentBlocks,
} from './attachments';

const original = '019f177a-b732-7000-8000-000000000001';
const copy = '019f177a-b732-7000-8000-000000000002';
const other = '019f177a-b732-7000-8000-000000000003';
const blocks = [
  {
    type: 'paragraph',
    content: [{ type: 'text', text: 'Keep this text' }],
    children: [
      { type: 'image', props: { url: attachmentUrl(original), caption: 'Keep this caption' } },
      { type: 'file', props: { url: attachmentUrl(other) } },
      null,
    ],
  },
  { type: 'image', props: { url: attachmentUrl(original) } },
];

describe('attachment placements', () => {
  it('maps every placement in a copy while preserving text, captions and unrelated files', () => {
    const mapped = mapAttachmentBlocks(blocks, new Map([[original, copy]]));
    expect(mapped).toEqual([
      {
        ...blocks[0],
        children: [
          { type: 'image', props: { url: attachmentUrl(copy), caption: 'Keep this caption' } },
          { type: 'file', props: { url: attachmentUrl(other) } },
        ],
      },
      { type: 'image', props: { url: attachmentUrl(copy) } },
    ]);
    expect(blocks[1]?.props?.url).toBe(attachmentUrl(original));
  });
  it('removes every placement of only the selected file', () => {
    expect(removeAttachmentBlocks(blocks, original)).toEqual([
      { ...blocks[0], children: [{ type: 'file', props: { url: attachmentUrl(other) } }] },
    ]);
  });
  it('keeps active image formats as downloadable files', () => {
    expect(attachmentKind('image/svg+xml')).toBe('file');
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('audio/mp4')).toBe('audio');
    expect(attachmentKind('video/webm')).toBe('video');
  });
});
