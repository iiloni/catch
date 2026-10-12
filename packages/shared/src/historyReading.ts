import { canonicalHistory } from './historyCanonical';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const blank = (value: unknown): boolean =>
  !value ||
  (Array.isArray(value)
    ? value.length === 0
    : typeof value === 'object' && Object.values(value).every(blank));

/** What the editor writes out for a block that an import or an older save leaves unsaid. */
const DEFAULT_PROPS: Json = {
  textAlignment: 'left',
  textColor: 'default',
  backgroundColor: 'default',
  level: 1,
  showPreview: true,
  previewWidth: 512,
  checked: false,
  isToggleable: false,
  caption: '',
  name: '',
  url: '',
};

/** Without what is switched off, empty or the default. */
const said = (values: unknown): Json =>
  Object.fromEntries(
    Object.entries(isObject(values) ? values : {}).filter(
      ([, value]) => !blank(value) && value !== 'default',
    ),
  );
/**
 * Without the defaults that are known. Any other value stays, blank or not: its default is
 * not known, so leaving it out could read two different blocks as one.
 */
const saidProps = (values: unknown): Json =>
  Object.fromEntries(
    Object.entries(isObject(values) ? values : {}).filter(([name, value]) =>
      name in DEFAULT_PROPS ? value !== DEFAULT_PROPS[name] : value !== undefined,
    ),
  );

/** Runs of text set the same way are one run, however the editor happened to split them. */
function inline(content: unknown): unknown {
  if (typeof content === 'string') return inline([{ type: 'text', text: content }]);
  if (!Array.isArray(content)) return content;
  const result: unknown[] = [];
  for (const item of content) {
    if (isObject(item) && item.type === 'link' && typeof item.href === 'string') {
      const text = inline(item.content);
      if (!blank(text)) result.push({ type: 'link', href: item.href, content: text });
      continue;
    }
    if (!isObject(item) || item.type !== 'text' || typeof item.text !== 'string') {
      result.push(item);
      continue;
    }
    if (!item.text) continue;
    const styles = said(item.styles);
    const last = result.at(-1);
    if (
      isObject(last) &&
      last.type === 'text' &&
      canonicalHistory(last.styles) === canonicalHistory(styles)
    )
      last.text = `${String(last.text)}${item.text}`;
    else result.push({ type: 'text', text: item.text, styles });
  }
  return result;
}

function block(value: Json): Json {
  const { id: _id, props, content, children, ...rest } = value;
  const nested = Array.isArray(children) ? children.filter(isObject).map(block) : [];
  return {
    ...said(rest),
    props: saidProps(props),
    ...(blank(content) ? {} : { content: inline(content) }),
    ...(nested.length ? { children: nested } : {}),
  };
}

/**
 * A document as a reader sees it, for telling versions that read the same from ones that
 * differ (ADR 0022): without block ids, written-out defaults, styles that are switched off
 * or how the text happens to be split into runs. Two documents that read the same may still
 * come out differently, never the reverse, so this may only ever be used to fold versions
 * in a list, not to stand one in for another.
 */
export function historyReading(content: readonly Record<string, unknown>[]): string {
  return canonicalHistory(content.map(block));
}
