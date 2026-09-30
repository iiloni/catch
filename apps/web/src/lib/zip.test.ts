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
