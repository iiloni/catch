import { findBareUrls, MAX_ATTACHMENT_BYTES, type NoteColor, normalizeUrl } from '@catch/shared';
import { sha256 } from '@noble/hashes/sha2.js';
import { z } from 'zod';
import type { ImportedAttachment } from './attachments';
import type { ImportedNote } from './notes';
import { readZip, ZipError } from './zip';

/** A problem with the files chosen, worded for the person who chose them. */
export class KeepImportError extends Error {}

/**
 * A note as Google Takeout exports it from Keep. Fields come and go between export versions,
 * so only the edit time is required; it also tells notes from other JSON in the archive.
 */
const keepNoteSchema = z.object({
  title: z.string().optional(),
  textContent: z.string().optional(),
  listContent: z
    .array(z.object({ text: z.string(), isChecked: z.boolean().optional() }))
    .optional(),
  color: z.string().optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isTrashed: z.boolean().optional(),
  createdTimestampUsec: z.number().optional(),
  userEditedTimestampUsec: z.number(),
  labels: z.array(z.unknown()).optional(),
  annotations: z.array(z.object({ url: z.string().optional() })).optional(),
  attachments: z.array(z.unknown()).optional(),
});

export type KeepNote = z.infer<typeof keepNoteSchema>;

// Keep renamed its colors (Coral, Peach, Sand, Mint, Sage, Fog, Storm, Dusk, Blossom, Clay,
// Chalk) but still exports the old names.
const KEEP_COLORS: Record<string, NoteColor> = {
  RED: 'red',
  ORANGE: 'orange',
  YELLOW: 'yellow',
  GREEN: 'green',
  TEAL: 'teal',
  BLUE: 'blue',
  CERULEAN: 'dark-blue',
  PURPLE: 'purple',
  PINK: 'pink',
  BROWN: 'brown',
  GRAY: 'gray',
};

type Block = Record<string, unknown>;

const text = (value: string): Block => ({ type: 'text', text: value, styles: {} });

/** Plain text as inline content, with the web addresses in it made into links. */
function inline(value: string): Block[] {
  const content: Block[] = [];
  let at = 0;
  for (const { index, url } of findBareUrls(value)) {
    if (index > at) content.push(text(value.slice(at, index)));
    content.push({ type: 'link', href: url, content: [text(url)] });
    at = index + url.length;
  }
  if (at < value.length) content.push(text(value.slice(at)));
  return content;
}

/** One paragraph per line. Blank lines between paragraphs stay; those around them do not. */
function paragraphs(value: string): Block[] {
  const lines = value.split(/\r\n?|\n/);
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return [];
  const last = lines.findLastIndex((line) => line.trim());
  return lines.slice(first, last + 1).map((line) => ({ type: 'paragraph', content: inline(line) }));
}

/**
 * A Keep note's content as BlockNote blocks: its title as the heading Catch uses for titles,
 * then its text or checklist. Keep shows a card for each link in a note; links it found
 * outside the note's text are added at the end, so their previews come along.
 */
export function keepNoteContent(note: KeepNote): Block[] {
  const blocks: Block[] = [];
  const title = note.title?.trim();
  if (title) blocks.push({ type: 'heading', props: { level: 3 }, content: inline(title) });
  if (note.textContent) blocks.push(...paragraphs(note.textContent));
  for (const item of note.listContent ?? []) {
    blocks.push({
      type: 'checkListItem',
      props: { checked: item.isChecked ?? false },
      content: inline(item.text),
    });
  }

  const written = [note.title, note.textContent, ...(note.listContent ?? []).map((i) => i.text)]
    .flatMap((value) => (value ? findBareUrls(value) : []))
    .map(({ url }) => normalizeUrl(url));
  const seen = new Set(written);
  for (const { url } of note.annotations ?? []) {
    const normalized = url ? normalizeUrl(url) : null;
    if (!url || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    blocks.push({
      type: 'paragraph',
      content: [{ type: 'link', href: url, content: [text(url)] }],
    });
  }
  return blocks;
}

const fromMicroseconds = (usec: number) => new Date(Math.floor(usec / 1000));

/**
 * A UUIDv7 made from the note's creation time and a hash of the user and `key`, rather than
 * at random. Importing the same export again then gives each note the id it got the first
 * time, so notes already here are skipped, and an import cut short can simply be run again.
 */
export function importedNoteId(userId: string, created: Date, key: string) {
  // Not `crypto.subtle`: browsers leave it out on plain HTTP, which Catch also serves.
  const digest = sha256(new TextEncoder().encode(`${userId}\n${key}`));
  const bytes = new Uint8Array(16);
  let time = Math.max(0, created.getTime());
  for (let index = 5; index >= 0; index--) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes.set(digest.subarray(0, 10), 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const keepAttachmentSchema = z.object({
  filePath: z.string().min(1),
  mimetype: z.string().optional(),
  mimeType: z.string().optional(),
});

/** What a Keep export holds, ready for `startImport`. */
export type KeepExport = {
  /** Newest first, as Keep's own order is not in the export. */
  notes: ImportedNote[];
  /** Notes in Keep's trash, which are left out. */
  trashed: number;
  /** Media-only notes left out because none of their files could be matched. */
  mediaOnly: number;
  /** Files matched to notes, read only after confirmation. */
  attachments: number;
  files: ImportedAttachment[];
  missing: number;
  oversized: number;
  /** Notes with labels; Catch does not have labels yet. */
  labelled: number;
};

type JsonFile = Source & { text: string };

/** A JSON file to read: one chosen directly, or one inside a chosen zip archive. */
type Source = {
  name: string;
  archive: string | null;
  size: number;
  read: (limit?: number) => Promise<Blob>;
};

const isZip = (file: File) => /\.zip$/i.test(file.name) || file.type.includes('zip');
const isTarball = (file: File) => /\.(tgz|tar\.gz|tar)$/i.test(file.name);

const unreadable = (archive: string, error: ZipError) =>
  new KeepImportError(`${archive} could not be read. ${error.message}`);

/** Index chosen files and ZIP entries without loading media bytes. */
async function fileSources(files: readonly File[]): Promise<Source[]> {
  const sources: Source[] = [];
  for (const file of files) {
    if (isTarball(file)) {
      throw new KeepImportError(
        'Catch reads Takeout’s .zip archives. Export again and choose .zip as the file type.',
      );
    }
    if (isZip(file)) {
      let entries: Awaited<ReturnType<typeof readZip>>;
      try {
        entries = await readZip(file);
      } catch (error) {
        if (error instanceof ZipError) throw unreadable(file.name, error);
        throw error;
      }
      for (const entry of entries) {
        sources.push({ name: entry.name, archive: file.name, size: entry.size, read: entry.blob });
      }
    } else {
      sources.push({
        name: file.webkitRelativePath || file.name,
        archive: null,
        size: file.size,
        read: async () => file,
      });
    }
  }
  return sources;
}

type ReadOptions = {
  /** Called as files are read: how many so far, of how many JSON files the export holds. */
  onProgress?: (read: number, total: number) => void;
  signal?: AbortSignal;
};

/** Reads every source, reporting each one read and stopping if `signal` aborts. */
async function readSources(sources: readonly Source[], options: ReadOptions): Promise<JsonFile[]> {
  const read: JsonFile[] = [];
  options.onProgress?.(0, sources.length);
  for (const source of sources) {
    options.signal?.throwIfAborted();
    try {
      read.push({ ...source, text: await (await source.read()).text() });
    } catch (error) {
      if (error instanceof ZipError && source.archive) throw unreadable(source.archive, error);
      throw error;
    }
    options.onProgress?.(read.length, sources.length);
  }
  return read;
}

function parseKeepNote(json: string): KeepNote | null {
  try {
    const parsed = keepNoteSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

function path(value: string): string | null {
  const parts: string[] = [];
  for (const part of value.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

function mediaMatcher(sources: Source[]) {
  const names = new Map<string, Source[]>();
  const basenames = new Map<string, Source[]>();
  for (const source of sources) {
    const name = path(source.name);
    if (!name) continue;
    names.set(name, [...(names.get(name) ?? []), source]);
    const basename = name.split('/').at(-1) ?? name;
    basenames.set(basename, [...(basenames.get(basename) ?? []), source]);
  }
  return (json: Source, reference: string): Source | undefined => {
    const name = path(reference);
    if (!name) return;
    const folder = json.name.slice(0, json.name.lastIndexOf('/') + 1);
    for (const candidate of [path(folder + reference), name]) {
      if (!candidate) continue;
      const matches = names.get(candidate) ?? [];
      const local = matches.filter((source) => source.archive === json.archive);
      if (local.length === 1) return local[0];
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return;
    }
    // Unpacked files can lose their directory in a file picker. Never guess between two
    // files with the same basename.
    const matches = basenames.get(name.split('/').at(-1) ?? name);
    return matches?.length === 1 ? matches[0] : undefined;
  };
}

/**
 * Reads the notes in a Google Takeout export of Keep: its .zip archives (every part of a
 * split export may be chosen at once), or the .json files from an unpacked one.
 */
export async function readKeepExport(
  files: readonly File[],
  userId: string,
  options: ReadOptions = {},
): Promise<KeepExport> {
  const sources = await fileSources(files);
  const match = mediaMatcher(sources);
  const found = await readSources(
    sources.filter((source) => /\.json$/i.test(source.name)),
    options,
  );
  // The same file chosen twice, loose and inside its archive, is one note.
  const unique = [...new Map(found.map((file) => [file.text, file])).values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const result: KeepExport = {
    notes: [],
    files: [],
    trashed: 0,
    mediaOnly: 0,
    attachments: 0,
    missing: 0,
    oversized: 0,
    labelled: 0,
  };
  const parsedNotes = unique.flatMap((file) => {
    const note = parseKeepNote(file.text);
    return note ? [{ file, note, content: keepNoteContent(note) }] : [];
  });
  // Keep the ids of text notes from older imports, even if media-only notes share a timestamp.
  parsedNotes.sort((a, b) => Number(a.content.length === 0) - Number(b.content.length === 0));
  const keys = new Map<string, number>();
  for (const { file, note, content } of parsedNotes) {
    if (note.isTrashed) {
      result.trashed += 1;
      continue;
    }
    const attachments = note.attachments?.length ?? 0;
    if (content.length === 0 && attachments === 0) continue;

    const createdUsec = note.createdTimestampUsec ?? note.userEditedTimestampUsec;
    // A note is known by when it was made. Two made in the same microsecond are told apart
    // by the order of their files.
    const seen = keys.get(String(createdUsec)) ?? 0;
    keys.set(String(createdUsec), seen + 1);
    const key = seen === 0 ? `keep:${createdUsec}` : `keep:${createdUsec}#${seen}`;
    const createdAt = fromMicroseconds(createdUsec);

    const id = importedNoteId(userId, createdAt, key);
    const matched: ImportedAttachment[] = [];
    const seenFiles = new Set<string>();
    for (const value of note.attachments ?? []) {
      const parsed = keepAttachmentSchema.safeParse(value);
      const reference = parsed.success ? parsed.data : null;
      const filename = reference ? path(reference.filePath) : null;
      if (filename && seenFiles.has(filename)) continue;
      if (filename) seenFiles.add(filename);
      const source = reference ? match(file, reference.filePath) : undefined;
      if (!source?.size || !filename) {
        result.missing += 1;
        continue;
      }
      if (source.size > MAX_ATTACHMENT_BYTES) {
        result.oversized += 1;
        continue;
      }
      const name = filename.split('/').at(-1) ?? filename;
      const mimeType =
        reference?.mimetype ||
        reference?.mimeType ||
        MIME_TYPES[name.split('.').at(-1)?.toLowerCase() ?? ''] ||
        'application/octet-stream';
      matched.push({
        id: importedNoteId(userId, createdAt, `keep-attachment:${id}:${filename}`),
        noteId: id,
        createdAt,
        read: async () =>
          new File([await source.read(MAX_ATTACHMENT_BYTES)], name, { type: mimeType }),
      });
    }
    if (content.length === 0 && matched.length === 0) {
      result.mediaOnly += 1;
      continue;
    }
    result.files.push(...matched);
    result.attachments += matched.length;
    if (note.labels?.length) result.labelled += 1;

    result.notes.push({
      id,
      content,
      color: KEEP_COLORS[note.color ?? ''] ?? 'default',
      isPinned: note.isPinned ?? false,
      isArchived: note.isArchived ?? false,
      createdAt,
      updatedAt: fromMicroseconds(note.userEditedTimestampUsec),
    });
  }
  if (parsedNotes.length === 0) {
    throw new KeepImportError('There are no Google Keep notes in the files you chose.');
  }
  result.notes.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return result;
}
