import { extractLinks, findBareUrls, type Note, normalizeUrl } from '@catch/shared';
import type { Rect } from './noteTransition';
import { sharedNoteContent } from './shareContent';
import type { IncomingShare } from './shareInbox';
import { createStore } from './store';

export type LinkCaptureDraft = {
  url: string;
  title: string;
  description: string;
  notes: string;
};

export const linkCaptureOpen = createStore(false);
export const linkCaptureOrigin = createStore<Rect | null>(null);
export const linkCaptureReturnFocus = createStore<(() => void) | null>(null);

export type LinkCaptureControls = {
  canSave: boolean;
  busy: boolean;
  saving: boolean;
  save: () => void;
  cancel: () => void;
};
export const linkCaptureControls = createStore<LinkCaptureControls | null>(null);

export type IncomingLinkCapture = { id: string; draft: LinkCaptureDraft };
export const incomingLinkCaptures = createStore<IncomingLinkCapture[]>([]);

export function enqueueLinkCapture(capture: IncomingLinkCapture) {
  const pending = incomingLinkCaptures.get();
  if (!pending.some((item) => item.id === capture.id))
    incomingLinkCaptures.set([...pending, capture]);
}

export function removeLinkCapture(id: string) {
  incomingLinkCaptures.set(incomingLinkCaptures.get().filter((item) => item.id !== id));
}

/** Android sends URLs in text; the PWA can also supply a dedicated URL field. */
export function incomingLinkDraft(share: IncomingShare): LinkCaptureDraft | null {
  if (share.files.length) return null;
  const links = findBareUrls(share.text);
  const explicit = share.url.trim();
  const url = explicit || (links.length === 1 ? links[0]?.url : undefined);
  if (!url || url.length > 2048 || !normalizeUrl(url)) return null;
  // Multiple addresses are better kept together in an ordinary shared note.
  if (links.some((link) => normalizeUrl(link.url) !== normalizeUrl(url))) return null;
  let notes = share.text;
  for (const link of [...links].reverse())
    notes = notes.slice(0, link.index) + notes.slice(link.index + link.url.length);
  notes = notes.trim();
  if (notes === share.title.trim()) notes = '';
  return { url, title: share.title, description: '', notes };
}

/** Keep captured metadata in ordinary blocks so edits, search and export work as usual. */
export function capturedLinkContent(draft: LinkCaptureDraft): Note['content'] {
  return [
    ...sharedNoteContent({ title: draft.title, url: draft.url, text: '' }),
    ...sharedNoteContent({ title: '', url: '', text: draft.description }),
    ...sharedNoteContent({ title: '', url: '', text: draft.notes }),
  ];
}

export function matchingLinkNotes(notes: readonly Note[], url: string): Note[] {
  const normalized = normalizeUrl(url);
  if (!normalized) return [];
  return notes.filter(
    (note) => !note.deletedAt && extractLinks(note.content).some((link) => link.url === normalized),
  );
}

/** Instance-specific code; no credentials, and page content stays out of server access logs. */
export function captureBookmarklet(serverUrl: string): string {
  const destination = JSON.stringify(new URL('/capture', serverUrl).href);
  return `javascript:(()=>{if(!/^https?:$/.test(location.protocol)){alert('Open a web page to save it to Catch.');return;}if(location.href.length>2048){alert('This URL is too long for Catch.');return;}const p=new URLSearchParams({url:location.href,title:document.title.slice(0,300),text:String(window.getSelection()||'').slice(0,10000),popup:'true'});window.open(${destination}+'#'+p,'_blank','popup,width=520,height=760,noopener,noreferrer');})()`;
}
