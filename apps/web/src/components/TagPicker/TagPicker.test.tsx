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
const otherAssignments = new Map<
  string,
  { primaryTagId: string | null; secondaryTagIds: string[] }
>();
const readiness = { awaitingTags: false, awaitingAssignments: false };
vi.mock('@/lib/collections', () => ({
  useTagReadiness: () => readiness,
  useTags: () => [root, child, sibling],
  useNoteTagAssignments: () =>
    new Map([['note', { primaryTagId, secondaryTagIds }], ...otherAssignments]),
}));
vi.mock('@/lib/tags', () => ({ setSecondaryTag: vi.fn() }));
describe('secondary tag picker', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    primaryTagId = root.id;
    secondaryTagIds = [child.id];
    readiness.awaitingTags = false;
    readiness.awaitingAssignments = false;
    otherAssignments.clear();
    vi.clearAllMocks();
  });
  it.each(['awaitingTags', 'awaitingAssignments'] as const)(
    'waits for %s before offering assignment toggles',
    (pending) => {
      readiness[pending] = true;
      const { rerender } = render(<TagPicker noteId="note" />);
      expect(screen.getByRole('status')).toHaveTextContent('Loading tags…');
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(setSecondaryTag).not.toHaveBeenCalled();
      readiness[pending] = false;
      rerender(<TagPicker noteId="note" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Work / Projects' })).toBeVisible();
    },
  );
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
  it('shows mixed assignments and adds or removes tags across the selection', () => {
    primaryTagId = null;
    otherAssignments.set('other', { primaryTagId: null, secondaryTagIds: [] });
    const { rerender } = render(<TagPicker noteIds={['note', 'other']} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Work / Projects' });
    expect(checkbox).toBePartiallyChecked();
    fireEvent.click(checkbox);
    expect(setSecondaryTag).toHaveBeenCalledExactlyOnceWith('other', child.id, true);
    otherAssignments.set('other', { primaryTagId: null, secondaryTagIds: [child.id] });
    rerender(<TagPicker noteIds={['note', 'other']} />);
    expect(checkbox).toBeChecked();
    vi.clearAllMocks();
    fireEvent.click(checkbox);
    expect(setSecondaryTag).toHaveBeenCalledWith('note', child.id, false);
    expect(setSecondaryTag).toHaveBeenCalledWith('other', child.id, false);
  });

  it('preserves each note’s primary and more specific tags in a mixed selection', () => {
    otherAssignments.set('other', { primaryTagId: null, secondaryTagIds: [sibling.id] });
    otherAssignments.set('plain', { primaryTagId: null, secondaryTagIds: [] });
    render(<TagPicker noteIds={['note', 'other', 'plain']} />);
    const rootCheckbox = screen.getByRole('checkbox', { name: /^Work$/ });
    expect(rootCheckbox).toBePartiallyChecked();
    expect(rootCheckbox).toBeEnabled();
    fireEvent.click(rootCheckbox);
    expect(setSecondaryTag).toHaveBeenCalledExactlyOnceWith('plain', root.id, true);
  });

  it('locks a tag when every selected note has it as primary or has a secondary descendant', () => {
    otherAssignments.set('other', { primaryTagId: null, secondaryTagIds: [sibling.id] });
    render(<TagPicker noteIds={['note', 'other']} />);
    expect(screen.getByRole('checkbox', { name: /^Work$/ })).toBeDisabled();
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
