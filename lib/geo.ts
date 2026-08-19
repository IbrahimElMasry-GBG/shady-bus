import type { LatLng } from '@/types';

export const EARTH_RADIUS_METERS = 6_371_008.8; // IUGG mean radius

export const toRadians = (deg: number): number => (deg * Math.PI) / 180;
export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Great-circle distance between two points, in metres (haversine).
 *
 * Accurate to ~0.5% which is far below the uncertainty of "where exactly is the
 * bus after 90 minutes", so a more expensive geodesic solver is not warranted.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial bearing (forward azimuth) from `a` to `b`, in compass degrees.
 *
 * 0 = due north, 90 = due east, 180 = south, 270 = west. This is the direction
 * the bus is pointing, which we later compare against the sun's azimuth.
 */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return normalizeBearing(toDegrees(Math.atan2(y, x)));
}

/** Wraps any angle into [0, 360). */
export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Wraps a *difference* of two bearings into (-180, +180].
 *
 * Positive means clockwise from the reference (i.e. towards the bus's right),
 * negative means anti-clockwise (towards its left).
 */
export function normalizeRelativeAngle(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a;
}

/**
 * Linear interpolation between two coordinates.
 *
 * Over a single polyline segment (typically well under a kilometre) the
 * difference between planar and great-circle interpolation is centimetres, so
 * plain lerp is used for speed and clarity.
 */
export function interpolate(a: LatLng, b: LatLng, fraction: number): LatLng {
  const t = Math.min(1, Math.max(0, fraction));
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

/**
 * Cumulative distance table for a polyline: `cumulative[i]` is the distance in
 * metres from the first point to point `i`. Length equals `points.length`.
 */
export function cumulativeDistances(points: LatLng[]): number[] {
  const cumulative: number[] = new Array(points.length);
  cumulative[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cumulative[i] = cumulative[i - 1] + haversineMeters(points[i - 1], points[i]);
  }
  return cumulative;
}

/**
 * Finds the coordinate that lies `targetMeters` along the polyline.
 *
 * Returns the interpolated point plus the index of the segment it fell in, so
 * callers can reuse that index for bearing calculations.
 */
export function pointAtDistance(
  points: LatLng[],
  cumulative: number[],
  targetMeters: number,
): { point: LatLng; segmentIndex: number } {
  if (points.length === 0) throw new Error('pointAtDistance: empty polyline');
  if (points.length === 1) return { point: points[0], segmentIndex: 0 };

  const total = cumulative[cumulative.length - 1];
  const target = Math.min(Math.max(targetMeters, 0), total);

  // Binary search for the last vertex at or before `target`.
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid] <= target) lo = mid;
    else hi = mid - 1;
  }

  const segmentIndex = Math.min(lo, points.length - 2);
  const segmentLength = cumulative[segmentIndex + 1] - cumulative[segmentIndex];
  const fraction = segmentLength > 0 ? (target - cumulative[segmentIndex]) / segmentLength : 0;

  return {
    point: interpolate(points[segmentIndex], points[segmentIndex + 1], fraction),
    segmentIndex,
  };
}

/**
 * Heading of the route at a given distance along it.
 *
 * Rather than using the single polyline segment under the sample (which can be
 * a few metres long and therefore very noisy on motorway curves), we take the
 * bearing between a point `lookaheadMeters` behind and one ahead. That smooths
 * out zig-zag digitisation while still tracking real turns.
 */
export function headingAtDistance(
  points: LatLng[],
  cumulative: number[],
  targetMeters: number,
  lookaheadMeters = 150,
): number {
  const total = cumulative[cumulative.length - 1];
  if (points.length < 2 || total === 0) return 0;

  // Clamp the window to the route so samples at the very start/end still work.
  const half = Math.min(lookaheadMeters, total / 2);
  let back = targetMeters - half;
  let ahead = targetMeters + half;
  if (back < 0) {
    ahead += -back;
    back = 0;
  }
  if (ahead > total) {
    back -= ahead - total;
    ahead = total;
  }
  back = Math.max(0, back);

  const from = pointAtDistance(points, cumulative, back).point;
  const to = pointAtDistance(points, cumulative, ahead).point;

  // Degenerate window (e.g. the bus is stationary in a loop) — fall back to the
  // overall route direction rather than returning a meaningless 0.
  if (haversineMeters(from, to) < 1) {
    return bearingDegrees(points[0], points[points.length - 1]);
  }
  return bearingDegrees(from, to);
}
