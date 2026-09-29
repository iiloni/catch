import type { LinkPreview, Note } from '@catch/shared';

/** Test data for link previews. */

export const link = (href: string, label = href) => ({
  type: 'link',
  href,
  content: [{ type: 'text', text: label, styles: {} }],
});

export const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });

export const heading = (text: string) => ({
  type: 'heading',
  content: [{ type: 'text', text, styles: {} }],
});

export function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: '0199a0a0-0000-7000-8000-000000000001',
    userId: 'user-1',
    content: [],
    color: 'default',
    status: null,
    isPinned: false,
    isArchived: false,
    position: 'a0',
    hiddenLinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

export function makePreview(url: string, overrides: Partial<LinkPreview> = {}): LinkPreview {
  return {
    userId: 'user-1',
    url,
    status: 'ready',
    title: null,
    description: null,
    siteName: null,
    imageHash: null,
    imageWidth: null,
    imageHeight: null,
    iconHash: null,
    hue: null,
    fetchedAt: new Date(),
    ...overrides,
  };
}
