import type { Tag } from '@catch/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActiveSearchFilters, BrowseTags, SearchFilters } from './SearchFilters';

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
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
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
        showArchived
        onFilterChange={onFilterChange}
        onColorChange={onColorChange}
        onShowArchivedChange={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    expect(screen.getByRole('checkbox', { name: 'Work / Projects' })).toBeChecked();
    const ancestor = screen.getByRole('checkbox', { name: 'Work' });
    expect(ancestor).toBeEnabled();
    fireEvent.click(ancestor);
    expect(onFilterChange).toHaveBeenLastCalledWith({
      ids: [child.id, root.id],
      match: 'any',
      untagged: false,
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Colors' }));
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
        showArchived
        onFilterChange={onFilterChange}
        onColorChange={vi.fn()}
        onShowArchivedChange={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'All tags' }));
    expect(onFilterChange).toHaveBeenLastCalledWith({
      ids: [root.id, child.id],
      match: 'all',
      untagged: false,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /^Untagged/ }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ ids: [], match: 'any', untagged: true });
  });
  it('toggles a linked root instead of its color and clears a previous raw color', () => {
    const props = {
      tags,
      counts: new Map<string, number>(),
      untaggedCount: 0,
      showArchived: true,
      onFilterChange: vi.fn(),
      onColorChange: vi.fn(),
      onShowArchivedChange: vi.fn(),
    };
    const rendered = render(
      <SearchFilters {...props} filter={{ ids: [], match: 'any', untagged: true }} color="green" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(props.onFilterChange).toHaveBeenLastCalledWith({
      ids: [root.id],
      match: 'any',
      untagged: false,
    });
    expect(props.onColorChange).toHaveBeenLastCalledWith(null);
    rendered.rerender(
      <SearchFilters
        {...props}
        filter={{ ids: [root.id], match: 'any', untagged: false }}
        color={null}
      />,
    );
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(props.onFilterChange).toHaveBeenLastCalledWith({
      ids: [],
      match: 'any',
      untagged: false,
    });
  });
  it('waits for the initial tag snapshot before interpreting apparently unlinked colors', () => {
    const onColorChange = vi.fn();
    render(
      <SearchFilters
        tags={[]}
        awaitingTags
        filter={{ ids: [], match: 'any', untagged: false }}
        color={null}
        counts={new Map()}
        untaggedCount={0}
        showArchived
        onFilterChange={vi.fn()}
        onColorChange={onColorChange}
        onShowArchivedChange={vi.fn()}
      />,
    );
    const swatch = screen.getByRole('button', { name: 'Blue' });
    expect(swatch).toBeDisabled();
    fireEvent.click(swatch);
    expect(onColorChange).not.toHaveBeenCalled();
  });
  it('restores the last tab and supports keyboard selection', async () => {
    const props = {
      tags,
      counts: new Map<string, number>(),
      untaggedCount: 0,
      showArchived: true,
      onFilterChange: vi.fn(),
      onColorChange: vi.fn(),
      onShowArchivedChange: vi.fn(),
    };
    const element = (
      <SearchFilters {...props} filter={{ ids: [], match: 'any', untagged: false }} color={null} />
    );
    const rendered = render(element);
    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    rendered.unmount();
    render(element);
    const tab = screen.getByRole('tab', { name: 'Tags' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Colors' })).toHaveFocus();
    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'Colors' })).toBeVisible());
    expect(localStorage.getItem('catch-search-filter-tab')).toBe('"colors"');
  });
  it('hides matching controls during tag search and restores the selected mode on blur', () => {
    const onFilterChange = vi.fn();
    render(
      <SearchFilters
        tags={tags}
        filter={{ ids: [root.id, child.id], match: 'all', untagged: false }}
        color={null}
        counts={new Map()}
        untaggedCount={0}
        showArchived
        onFilterChange={onFilterChange}
        onColorChange={vi.fn()}
        onShowArchivedChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    expect(screen.getByRole('button', { name: 'All tags' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const search = screen.getByRole('textbox', { name: 'Find tags' });
    fireEvent.focus(search);
    expect(screen.queryByRole('button', { name: 'All tags' })).toBeNull();
    fireEvent.change(search, { target: { value: 'Projects' } });
    expect(screen.getByRole('checkbox', { name: 'Work / Projects' })).toBeChecked();
    fireEvent.blur(search);
    expect(screen.getByRole('button', { name: 'All tags' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(onFilterChange).not.toHaveBeenCalled();
  });
  it('offers archived notes as a switch on either tab', () => {
    const onShowArchivedChange = vi.fn();
    const props = {
      tags,
      filter: { ids: [], match: 'any', untagged: false } as const,
      color: null,
      counts: new Map<string, number>(),
      untaggedCount: 0,
      onFilterChange: vi.fn(),
      onColorChange: vi.fn(),
      onShowArchivedChange,
    };
    const rendered = render(<SearchFilters {...props} showArchived />);
    const toggle = screen.getByRole('switch', { name: 'Show archived notes' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onShowArchivedChange).toHaveBeenLastCalledWith(false);
    rendered.rerender(<SearchFilters {...props} showArchived={false} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    expect(screen.getByRole('switch', { name: 'Show archived notes' })).not.toBeChecked();
    expect(props.onFilterChange).not.toHaveBeenCalled();
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
  it('keeps deleted tag selections visible and removable', () => {
    const onFilterChange = vi.fn();
    render(
      <ActiveSearchFilters
        tags={[]}
        filter={{ ids: ['deleted'], match: 'any', untagged: false }}
        color={null}
        onFilterChange={onFilterChange}
        onColorChange={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable tag filter deleted' }));
    expect(onFilterChange).toHaveBeenCalledWith({ ids: [], match: 'any', untagged: false });
  });
});
