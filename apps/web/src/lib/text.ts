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

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, compact: boolean): Intl.NumberFormat {
  const key = `${locale}:${compact ? 'c' : 'n'}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, ...(compact ? { notation: 'compact' } : {}) });
    numberFormats.set(key, format);
  }
  return format;
}

/** "1,000,000". Boards count anything from a handful of ships to a million bushels of grain. */
export function formatNumber(value: number, locale: string): string {
  return numberFormat(locale, false).format(value);
}

/** "1.5万" / "15K": for tight spots such as a token on the map. Small numbers come out unchanged. */
export function formatCompact(value: number, locale: string): string {
  return numberFormat(locale, true).format(value);
}

/** "+20", "−5" (a true minus sign), "±0". */
export function formatSigned(value: number, locale: string): string {
  if (value > 0) return `+${formatNumber(value, locale)}`;
  if (value < 0) return `−${formatNumber(Math.abs(value), locale)}`;
  return '±0';
}
