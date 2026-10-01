import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readZip, ZipWriter } from './zip';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'catch-zip-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Each file's size and checksum: comparing large buffers element by element is slow. */
async function contents(path: string) {
  const files: Record<string, string> = {};
  for (const entry of await readZip(path)) {
    const chunks: Buffer[] = [];
    for await (const chunk of await entry.open()) chunks.push(chunk as Buffer);
    const data = Buffer.concat(chunks);
    expect(data).toHaveLength(entry.size);
    files[entry.name] = `${data.length} ${sha256(data)}`;
  }
  return files;
}

const FILES = {
  'database.dump': Buffer.from([0, 255, 128, 13, 10, 0, 42]),
  'attachments/café ☕': Buffer.alloc(200_000, 7),
  empty: Buffer.alloc(0),
};
const EXPECTED = Object.fromEntries(
  Object.entries(FILES).map(([name, data]) => [name, `${data.length} ${sha256(data)}`]),
);

async function write(path: string, options?: { forceZip64: boolean }) {
  const writer = await ZipWriter.create(path, options);
  for (const [name, data] of Object.entries(FILES)) {
    // In pieces, as a file stream delivers them.
    const pieces = [data.subarray(0, 3), data.subarray(3)];
    expect(await writer.add(name, data.length, pieces)).toEqual({
      size: data.length,
      sha256: sha256(data),
    });
  }
  await writer.finish();
}

describe('zip', () => {
  it('reads back what it wrote, byte for byte', async () => {
    const path = join(dir, 'a.zip');
    await write(path);
    expect(await contents(path)).toEqual(EXPECTED);
  });

  it('reads back ZIP64 records', async () => {
    const path = join(dir, 'a.zip');
    await write(path, { forceZip64: true });
    expect(await contents(path)).toEqual(EXPECTED);
  });

  it('refuses a file whose size is not the one it was given', async () => {
    const writer = await ZipWriter.create(join(dir, 'a.zip'));
    await expect(writer.add('short', 10, [Buffer.alloc(4)])).rejects.toThrow(/changed size/);
    await expect(writer.add('long', 2, [Buffer.alloc(4)])).rejects.toThrow(/changed size/);
    await writer.abort();
  });

  it('does not overwrite an existing file', async () => {
    const path = join(dir, 'a.zip');
    await writeFile(path, 'here already');
    await expect(ZipWriter.create(path)).rejects.toThrow(/EEXIST/);
  });

  it('rejects files that are not archives, or were cut short', async () => {
    const path = join(dir, 'a.zip');
    await writeFile(path, 'not a zip');
    await expect(readZip(path)).rejects.toThrow('It is not a zip archive.');

    await rm(path);
    await write(path);
    await truncate(path, (await readFile(path)).length - 30);
    await expect(readZip(path)).rejects.toThrow(/not a zip archive|damaged/);
  });

  it('rejects compressed files, which backups never hold', async () => {
    const path = join(dir, 'a.zip');
    await write(path);
    const bytes = await readFile(path);
    // The compression method of the first central directory record.
    const record = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt16LE(8, record + 10);
    await writeFile(path, bytes);
    await expect(readZip(path)).rejects.toThrow(/never use/);
  });
});
