import type { Tag } from '@catch/shared';
import { fireEvent, render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setSecondaryTag } from '@/lib/tags';
import { TagPicker } from './TagPicker';

const root: Tag = {
  id: 'root',
  userId: 'ada',
  name: 'Work',
  parentId: null,
  color: 'blue',
  icon: 'briefcase',
};
const child: Tag = {
  ...root,
  id: 'child',
  name: 'Projects',
  parentId: root.id,
  color: null,
  icon: null,
};
const sibling: Tag = { ...child, id: 'sibling', name: 'Ideas' };
let primaryTagId: string | null = root.id;
let secondaryTagIds = [child.id];
vi.mock('@/lib/collections', () => ({
  useTags: () => [root, child, sibling],
  useNoteTagAssignments: () => new Map([['note', { primaryTagId, secondaryTagIds }]]),
}));
vi.mock('@/lib/tags', () => ({ setSecondaryTag: vi.fn() }));
describe('secondary tag picker', () => {
  beforeEach(() => {
    primaryTagId = root.id;
    secondaryTagIds = [child.id];
  });
  it('explains disabled secondary ancestors on touch and keeps siblings selectable', () => {
    primaryTagId = null;
    render(<TagPicker noteId="note" />);
    const ancestor = screen.getByRole('checkbox', { name: /^Work$/ });
    expect(ancestor).toBeDisabled();
    expect(ancestor).not.toBeChecked();
    expect(ancestor).toHaveAccessibleDescription('Projects is already assigned');
    expect(screen.getByRole('checkbox', { name: 'Work / Ideas' })).toBeEnabled();
  });
  it('allows a child secondary beneath a primary and allows its parent once removed', () => {
    secondaryTagIds = [];
    render(<TagPicker noteId="note" />);
    expect(screen.getByRole('checkbox', { name: 'Work / Projects' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Work / Projects' }));
    expect(setSecondaryTag).toHaveBeenCalledWith('note', child.id, true);
  });
  it('keeps primary checked and locked, and changes secondary tags independently', () => {
    render(<TagPicker noteId="note" />);
    expect(screen.getByRole('checkbox', { name: /^Work$/ })).toBeDisabled();
    const checkbox = screen.getByRole('checkbox', { name: 'Work / Projects' });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(setSecondaryTag).toHaveBeenCalledWith('note', child.id, false);
  });
  it('searches collapsed descendants by their full path', () => {
    render(<TagPicker noteId="note" />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Work' }));
    expect(screen.queryByRole('checkbox', { name: 'Work / Projects' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Find tags' }), {
      target: { value: 'Projects' },
    });
    expect(screen.getByRole('checkbox', { name: 'Work / Projects' })).toBeVisible();
  });
  it('keeps closing rows in flow until their exit finishes and preserves selections on reopening', async () => {
    render(<TagPicker noteId="note" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Work / Projects' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Work' }));
    expect(checkbox.isConnected).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'Work / Projects' })).toBeNull();
    await waitForElementToBeRemoved(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Work' }));
    expect(await screen.findByRole('checkbox', { name: 'Work / Projects' })).toBeChecked();
  });
});
