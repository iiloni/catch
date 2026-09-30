/** A file in a zip archive, read when asked for. */
export type ZipEntry = { name: string; text: () => Promise<string> };

export class ZipError extends Error {}

const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END_OF_DIRECTORY = 0x06064b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const ZIP64_EXTRA = 0x0001;
const END_OF_DIRECTORY_SIZE = 22;
const MAX_COMMENT = 0xffff;
const STORED = 0;
const DEFLATED = 8;

async function view(blob: Blob, start: number, end: number) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/**
 * Lists the files in a zip archive from its central directory. Only the directory is read
 * here, and each file only when asked for, so a Takeout archive of several gigabytes never
 * has to fit in memory. Reads stored and deflated files, and ZIP64 archives.
 */
export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, blob.size - END_OF_DIRECTORY_SIZE - MAX_COMMENT);
  const tail = await view(blob, tailStart, blob.size);
  let end = -1;
  for (let at = tail.byteLength - END_OF_DIRECTORY_SIZE; at >= 0; at--) {
    if (tail.getUint32(at, true) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipError('It is not a zip archive.');

  let count = tail.getUint16(end + 10, true);
  let size = tail.getUint32(end + 12, true);
  let offset = tail.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    // Too big for these fields: the real values are in a ZIP64 record, found through the
    // locator just before this one.
    const locator = end - 20;
    if (locator < 0 || tail.getUint32(locator, true) !== ZIP64_LOCATOR) {
      throw new ZipError('The archive is damaged.');
    }
    const at = Number(tail.getBigUint64(locator + 8, true));
    const record = await view(blob, at, at + 56);
    if (record.getUint32(0, true) !== ZIP64_END_OF_DIRECTORY) {
      throw new ZipError('The archive is damaged.');
    }
    count = Number(record.getBigUint64(32, true));
    size = Number(record.getBigUint64(40, true));
    offset = Number(record.getBigUint64(48, true));
  }

  const directory = await view(blob, offset, offset + size);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.byteLength || directory.getUint32(at, true) !== DIRECTORY_ENTRY) {
      throw new ZipError('The archive is damaged.');
    }
    const flags = directory.getUint16(at + 8, true);
    const method = directory.getUint16(at + 10, true);
    let compressedSize = directory.getUint32(at + 20, true);
    const uncompressedSize = directory.getUint32(at + 24, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    let localOffset = directory.getUint32(at + 42, true);
    const nameStart = directory.byteOffset + at + 46;
    const name = decoder.decode(new Uint8Array(directory.buffer, nameStart, nameLength));

    const extraEnd = at + 46 + nameLength + extraLength;
    for (let field = at + 46 + nameLength; field + 4 <= extraEnd; ) {
      const id = directory.getUint16(field, true);
      const length = directory.getUint16(field + 2, true);
      if (id === ZIP64_EXTRA) {
        // Holds, in order, whichever of these the entry marked as too big.
        let value = field + 4;
        const next = () => {
          const read = Number(directory.getBigUint64(value, true));
          value += 8;
          return read;
        };
        if (uncompressedSize === 0xffffffff) next();
        if (compressedSize === 0xffffffff) compressedSize = next();
        if (localOffset === 0xffffffff) localOffset = next();
      }
      field += 4 + length;
    }
    at = extraEnd + commentLength;

    if (name.endsWith('/')) continue;
    entries.push({
      name,
      text: () => readEntry(blob, { name, flags, method, compressedSize, localOffset }),
    });
  }
  return entries;
}

async function readEntry(
  blob: Blob,
  entry: {
    name: string;
    flags: number;
    method: number;
    compressedSize: number;
    localOffset: number;
  },
) {
  if (entry.flags & 1) throw new ZipError(`${entry.name} is encrypted.`);
  const header = await view(blob, entry.localOffset, entry.localOffset + 30);
  if (header.getUint32(0, true) !== LOCAL_HEADER) throw new ZipError('The archive is damaged.');
  // The local header's own name and extra field can differ in length from the directory's.
  const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = blob.slice(start, start + entry.compressedSize);
  if (entry.method === STORED) return data.text();
  if (entry.method === DEFLATED) {
    return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  }
  throw new ZipError(`${entry.name} is compressed in a way Catch cannot read.`);
}
