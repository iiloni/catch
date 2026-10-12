import {
  type Attachment,
  attachmentUrl,
  extractLinks,
  type LinkPreview,
  MAX_NOTE_LINKS,
  type Note,
  type WidgetSnapshot,
} from '@catch/shared';
import { resolveAttachmentUrl } from './attachmentFiles';
import { getServerUrl } from './serverUrl';

export type WidgetImageSource = { kind: 'attachment'; id: string } | { kind: 'link'; id: string };

/** Only ordinary owned notes and their own files may contribute pixels to a launcher. */
export function widgetImageSources(
  account: string,
  notes: readonly Note[],
  files: readonly Attachment[],
  previews: readonly LinkPreview[],
  showLinks: boolean,
) {
  const links = new Map(
    previews
      .filter((preview) => preview.userId === account)
      .map((preview) => [preview.url, preview]),
  );
  const images = files
    .filter((file) => file.userId === account && file.kind === 'image' && !file.deletedAt)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const sources = new Map<string, WidgetImageSource>();
  for (const note of notes) {
    if (note.userId !== account || note.deletedAt || note.isArchived) continue;
    const attachment = images.find((file) => file.noteId === note.id);
    if (attachment) {
      sources.set(note.id, { kind: 'attachment', id: attachment.id });
      continue;
    }
    if (!showLinks) continue;
    const visible = extractLinks(note.content).filter(
      (link) => !note.hiddenLinks.includes(link.url),
    );
    const chosen = note.galleryPreviewUrl
      ? visible.filter((link) => link.url === note.galleryPreviewUrl)
      : visible.slice(0, MAX_NOTE_LINKS);
    const preview = chosen.map((link) => links.get(link.url)).find((preview) => preview?.imageHash);
    if (preview?.imageHash && /^[a-f0-9]{64}$/.test(preview.imageHash))
      sources.set(note.id, { kind: 'link', id: preview.imageHash });
  }
  return sources;
}

async function thumbnail(source: WidgetImageSource): Promise<string> {
  const url =
    source.kind === 'attachment'
      ? await resolveAttachmentUrl(attachmentUrl(source.id), true)
      : `${getServerUrl()}/api/link-previews/assets/${source.id}`;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image preview is unavailable');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.8, 0.6, 0.4]) {
    const encoded = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    if (encoded && encoded.length <= 64000) return encoded;
  }
  throw new Error('Image preview is too large');
}

/** Text publishes immediately. Late image reads always augment the latest snapshot. */
export function widgetImagePublisher(
  publish: (snapshot: WidgetSnapshot) => void,
  load = thumbnail,
) {
  const cache = new Map<string, string>();
  const pending = new Set<string>();
  const failures = new Map<string, number>();
  let stopped = false;
  let latest: WidgetSnapshot | undefined;
  let sources = new Map<string, WidgetImageSource>();
  let active = 0;
  const key = (source: WidgetImageSource) => `${source.kind}:${source.id}`;
  const send = () => {
    if (stopped || !latest) return;
    publish({
      ...latest,
      notes: latest.notes.map((note) => {
        const source = sources.get(note.id);
        const image = source && cache.get(key(source));
        return source ? { ...note, imageKey: key(source), ...(image ? { image } : {}) } : note;
      }),
    });
  };
  const drain = () => {
    if (stopped) return;
    for (const source of sources.values()) {
      const id = key(source);
      if (active >= 4) break;
      if (cache.has(id) || pending.has(id) || Date.now() - (failures.get(id) ?? 0) < 30000)
        continue;
      pending.add(id);
      active++;
      void load(source)
        .then((image) => {
          if (!stopped) {
            cache.set(id, image);
            send();
          }
        })
        .catch(() => {
          failures.set(id, Date.now());
        })
        .finally(() => {
          active--;
          pending.delete(id);
          drain();
        });
    }
  };
  return {
    update(snapshot: WidgetSnapshot, next = new Map<string, WidgetImageSource>()) {
      latest = snapshot;
      sources = next;
      send();
      drain();
    },
    retry() {
      failures.clear();
      drain();
    },
    stop() {
      stopped = true;
      cache.clear();
      sources.clear();
    },
  };
}
