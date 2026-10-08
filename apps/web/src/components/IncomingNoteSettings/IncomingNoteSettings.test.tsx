import type { BoardColumn, Tag } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { incomingNoteDefaultsKey } from '@/lib/incomingNoteDefaults';
import { IncomingNoteSettings } from './IncomingNoteSettings';

const mocks = vi.hoisted(() => ({
  columns: [] as BoardColumn[],
  tags: [] as Tag[],
}));
vi.mock('@/lib/auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
vi.mock('@/lib/collections', () => ({
  boardColumnsCollection: new Map(),
  tagsCollection: new Map(),
  useBoardColumns: () => mocks.columns,
  useTags: () => mocks.tags,
  useTagReadiness: () => ({ awaitingTags: false, awaitingAssignments: false }),
}));
vi.mock('@/lib/boardColumns', () => ({ sortBoardColumns: (columns: BoardColumn[]) => columns }));
vi.mock('@/components/ColorPicker/ColorPicker', () => ({
  COLOR_NAMES: { default: 'No color' },
  ColorPicker: () => null,
}));

const root = '019a0123-4567-7000-8000-000000000001';
const child = '019a0123-4567-7000-8000-000000000002';

beforeEach(() => {
  localStorage.clear();
  mocks.columns = [
    { id: 'new', userId: 'user-1', name: 'Inbox', color: 'amber', position: 'a0' },
    { id: 'hold', userId: 'user-1', name: 'Later', color: 'blue', position: 'a1' },
  ];
  mocks.tags = [
    { id: root, userId: 'user-1', name: 'Reading', parentId: null, color: null, icon: null },
    { id: child, userId: 'user-1', name: 'Web', parentId: root, color: null, icon: null },
  ];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

it('remembers destinations by column id and shows renamed and deleted columns correctly', () => {
  const view = render(<IncomingNoteSettings />);
  const destination = screen.getByLabelText('Save incoming notes to');
  expect(destination).toHaveValue('');
  fireEvent.change(destination, { target: { value: 'hold' } });
  expect(JSON.parse(localStorage.getItem(incomingNoteDefaultsKey('user-1')) ?? '{}')).toMatchObject(
    { status: 'hold' },
  );
  mocks.columns = mocks.columns.map((column) =>
    column.id === 'hold' ? { ...column, name: 'Read later' } : column,
  );
  view.rerender(<IncomingNoteSettings />);
  expect(screen.getByRole('option', { name: 'Deck · Read later' })).toBeInTheDocument();
  expect(destination).toHaveValue('hold');
  mocks.columns = mocks.columns.filter((column) => column.id !== 'hold');
  view.rerender(<IncomingNoteSettings />);
  expect(destination).toHaveValue('new');
  fireEvent.change(destination, { target: { value: '' } });
  expect(destination).toHaveValue('');
});

it('keeps the deepest secondary tag and protects the primary assignment', () => {
  const view = render(<IncomingNoteSettings />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Reading' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Reading / Web' }));
  expect(screen.getByRole('checkbox', { name: 'Reading' })).toBeDisabled();
  expect(JSON.parse(localStorage.getItem(incomingNoteDefaultsKey('user-1')) ?? '{}')).toMatchObject(
    { secondaryTagIds: [child] },
  );
  view.unmount();
  localStorage.setItem(incomingNoteDefaultsKey('user-1'), JSON.stringify({ primaryTagId: child }));
  render(<IncomingNoteSettings />);
  expect(screen.getByRole('checkbox', { name: 'Reading / Web' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Reading / Web' })).toBeDisabled();
});
