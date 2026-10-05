import type { Tag } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tagFormOpen } from '@/lib/dockState';
import { createTag } from '@/lib/tags';
import { NewTagButton } from './TagForm';

const root: Tag = {
  id: '018f3b5e-0000-7000-8000-000000000001',
  userId: 'ada',
  name: 'Work',
  parentId: null,
  color: 'blue',
  icon: 'briefcase',
};
let user: { id: string } | null = { id: 'ada' };
vi.mock('@/lib/auth', () => ({ getSignedInUser: () => user }));
vi.mock('@/lib/collections', () => ({
  useTagReadiness: () => ({ awaitingTags: false, awaitingAssignments: false }),
  useTags: () => [root],
}));
vi.mock('@/lib/tags', () => ({ createTag: vi.fn(() => ({ id: 'made' })), updateTag: vi.fn() }));

describe('new tag button', () => {
  beforeEach(() => {
    user = { id: 'ada' };
    vi.clearAllMocks();
  });
  it('creates a tag under the given parent and reports it', () => {
    const onCreated = vi.fn();
    render(<NewTagButton parentId={root.id} onCreated={onCreated} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
    expect(tagFormOpen.get()).toBe(true);
    expect(screen.getByLabelText('Parent tag')).toHaveValue(root.id);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Projects ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
    expect(createTag).toHaveBeenCalledWith('ada', {
      name: 'Projects',
      parentId: root.id,
      icon: null,
      color: null,
    });
    expect(onCreated).toHaveBeenCalledWith('made');
    expect(tagFormOpen.get()).toBe(false);
  });
  it('reports nothing when the form is cancelled', () => {
    const onCreated = vi.fn();
    render(<NewTagButton onCreated={onCreated} />);
    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(createTag).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
  it('creates a tag when nothing waits to hear of it', () => {
    render(<NewTagButton />);
    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Errands' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
    expect(createTag).toHaveBeenCalledOnce();
  });
  it('refuses a color another tag already has', () => {
    render(<NewTagButton />);
    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Blue is already linked to another tag.');
  });
  it('is disabled without a signed-in user to own the tag', () => {
    user = null;
    render(<NewTagButton />);
    expect(screen.getByRole('button', { name: 'New tag' })).toBeDisabled();
  });
});
