import type { Tag } from '@catch/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { TagTree } from './TagTree';

afterEach(() => vi.unstubAllGlobals());

// Allow the 5000-row jsdom stress case to finish on shared worktree hosts.
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
      <button type="button" style={{ minHeight: 48 }}>
        {tag.name}
        <span>{path.length} levels</span>
      </button>
      {tag.id === '4999' &&
        createPortal(<button type="button">Manage deepest tag</button>, document.body)}
    </span>
  ));
  render(<TagTree tags={tags} renderTag={renderTag} estimatedRowHeight={48} />);
  expect(renderTag.mock.calls.length).toBeLessThanOrEqual(40);
  expect(screen.queryByText('Tag 4999')).not.toBeInTheDocument();
  expect(observed.at(-1)).toHaveStyle({ height: '48px' });
  act(() => notify([{ target: observed.at(-1)!, isIntersecting: true }]));
  expect(screen.getByText('Tag 4999')).toBeInTheDocument();
  expect(screen.getByText('5000 levels')).toBeInTheDocument();
  const deepest = screen.getByText('Tag 4999');
  act(() => deepest.focus());
  act(() => notify([{ target: observed.at(-1)!, isIntersecting: false }]));
  expect(deepest).toBeInTheDocument();
  await act(async () => screen.getByRole('button', { name: 'Manage deepest tag' }).focus());
  act(() => notify([{ target: observed.at(-1)!, isIntersecting: false }]));
  expect(deepest).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Manage deepest tag' })).toHaveFocus();
  await act(async () => screen.getByRole('textbox', { name: 'Find tags' }).focus());
  expect(screen.queryByText('Tag 4999')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Find tags' }), {
    target: { value: 'Tag 4999' },
  });
  act(() => notify([{ target: observed.at(-1)!, isIntersecting: true }]));
  expect(screen.getByText('Tag 4999')).toBeInTheDocument();
  // Thousands of exiting rows can outlast the default one-second wait on a busy host.
  await waitFor(() => expect(screen.queryByText('Tag 0')).not.toBeInTheDocument(), {
    timeout: 15_000,
  });
}, 60_000);
