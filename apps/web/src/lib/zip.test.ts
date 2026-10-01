// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeZip } from '@/test/zip';
import { readZip, ZipError } from './zip';

async function contents(blob: Blob) {
  const entries = await readZip(blob);
  return Promise.all(entries.map(async (entry) => [entry.name, await entry.text()]));
}

describe('readZip', () => {
  it('reads stored and deflated files, with names in UTF-8', async () => {
    const zip = await makeZip([
      { name: 'Takeout/Keep/Shopping.json', text: '{"title":"Shopping"}' },
      { name: 'Takeout/Keep/Café ☕.json', text: 'plain', stored: true },
    ]);
    expect(await contents(zip)).toEqual([
      ['Takeout/Keep/Shopping.json', '{"title":"Shopping"}'],
      ['Takeout/Keep/Café ☕.json', 'plain'],
    ]);
  });

  it('reads ZIP64 archives', async () => {
    const zip = await makeZip(
      [
        { name: 'a.txt', text: 'first' },
        { name: 'b.txt', text: 'second '.repeat(100) },
      ],
      { zip64: true },
    );
    expect(await contents(zip)).toEqual([
      ['a.txt', 'first'],
      ['b.txt', 'second '.repeat(100)],
    ]);
  });

  it('preserves binary bytes in stored, deflated and ZIP64 files', async () => {
    const bytes = new Uint8Array([0, 255, 128, 13, 10, 0, 42]);
    for (const zip64 of [false, true]) {
      const entries = await readZip(
        await makeZip(
          [
            { name: 'image.bin', bytes, stored: true },
            { name: 'audio.bin', bytes },
          ],
          { zip64 },
        ),
      );
      for (const entry of entries) {
        expect(entry.size).toBe(bytes.length);
        expect(new Uint8Array(await (await entry.blob(bytes.length)).arrayBuffer())).toEqual(bytes);
        await expect(entry.blob(bytes.length - 1)).rejects.toThrow(/size limit/);
      }
    }
  });

  it('rejects decompressed output larger than its declared size', async () => {
    const bytes = new Uint8Array(
      await (await makeZip([{ name: 'bomb.bin', text: 'x'.repeat(1000) }])).arrayBuffer(),
    );
    const directory = bytes.findIndex(
      (_value, at) =>
        bytes[at] === 0x50 && bytes[at + 1] === 0x4b && bytes[at + 2] === 1 && bytes[at + 3] === 2,
    );
    new DataView(bytes.buffer).setUint32(directory + 24, 1, true);
    const entry = (await readZip(new Blob([bytes])))[0];
    await expect(entry?.blob(10)).rejects.toThrow(/declared size/);
  });

  it('skips folders', async () => {
    const zip = await makeZip([
      { name: 'Takeout/', text: '', stored: true },
      { name: 'Takeout/a.txt', text: 'a' },
    ]);
    expect((await readZip(zip)).map((entry) => entry.name)).toEqual(['Takeout/a.txt']);
  });

  it('rejects files that are not zip archives', async () => {
    await expect(readZip(new Blob(['{"not":"a zip"}']))).rejects.toBeInstanceOf(ZipError);
  });
});
