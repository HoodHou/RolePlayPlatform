import { useEffect, useState } from 'react';

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

const formats = new Map<string, Intl.RelativeTimeFormat>();

/**
 * "3 hours ago" / "3小时前". Returns null for anything under a minute old so the
 * caller can say "just now" in its own words.
 */
export function formatRelativeTime(iso: string, locale: string, now: number): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  // Clamp to the past: a server clock slightly ahead should not read "in 1 minute".
  const seconds = Math.min(0, Math.round((then - now) / 1000));
  if (-seconds < 45) return null;

  let format = formats.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    formats.set(locale, format);
  }
  for (const [unit, size] of UNITS) {
    if (-seconds >= size || unit === 'minute') {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return null;
}

/** Current time, refreshed every `intervalMs` so relative times stay current. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
