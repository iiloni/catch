import type { Tag } from '@catch/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NoteTags } from './NoteTags';

const root: Tag = {
  id: 'root',
  userId: 'ada',
  name: 'Work',
  parentId: null,
  color: 'blue',
  icon: 'briefcase',
};
const leaf: Tag = {
  ...root,
  id: 'leaf',
  name: 'Catch',
  parentId: root.id,
  color: null,
  icon: null,
};
const secondary: Tag = { ...root, id: 'other', name: 'Ideas', color: null };
vi.mock('@/lib/collections', () => ({
  useTags: () => [root, leaf, secondary],
  useNoteTagAssignments: () =>
    new Map([
      ['note', { primaryTagId: leaf.id, secondaryTagIds: [secondary.id, leaf.id, 'deleted'] }],
    ]),
}));

describe('note tag section', () => {
  it('puts the primary first, hides deleted references and avoids duplicate badges', () => {
    render(<NoteTags noteId="note" />, { wrapper: TooltipProvider });
    const section = screen.getByRole('region', { name: 'Tags' });
    expect(
      within(section)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Work / Catch', 'Ideas']);
  });
  it('does not reserve a section for notes with no assignments', () => {
    render(<NoteTags noteId="untagged" />);
    expect(screen.queryByRole('region', { name: 'Tags' })).toBeNull();
  });
});
