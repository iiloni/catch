import type { Tag } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BrowseTags, SearchFilters } from './SearchFilters';

const root: Tag = {
  id: 'work',
  userId: 'ada',
  name: 'Work',
  parentId: null,
  color: 'blue',
  icon: 'briefcase',
};
const child: Tag = {
  ...root,
  id: 'projects',
  name: 'Projects',
  parentId: root.id,
  color: null,
  icon: null,
};
const tags = [root, child];

describe('search filters', () => {
  it('allows ancestor filters alongside descendants and keeps color filtering independent', () => {
    const onFilterChange = vi.fn();
    const onColorChange = vi.fn();
    render(
      <SearchFilters
        tags={tags}
        filter={{ ids: [child.id], match: 'any', untagged: false }}
        color={null}
        counts={
          new Map([
            [root.id, 2],
            [child.id, 1],
          ])
        }
        untaggedCount={3}
        onFilterChange={onFilterChange}
        onColorChange={onColorChange}
      />,
      { wrapper: TooltipProvider },
    );
    expect(screen.getByRole('checkbox', { name: 'Work / Projects' })).toBeChecked();
    const ancestor = screen.getByRole('checkbox', { name: 'Work' });
    expect(ancestor).toBeEnabled();
    fireEvent.click(ancestor);
    expect(onFilterChange).toHaveBeenLastCalledWith({
      ids: [child.id, root.id],
      match: 'any',
      untagged: false,
    });
    const linkedSwatch = screen.getByRole('button', { name: 'Blue' });
    expect(linkedSwatch).toHaveAttribute('title', 'Blue: Work');
    expect(linkedSwatch.querySelector('svg')).toHaveClass('lucide-briefcase');
    expect(screen.getByRole('button', { name: 'Green' }).querySelector('svg')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'No color' }));
    expect(onColorChange).toHaveBeenLastCalledWith('default');
    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });
  it('makes untagged exclusive of selected tags and offers any/all only for multiple tags', () => {
    const onFilterChange = vi.fn();
    render(
      <SearchFilters
        tags={tags}
        filter={{ ids: [root.id, child.id], match: 'any', untagged: false }}
        color="blue"
        counts={new Map()}
        untaggedCount={1}
        onFilterChange={onFilterChange}
        onColorChange={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    );
    fireEvent.click(screen.getByRole('button', { name: 'All tags' }));
    expect(onFilterChange).toHaveBeenLastCalledWith({
      ids: [root.id, child.id],
      match: 'all',
      untagged: false,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /^Untagged/ }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ ids: [], match: 'any', untagged: true });
  });
  it('browses roots without treating a child as a separate top-level topic', () => {
    const onSelect = vi.fn();
    render(
      <BrowseTags
        tags={tags}
        counts={new Map([[root.id, 2]])}
        untaggedCount={1}
        onSelect={onSelect}
        onUntagged={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Browse Projects' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Browse Work' });
    expect(button).toHaveTextContent('2');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(root.id);
  });
});
