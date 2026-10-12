import { diff_match_patch } from '@dmsnell/diff-match-patch';
import { Unzlib, zlibSync } from 'fflate';
import { create, type Delta } from 'jsondiffpatch';
import {
  HISTORY_ANCHOR_INTERVAL,
  HISTORY_MAX_BYTES,
  type HistoryState,
  historyStateSchema,
} from './history';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

import { canonicalHistory } from './historyCanonical';

export { canonicalHistory } from './historyCanonical';

/** Original byte length is checked before allocating or expanding untrusted compressed data. */
export function packHistory(value: unknown): Uint8Array<ArrayBuffer> {
  const raw = encoder.encode(canonicalHistory(value));
  if (raw.length > HISTORY_MAX_BYTES) throw new Error('History content is too large.');
  const compressed = zlibSync(raw, { level: 6 });
  const useCompressed = compressed.length < raw.length;
  const body = useCompressed ? compressed : raw;
  const out = new Uint8Array(body.length + 5);
  out[0] = useCompressed ? 1 : 0;
  new DataView(out.buffer).setUint32(1, raw.length);
  out.set(body, 5);
  return out;
}

export function unpackHistory(data: Uint8Array): unknown {
  if (data.length < 5 || data.length > HISTORY_MAX_BYTES + 5)
    throw new Error('Invalid history payload.');
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1);
  if (length > HISTORY_MAX_BYTES) throw new Error('History content is too large.');
  const raw = new Uint8Array(length);
  if (data[0] === 0) {
    if (data.length - 5 !== length) throw new Error('Invalid history length.');
    raw.set(data.subarray(5));
  } else if (data[0] === 1) {
    let written = 0;
    const stream = new Unzlib((chunk) => {
      if (written + chunk.length > length) throw new Error('Invalid history length.');
      raw.set(chunk, written);
      written += chunk.length;
    });
    // A small compressed input chunk bounds expansion before the callback checks its size.
    for (let at = 5; at < data.length; at += 1024)
      stream.push(data.subarray(at, at + 1024), at + 1024 >= data.length);
    if (written !== length) throw new Error('Invalid history length.');
  } else throw new Error('Unknown history encoding.');
  return JSON.parse(decoder.decode(raw));
}

function safeForDelta(value: unknown, depth = 0): boolean {
  if (depth > 256) return false;
  if (Array.isArray(value)) return value.every((item) => safeForDelta(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).every(
      ([key, item]) => !unsafeKeys.has(key) && safeForDelta(item, depth + 1),
    );
  }
  return true;
}

/** A cheap replacement check avoids searching for edit scripts across unrelated paragraphs. */
function denseReplacement(before: unknown, after: unknown): boolean {
  let textBytes = 0;
  let replacedBytes = 0;
  function inspect(a: unknown, b: unknown, key: string) {
    if (typeof b === 'string' && (key === 'text' || key === 'content')) {
      const length = Math.max(typeof a === 'string' ? a.length : 0, b.length);
      textBytes += length;
      if (typeof a !== 'string') {
        replacedBytes += length;
        return;
      }
      let prefix = 0;
      while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
      let suffix = 0;
      while (
        suffix < a.length - prefix &&
        suffix < b.length - prefix &&
        a[a.length - suffix - 1] === b[b.length - suffix - 1]
      )
        suffix++;
      if (a.length + b.length - 2 * (prefix + suffix) > length * 0.65) replacedBytes += length;
    } else if (Array.isArray(b)) {
      const prior = Array.isArray(a) ? a : [];
      const byId = new Map(
        prior.flatMap((item: unknown) =>
          item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
            ? [[item.id, item] as const]
            : [],
        ),
      );
      b.forEach((item: unknown, index) => {
        inspect(
          item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
            ? byId.get(item.id)
            : prior[index],
          item,
          String(index),
        );
      });
    } else if (b && typeof b === 'object') {
      for (const [field, item] of Object.entries(b))
        inspect(
          a && typeof a === 'object' ? (a as Record<string, unknown>)[field] : undefined,
          item,
          field,
        );
    }
  }
  inspect(before, after, 'root');
  return textBytes > 0 && replacedBytes / textBytes > 0.35;
}

class BoundedTextDiff extends diff_match_patch {
  constructor() {
    super();
    this.Diff_Timeout = 0.005;
  }
}
const patcher = create({
  objectHash: (item, index) =>
    'id' in item && typeof item.id === 'string' ? `id:${item.id}` : `position:${index}`,
  arrays: { detectMove: true, includeValueOnMove: false },
  textDiff: { minLength: 60, diffMatchPatch: BoundedTextDiff },
  omitRemovedValues: true,
  cloneDiffValues: true,
});

export type EncodedHistory = {
  representation: 'snapshot' | 'delta';
  depth: number;
  data: Uint8Array<ArrayBuffer>;
  snapshot?: Uint8Array<ArrayBuffer>;
};

export function encodeHistory(
  state: HistoryState,
  previous?: { state: HistoryState; depth: number },
): EncodedHistory {
  const snapshot = () => ({
    representation: 'snapshot' as const,
    depth: 0,
    data: packHistory(state),
  });
  if (
    !previous ||
    previous.depth >= HISTORY_ANCHOR_INTERVAL - 1 ||
    !safeForDelta(state) ||
    !safeForDelta(previous.state) ||
    denseReplacement(previous.state, state)
  )
    return snapshot();
  const delta = patcher.diff(previous.state, state) ?? {};
  if (canonicalHistory(delta).length > canonicalHistory(state).length * 0.5) return snapshot();
  // Duplicate/missing ids and unfamiliar shapes must remain exact, even if alignment fails.
  const restored: unknown = patcher.patch(structuredClone(previous.state), structuredClone(delta));
  if (canonicalHistory(restored) !== canonicalHistory(state)) return snapshot();
  const full = packHistory(state);
  const data = packHistory(delta);
  if (data.length >= full.length) return { representation: 'snapshot', depth: 0, data: full };
  return { representation: 'delta', depth: previous.depth + 1, data, snapshot: full };
}

export function decodeHistory(
  data: Uint8Array,
  representation: 'snapshot' | 'delta',
  previous?: HistoryState,
): HistoryState {
  const value = unpackHistory(data);
  if (representation === 'snapshot') return historyStateSchema.parse(value);
  if (!previous || !safeForDelta(previous) || !safeForDelta(value))
    throw new Error('Invalid history delta.');
  const restored: unknown = patcher.patch(structuredClone(previous), value as Delta);
  return historyStateSchema.parse(restored);
}
