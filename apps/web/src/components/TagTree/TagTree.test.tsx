import type { Tag } from '@catch/shared';
import { act, fireEvent, render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TagTree } from './TagTree';

afterEach(() => vi.unstubAllGlobals());

it('defers offscreen controls in a 5000-level tree and renders deep matches without a cutoff', async () => {
  const observed: Element[] = [];
  let notify: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => {};
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof notify) {
        notify = callback;
      }
      observe(element: Element) {
        observed.push(element);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const tags = Array.from(
    { length: 5000 },
    (_, i): Tag => ({
      id: String(i),
      userId: 'ada',
      name: `Tag ${i}`,
      parentId: i ? String(i - 1) : null,
      color: null,
      icon: null,
    }),
  );
  const renderTag = vi.fn((tag: Tag, path: readonly Tag[]) => (
    <span>
      {tag.name}
      <span>{path.length} levels</span>
    </span>
  ));
  render(<TagTree tags={tags} renderTag={renderTag} />);
  expect(renderTag.mock.calls.length).toBeLessThanOrEqual(40);
  expect(screen.queryByText('Tag 4999')).not.toBeInTheDocument();
  act(() => notify([{ target: observed.at(-1)!, isIntersecting: true }]));
  expect(screen.getByText('Tag 4999')).toBeInTheDocument();
  expect(screen.getByText('5000 levels')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Find tags' }), {
    target: { value: 'Tag 4999' },
  });
  expect(screen.getByText('Tag 4999')).toBeInTheDocument();
  await waitForElementToBeRemoved(() => screen.queryByText('Tag 0'));
});
