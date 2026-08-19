/**
 * Pure display formatters.
 *
 * Kept separate from `lib/time.ts` because that module pulls in `tz-lookup`, a
 * large embedded timezone map that has no business in the client bundle. These
 * helpers rely only on `Intl`, so both server and client can use them.
 */

/** Formats an instant as `HH:mm` in the given IANA zone. */
export function formatLocalTime(utcMillis: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utcMillis));
}

/** Formats an instant as e.g. `Tue 11 Aug, 08:30` in the given IANA zone. */
export function formatLocalDateTime(utcMillis: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utcMillis));
}

/** Human-friendly duration, e.g. `3 h 25 min`. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

/** Distance in kilometres with one decimal. */
export function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Compass point for a bearing, e.g. 200° → "SSW". Easier to read than degrees. */
export function compassPoint(degrees: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return points[index];
}

/** Title-cased direction label for tables and badges. */
export function directionLabel(direction: string): string {
  switch (direction) {
    case 'front':
      return 'Front';
    case 'back':
      return 'Back';
    case 'left':
      return 'Left side';
    case 'right':
      return 'Right side';
    default:
      return 'None (night)';
  }
}
