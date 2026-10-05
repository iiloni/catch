import type { Tag } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ColorTagSelector } from './ColorPicker';

const root: Tag = {
  id: '018f3b5e-0000-7000-8000-000000000001',
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
const leaf: Tag = { ...child, id: 'leaf', name: 'Catch', parentId: child.id };
vi.mock('@/lib/collections', () => ({
  useTagReadiness: () => ({ awaitingTags: false, awaitingAssignments: false }),
  useTags: () => [root, child, leaf],
}));
vi.mock('@/lib/auth', () => ({ getSignedInUser: () => ({ id: 'ada' }) }));
vi.mock('@/lib/tags', () => ({ createTag: vi.fn(() => ({ id: 'made' })) }));

describe('primary tag color picker', () => {
  it('makes a tag under the open branch and assigns it as the primary tag', async () => {
    const onTagChange = vi.fn();
    render(<ColorTagSelector value="default" onChange={vi.fn()} onTagChange={onTagChange} />, {
      wrapper: TooltipProvider,
    });
    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
    expect(screen.getByLabelText('Parent tag')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue: Work' }));
    await screen.findByRole('button', { name: 'Back to parent tags' });
    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
    expect(screen.getByLabelText('Parent tag')).toHaveValue(root.id);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Errands' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
    expect(onTagChange).toHaveBeenLastCalledWith('made');
  });
  it('assigns intermediate tags immediately and drills down through children', async () => {
    const onTagChange = vi.fn();
    const onChange = vi.fn();
    render(<ColorTagSelector value="default" onChange={onChange} onTagChange={onTagChange} />, {
      wrapper: TooltipProvider,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Blue: Work' }));
    expect(onTagChange).toHaveBeenLastCalledWith(root.id);
    const back = await screen.findByRole('button', { name: 'Back to parent tags' });
    fireEvent.click(await screen.findByRole('button', { name: 'Projects' }));
    expect(onTagChange).toHaveBeenLastCalledWith(child.id);
    const catchTag = await screen.findByRole('button', { name: 'Catch' });
    expect(screen.getByRole('button', { name: 'Back to parent tags' })).toBe(back);
    fireEvent.click(catchTag);
    expect(onTagChange).toHaveBeenLastCalledWith(leaf.id);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(back);
    await screen.findByRole('button', { name: 'Projects' });
    expect(screen.getByRole('button', { name: 'Back to parent tags' })).toBe(back);
    fireEvent.click(back);
    expect(await screen.findByRole('button', { name: 'Blue: Work' })).toBeInTheDocument();
  });
  it('keeps plain colors and No color available', () => {
    const onChange = vi.fn();
    render(<ColorTagSelector value="blue" onChange={onChange} onTagChange={vi.fn()} />, {
      wrapper: TooltipProvider,
    });
    fireEvent.click(screen.getByRole('button', { name: 'No color' }));
    expect(onChange).toHaveBeenLastCalledWith('default');
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    expect(onChange).toHaveBeenLastCalledWith('red');
  });
  it('does not imply a primary assignment from a linked raw color or mixed primaries', () => {
    const { rerender } = render(
      <ColorTagSelector
        value="blue"
        primaryTagId={null}
        onChange={vi.fn()}
        onTagChange={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    );
    expect(screen.queryByRole('button', { name: 'Work' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Blue: Work' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    rerender(
      <ColorTagSelector
        value={null}
        primaryTagId={null}
        onChange={vi.fn()}
        onTagChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Work' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Projects' })).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(0);
  });
});
