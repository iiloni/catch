/** Builds zip archives for tests: stored or deflated files, with or without ZIP64 records. */

type ZipFile = { name: string; text: string; stored?: boolean };

const encoder = new TextEncoder();

async function deflate(data: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function zip64Extra(uncompressed: number, compressed: number, offset: number) {
  const extra = new DataView(new ArrayBuffer(28));
  extra.setUint16(0, 0x0001, true);
  extra.setUint16(2, 24, true);
  extra.setBigUint64(4, BigInt(uncompressed), true);
  extra.setBigUint64(12, BigInt(compressed), true);
  extra.setBigUint64(20, BigInt(offset), true);
  return new Uint8Array(extra.buffer);
}

export async function makeZip(files: readonly ZipFile[], { zip64 = false } = {}) {
  const body: Uint8Array<ArrayBuffer>[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = encoder.encode(file.text);
    const data = file.stored ? raw : await deflate(raw);
    const method = file.stored ? 0 : 8;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, method, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    body.push(new Uint8Array(local.buffer), name, data);

    const extra = zip64 ? zip64Extra(raw.length, data.length, offset) : new Uint8Array(0);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(10, method, true);
    entry.setUint32(20, zip64 ? 0xffffffff : data.length, true);
    entry.setUint32(24, zip64 ? 0xffffffff : raw.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint16(30, extra.length, true);
    entry.setUint32(42, zip64 ? 0xffffffff : offset, true);
    directory.push(new Uint8Array(entry.buffer), name, extra);

    offset += 30 + name.length + data.length;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);

  const records: Uint8Array<ArrayBuffer>[] = [];
  if (zip64) {
    const record = new DataView(new ArrayBuffer(56));
    record.setUint32(0, 0x06064b50, true);
    record.setBigUint64(4, 44n, true);
    record.setBigUint64(24, BigInt(files.length), true);
    record.setBigUint64(32, BigInt(files.length), true);
    record.setBigUint64(40, BigInt(size), true);
    record.setBigUint64(48, BigInt(offset), true);
    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, 0x07064b50, true);
    locator.setBigUint64(8, BigInt(offset + size), true);
    records.push(new Uint8Array(record.buffer), new Uint8Array(locator.buffer));
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, zip64 ? 0xffff : files.length, true);
  end.setUint16(10, zip64 ? 0xffff : files.length, true);
  end.setUint32(12, zip64 ? 0xffffffff : size, true);
  end.setUint32(16, zip64 ? 0xffffffff : offset, true);
  records.push(new Uint8Array(end.buffer));

  return new Blob([...body, ...directory, ...records], { type: 'application/zip' });
}
