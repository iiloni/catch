import { findBareUrls, type Note, normalizeUrl } from '@catch/shared';

function inline(value: string) {
  const result: Record<string, unknown>[] = [];
  const text = (text: string) => ({ type: 'text', text, styles: {} });
  let offset = 0;
  for (const { index, url } of findBareUrls(value)) {
    if (index > offset) result.push(text(value.slice(offset, index)));
    result.push({ type: 'link', href: url, content: [text(url)] });
    offset = index + url.length;
  }
  if (offset < value.length) result.push(text(value.slice(offset)));
  return result;
}

/** Treat shared markup as text; links still get Catch's ordinary previews. */
export function sharedNoteContent(input: {
  title: string;
  text: string;
  url: string;
}): Note['content'] {
  const content: Note['content'] = [];
  const title = input.title.trim();
  const text = input.text.trim();
  if (title && title !== text)
    content.push({ type: 'heading', props: { level: 3 }, content: inline(title) });
  if (text) {
    for (const line of text.split(/\r\n?|\n/))
      content.push({ type: 'paragraph', content: inline(line) });
  }
  const url = input.url.trim();
  const normalized = normalizeUrl(url);
  const existing =
    normalized !== null &&
    findBareUrls(`${title}\n${text}`).some((link) => normalizeUrl(link.url) === normalized);
  if (url && !existing) content.push({ type: 'paragraph', content: inline(url) });
  return content;
}
