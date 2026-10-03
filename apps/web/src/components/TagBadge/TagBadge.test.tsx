import type { Tag } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TagBadge } from './TagBadge';

it('colors the leaf badge and lets touch reveal its full hierarchy without bubbling', async () => {
  const root: Tag = {
    id: 'root',
    userId: 'ada',
    name: 'Work',
    parentId: null,
    color: 'blue',
    icon: null,
  };
  const leaf: Tag = { ...root, id: 'leaf', name: 'Catch', parentId: root.id, color: null };
  const onCardClick = vi.fn();
  render(<TagBadge tag={leaf} tags={[root, leaf]} />, { wrapper: TooltipProvider });
  const badge = screen.getByRole('button', { name: 'Work / Catch' });
  expect(badge).toHaveAttribute('data-note-color', 'blue');
  expect(badge).toHaveTextContent('Catch');
  document.body.addEventListener('click', onCardClick);
  fireEvent.click(badge);
  document.body.removeEventListener('click', onCardClick);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Work / Catch');
  expect(onCardClick).not.toHaveBeenCalled();
  fireEvent.click(badge);
  expect(screen.queryByRole('tooltip')).toBeNull();
});
