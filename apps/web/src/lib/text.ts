/** First `max` characters of `text` on one line, with an ellipsis when cut. Counts code points, not UTF-16 units. */
export function snippet(text: string, max = 48): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  return `${chars.slice(0, max).join('').trimEnd()}…`;
}

const listFormats = new Map<string, Intl.ListFormat>();

/** "A, B, and C" / "A、B和C" depending on the locale. */
export function formatList(items: string[], locale: string): string {
  let format = listFormats.get(locale);
  if (!format) {
    format = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
    listFormats.set(locale, format);
  }
  return format.format(items);
}
