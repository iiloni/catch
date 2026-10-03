import type { Tag } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ColorTagSelector } from './ColorPicker';

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
const leaf: Tag = { ...child, id: 'leaf', name: 'Catch', parentId: child.id };
vi.mock('@/lib/collections', () => ({ useTags: () => [root, child, leaf] }));

describe('primary tag color picker', () => {
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
});
