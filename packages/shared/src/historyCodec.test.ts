import { describe, expect, it } from 'vitest';
import type { HistoryState } from './history';
import {
  canonicalHistory,
  decodeHistory,
  encodeHistory,
  packHistory,
  unpackHistory,
} from './historyCodec';

const state = (text: string): HistoryState => ({
  content: [{ id: 'paragraph', type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }],
  files: [],
});

describe('history encoding', () => {
  it('round trips nesting, absent children, duplicate ids, Unicode and unknown fields', () => {
    const initial: HistoryState = {
      content: [
        {
          id: 'same',
          type: 'paragraph',
          content: [{ text: 'é 👩🏽‍💻 東京', styles: { bold: true } }],
          future: { value: null, items: [1, 2.25] },
        },
        { id: 'same', children: [{ type: 'custom', props: { unknown: true } }] },
      ],
      files: [],
    };
    const changed = structuredClone(initial);
    changed.content.reverse();
    changed.content.push({
      type: 'table',
      content: { rows: [{ cells: [[{ text: 'new cell' }]] }] },
    });
    const first = encodeHistory(initial);
    const next = encodeHistory(changed, { state: initial, depth: 0 });
    expect(decodeHistory(first.data, first.representation)).toEqual(initial);
    expect(decodeHistory(next.data, next.representation, initial)).toEqual(changed);
  });
  it('bounds replay to 31 deltas and does not mutate its inputs', () => {
    let previous = state('Some original words '.repeat(100));
    let depth = 0;
    const original = structuredClone(previous);
    for (let index = 1; index <= 32; index++) {
      const next = state('Some original words '.repeat(100) + ` ${index}`);
      const encoded = encodeHistory(next, { state: previous, depth });
      expect(decodeHistory(encoded.data, encoded.representation, previous)).toEqual(next);
      expect(encoded.representation).toBe(index === 32 ? 'snapshot' : 'delta');
      depth = encoded.depth;
      previous = next;
    }
    expect(original).toEqual(state('Some original words '.repeat(100)));
  });
  it('avoids text diffs on wholesale replacement', () => {
    const encoded = encodeHistory(state('Entirely new unrelated words '.repeat(100)), {
      state: state('Original content of this paragraph '.repeat(100)),
      depth: 2,
    });
    expect(encoded.representation).toBe('snapshot');
    expect(encoded.depth).toBe(0);
  });
  it('preserves prototype-like JSON keys using an opaque snapshot', () => {
    const content: HistoryState = JSON.parse(
      '{"content":[{"constructor":"future","__proto__":{"kept":true}}],"files":[]}',
    );
    const encoded = encodeHistory(content, { state: state('before'), depth: 0 });
    expect(encoded.representation).toBe('snapshot');
    expect(canonicalHistory(decodeHistory(encoded.data, 'snapshot'))).toBe(
      canonicalHistory(content),
    );
    expect(Object.prototype).not.toHaveProperty('kept');
  });
  it('rejects truncated data, invalid lengths and expansion beyond the declared limit', () => {
    const payload = packHistory(state('A repeated paragraph '.repeat(500)));
    const bad = payload.slice();
    new DataView(bad.buffer).setUint32(1, 1);
    expect(() => unpackHistory(bad)).toThrow();
    expect(() => unpackHistory(payload.subarray(0, 3))).toThrow();
    expect(() => decodeHistory(packHistory({ content: 'not blocks' }), 'snapshot')).toThrow();
    expect(() => decodeHistory(packHistory({ __proto__: { dangerous: true } }), 'delta')).toThrow();
  });
});

it('saves a useful patch only when its full encoded payload is smaller than the snapshot', () => {
  const before = state('unchanged words '.repeat(400));
  const after = state(`${'unchanged words '.repeat(400)} next`);
  const patch = encodeHistory(after, { state: before, depth: 0 });
  expect(patch.data.length).toBeLessThan(packHistory(after).length);
});
