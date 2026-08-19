import tzLookup from 'tz-lookup';

/**
 * Timezone handling.
 *
 * The user picks a date and a time meaning "when the bus leaves", which is wall
 * clock time *at the origin* — not on whatever machine happens to run this code.
 * Naively doing `new Date('2026-08-11T08:00')` would interpret it in the server's
 * timezone and silently shift every sun position by the offset difference. On a
 * Vercel box running UTC, an 08:00 departure from Cairo would be evaluated as
 * 10:00 local, which is enough to flip a left/right recommendation.
 *
 * So: resolve the IANA zone from the origin coordinates (offline, via tz-lookup),
 * then convert the wall clock to a real UTC instant in that zone.
 */

/** IANA timezone for a coordinate, e.g. "Africa/Cairo". Falls back to UTC. */
export function timeZoneForCoordinates(lat: number, lng: number): string {
  try {
    return tzLookup(lat, lng);
  } catch {
    // tz-lookup throws on out-of-range input; UTC keeps the app running with a
    // documented caveat rather than failing the whole request.
    return 'UTC';
  }
}

/**
 * Offset of `timeZone` from UTC at a given instant, in milliseconds.
 * Positive east of Greenwich. Correctly accounts for DST because it asks Intl
 * what the local clock actually read at that instant.
 */
export function timeZoneOffsetMs(utcMillis: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(utcMillis))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }

  // Some engines emit hour 24 for midnight under hour12:false.
  const hour = parts.hour === 24 ? 0 : parts.hour;

  const localAsIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
  return localAsIfUtc - utcMillis;
}

/**
 * Converts a local wall clock date/time in `timeZone` into a UTC timestamp.
 *
 * Two passes: the first guesses the offset by treating the wall clock as UTC,
 * the second re-reads the offset at the corrected instant. That second pass is
 * what makes the result correct within a few hours of a DST transition, where
 * the offset before and after the guess differ.
 *
 * @param date  `YYYY-MM-DD`
 * @param time  `HH:mm` (24-hour)
 */
export function zonedWallClockToUtc(date: string, time: string, timeZone: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  if (
    ![year, month, day, hour, minute].every((n) => Number.isFinite(n)) ||
    month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59
  ) {
    throw new Error(`Invalid date/time: "${date}" "${time}"`);
  }

  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let utc = wallClockAsUtc;
  for (let pass = 0; pass < 2; pass++) {
    utc = wallClockAsUtc - timeZoneOffsetMs(utc, timeZone);
  }
  return utc;
}

// Display formatters live in `lib/format.ts` so client components can import
// them without dragging `tz-lookup` into the browser bundle.
export { formatDuration, formatDistance, formatLocalDateTime, formatLocalTime } from './format';
