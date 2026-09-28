import {
  type BoardColumn,
  type ColumnColor,
  comparePositions,
  DEFAULT_BOARD_STATUS,
  positionBetween,
} from '@catch/shared';
import { uuidv7 } from 'uuidv7';
import { boardColumnsCollection } from './collections';

export function sortBoardColumns(columns: readonly BoardColumn[]) {
  return [...columns].sort(
    (a, b) => comparePositions(a.position, b.position) || a.id.localeCompare(b.id),
  );
}

export function addBoardColumn(
  userId: string,
  name: string,
  color: ColumnColor,
  columns: readonly BoardColumn[],
) {
  const ordered = sortBoardColumns(columns);
  boardColumnsCollection.insert({
    id: uuidv7(),
    userId,
    name: name.trim(),
    color,
    position: positionBetween(ordered.at(-1)?.position ?? null, null),
  });
}

export function editBoardColumn(id: string, changes: Partial<Pick<BoardColumn, 'name' | 'color'>>) {
  boardColumnsCollection.update(id, (draft) => Object.assign(draft, changes));
}

export function moveBoardColumn(
  column: BoardColumn,
  columns: readonly BoardColumn[],
  index: number,
) {
  const others = sortBoardColumns(columns.filter((item) => item.id !== column.id));
  const before = others[index - 1]?.position ?? null;
  const after =
    others.slice(index).find((item) => before === null || item.position > before)?.position ?? null;
  boardColumnsCollection.update(column.id, (draft) => {
    draft.position = positionBetween(before, after);
  });
}

export function removeBoardColumn(id: string) {
  if (id === DEFAULT_BOARD_STATUS) return;
  boardColumnsCollection.delete(id);
}
