import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { BackupError } from './errors';

/**
 * Zip archives of stored (uncompressed) files, written and read through file handles so an
 * archive of any size never has to fit in memory. Backups hold a Postgres dump and media,
 * which are compressed already. Like the web app's reader (ADR 0008), this takes no zip
 * dependency: the format is small when nothing is deflated.
 */
const LOCAL_HEADER = 0x04034b50;
const DIRECTORY_ENTRY = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_DIRECTORY = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EXTRA = 0x0001;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const UTF8_NAMES = 0x0800;
const ENCRYPTED = 0x0001;
const STORED = 0;
// Made on Unix, so the mode below applies: backups hold everyone's notes.
const MADE_BY = (3 << 8) | 45;
const PRIVATE_FILE = ((0o100600 << 16) >>> 0) as number;
const END_OF_DIRECTORY_SIZE = 22;
const MAX_DIRECTORY_BYTES = 512 * 1024 * 1024;

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

type Written = { name: Buffer; size: number; crc: number; offset: number; zip64: boolean };

export class ZipWriter {
  private offset = 0;
  private readonly entries: Written[] = [];
  private readonly stamp = dosDateTime(new Date());

  private constructor(
    private readonly handle: FileHandle,
    private readonly forceZip64: boolean,
  ) {}

  /** `forceZip64` writes ZIP64 records regardless of size, to test them with small files. */
  static async create(path: string, { forceZip64 = false } = {}) {
    return new ZipWriter(await open(path, 'wx', 0o600), forceZip64);
  }

  private async write(data: Uint8Array) {
    await this.handle.write(data, 0, data.byteLength, this.offset);
    this.offset += data.byteLength;
  }

  /**
   * Adds a file of a known size and returns its SHA-256. The size goes in the header before
   * the data, and the checksum is filled in behind it, so readers need no data descriptor.
   */
  async add(name: string, size: number, source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) {
    const encoded = Buffer.from(name, 'utf8');
    const start = this.offset;
    const zip64 = this.forceZip64 || size >= UINT32_MAX;
    const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(ZIP64_EXTRA, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(size), 4);
      extra.writeBigUInt64LE(BigInt(size), 12);
    }
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER, 0);
    header.writeUInt16LE(zip64 ? 45 : 20, 4);
    header.writeUInt16LE(UTF8_NAMES, 6);
    header.writeUInt16LE(STORED, 8);
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.date, 12);
    header.writeUInt32LE(zip64 ? UINT32_MAX : size, 18);
    header.writeUInt32LE(zip64 ? UINT32_MAX : size, 22);
    header.writeUInt16LE(encoded.length, 26);
    header.writeUInt16LE(extra.length, 28);
    await this.write(Buffer.concat([header, encoded, extra]));

    const hash = createHash('sha256');
    let crc = 0;
    let written = 0;
    for await (const chunk of source) {
      written += chunk.byteLength;
      if (written > size) break;
      crc = crc32(chunk, crc);
      hash.update(chunk);
      await this.write(chunk);
    }
    if (written !== size) throw new BackupError(`${name} changed size while it was being archived`);

    const checksum = Buffer.alloc(4);
    checksum.writeUInt32LE(crc, 0);
    await this.handle.write(checksum, 0, 4, start + 14);
    this.entries.push({ name: encoded, size, crc, offset: start, zip64 });
    return { size, sha256: hash.digest('hex') };
  }

  /** Writes the central directory and closes the file. */
  async finish() {
    const start = this.offset;
    for (const entry of this.entries) {
      const bigOffset = this.forceZip64 || entry.offset >= UINT32_MAX;
      // Holds, in this order, whichever fields did not fit in the 32-bit ones.
      const fields = [
        ...(entry.zip64 ? [entry.size, entry.size] : []),
        ...(bigOffset ? [entry.offset] : []),
      ];
      const extra = Buffer.alloc(fields.length > 0 ? 4 + fields.length * 8 : 0);
      if (fields.length > 0) {
        extra.writeUInt16LE(ZIP64_EXTRA, 0);
        extra.writeUInt16LE(fields.length * 8, 2);
        for (const [index, value] of fields.entries()) {
          extra.writeBigUInt64LE(BigInt(value), 4 + index * 8);
        }
      }
      const record = Buffer.alloc(46);
      record.writeUInt32LE(DIRECTORY_ENTRY, 0);
      record.writeUInt16LE(MADE_BY, 4);
      record.writeUInt16LE(fields.length > 0 ? 45 : 20, 6);
      record.writeUInt16LE(UTF8_NAMES, 8);
      record.writeUInt16LE(STORED, 10);
      record.writeUInt16LE(this.stamp.time, 12);
      record.writeUInt16LE(this.stamp.date, 14);
      record.writeUInt32LE(entry.crc, 16);
      record.writeUInt32LE(entry.zip64 ? UINT32_MAX : entry.size, 20);
      record.writeUInt32LE(entry.zip64 ? UINT32_MAX : entry.size, 24);
      record.writeUInt16LE(entry.name.length, 28);
      record.writeUInt16LE(extra.length, 30);
      record.writeUInt32LE(PRIVATE_FILE, 38);
      record.writeUInt32LE(bigOffset ? UINT32_MAX : entry.offset, 42);
      await this.write(Buffer.concat([record, entry.name, extra]));
    }
    const size = this.offset - start;
    const count = this.entries.length;

    const zip64 =
      this.forceZip64 || count >= UINT16_MAX || size >= UINT32_MAX || start >= UINT32_MAX;
    if (zip64) {
      const record = Buffer.alloc(56);
      record.writeUInt32LE(ZIP64_END_OF_DIRECTORY, 0);
      record.writeBigUInt64LE(44n, 4);
      record.writeUInt16LE(MADE_BY, 12);
      record.writeUInt16LE(45, 14);
      record.writeBigUInt64LE(BigInt(count), 24);
      record.writeBigUInt64LE(BigInt(count), 32);
      record.writeBigUInt64LE(BigInt(size), 40);
      record.writeBigUInt64LE(BigInt(start), 48);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(ZIP64_LOCATOR, 0);
      locator.writeBigUInt64LE(BigInt(this.offset), 8);
      locator.writeUInt32LE(1, 16);
      await this.write(Buffer.concat([record, locator]));
    }
    const end = Buffer.alloc(END_OF_DIRECTORY_SIZE);
    end.writeUInt32LE(END_OF_DIRECTORY, 0);
    end.writeUInt16LE(zip64 ? UINT16_MAX : count, 8);
    end.writeUInt16LE(zip64 ? UINT16_MAX : count, 10);
    end.writeUInt32LE(zip64 ? UINT32_MAX : size, 12);
    end.writeUInt32LE(zip64 ? UINT32_MAX : start, 16);
    await this.write(end);
    await this.handle.sync();
    await this.handle.close();
  }

  /** Closes the file after a failure. The caller removes it. */
  async abort() {
    await this.handle.close().catch(() => {});
  }
}

/** A file in an archive. `open` reads it from disk as a stream when asked. */
export type ZipEntry = { name: string; size: number; open: () => Promise<Readable> };

async function read(handle: FileHandle, position: number, length: number) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new BackupError('The archive is damaged.');
  return buffer;
}

/**
 * Lists the files in an archive from its central directory. Only stored files are accepted:
 * an archive with anything else was not written by `ZipWriter`.
 */
export async function readZip(path: string): Promise<ZipEntry[]> {
  const handle = await open(path, 'r');
  try {
    const total = (await handle.stat()).size;
    const tailStart = Math.max(0, total - END_OF_DIRECTORY_SIZE - UINT16_MAX);
    const tail = await read(handle, tailStart, total - tailStart);
    let end = -1;
    for (let at = tail.length - END_OF_DIRECTORY_SIZE; at >= 0; at--) {
      if (tail.readUInt32LE(at) === END_OF_DIRECTORY) {
        end = at;
        break;
      }
    }
    if (end < 0) throw new BackupError('It is not a zip archive.');

    let count = tail.readUInt16LE(end + 10);
    let size = tail.readUInt32LE(end + 12);
    let offset = tail.readUInt32LE(end + 16);
    if (count === UINT16_MAX || size === UINT32_MAX || offset === UINT32_MAX) {
      const locator = end - 20;
      if (locator < 0 || tail.readUInt32LE(locator) !== ZIP64_LOCATOR) {
        throw new BackupError('The archive is damaged.');
      }
      const record = await read(handle, Number(tail.readBigUInt64LE(locator + 8)), 56);
      if (record.readUInt32LE(0) !== ZIP64_END_OF_DIRECTORY) {
        throw new BackupError('The archive is damaged.');
      }
      count = Number(record.readBigUInt64LE(32));
      size = Number(record.readBigUInt64LE(40));
      offset = Number(record.readBigUInt64LE(48));
    }
    if (size > MAX_DIRECTORY_BYTES || offset + size > total) {
      throw new BackupError('The archive is damaged.');
    }

    const directory = await read(handle, offset, size);
    const entries: ZipEntry[] = [];
    let at = 0;
    for (let index = 0; index < count; index++) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== DIRECTORY_ENTRY) {
        throw new BackupError('The archive is damaged.');
      }
      const flags = directory.readUInt16LE(at + 8);
      const method = directory.readUInt16LE(at + 10);
      let compressedSize = directory.readUInt32LE(at + 20);
      let entrySize = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      let localOffset = directory.readUInt32LE(at + 42);
      const extraStart = at + 46 + nameLength;
      const extraEnd = extraStart + extraLength;
      if (extraEnd + commentLength > directory.length) {
        throw new BackupError('The archive is damaged.');
      }
      const name = directory.toString('utf8', at + 46, extraStart);

      for (let field = extraStart; field + 4 <= extraEnd; ) {
        const id = directory.readUInt16LE(field);
        const length = directory.readUInt16LE(field + 2);
        if (id === ZIP64_EXTRA) {
          let value = field + 4;
          const next = () => {
            if (value + 8 > extraEnd) throw new BackupError('The archive is damaged.');
            const big = Number(directory.readBigUInt64LE(value));
            value += 8;
            return big;
          };
          if (entrySize === UINT32_MAX) entrySize = next();
          if (compressedSize === UINT32_MAX) compressedSize = next();
          if (localOffset === UINT32_MAX) localOffset = next();
        }
        field += 4 + length;
      }
      at = extraEnd + commentLength;

      if (name.endsWith('/')) continue;
      if (flags & ENCRYPTED || method !== STORED || compressedSize !== entrySize) {
        throw new BackupError(`${name} is stored in a way Catch backups never use.`);
      }
      const start = localOffset;
      const length = entrySize;
      entries.push({
        name,
        size: length,
        open: () => openEntry(path, total, start, length),
      });
    }
    return entries;
  } finally {
    await handle.close();
  }
}

async function openEntry(path: string, total: number, offset: number, size: number) {
  const handle = await open(path, 'r');
  let start: number;
  try {
    if (offset + 30 > total) throw new BackupError('The archive is damaged.');
    const header = await read(handle, offset, 30);
    if (header.readUInt32LE(0) !== LOCAL_HEADER) throw new BackupError('The archive is damaged.');
    // The local header's own name and extra field can differ in length from the directory's.
    start = offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  } finally {
    await handle.close();
  }
  if (start + size > total) throw new BackupError('The archive is damaged.');
  return size === 0 ? Readable.from([]) : createReadStream(path, { start, end: start + size - 1 });
}
