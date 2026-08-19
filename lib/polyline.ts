import type { LatLng } from '@/types';

/**
 * Encoded Polyline Algorithm Format (precision 5).
 *
 * The format originated at Google and is what OSRM returns for
 * `geometries=polyline`, so the same codec serves the router and the map
 * preview. Implemented locally rather than pulled from a dependency because it
 * is ~40 lines, has no edge cases beyond sign handling, and keeps the decoding
 * step unit-testable without network or package churn.
 *
 * @see https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];

  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    lat += decodeSignedValue();
    lng += decodeSignedValue();
    points.push({ lat: lat / factor, lng: lng / factor });
  }

  return points;

  /** Reads one varint-style chunk group and returns the zig-zag decoded delta. */
  function decodeSignedValue(): number {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63; // chunks are offset by 63
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length); // high bit set => continue

    // Least-significant bit is the sign flag (zig-zag encoding).
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}

/** Inverse of {@link decodePolyline}; used to build compact Static Maps URLs. */
export function encodePolyline(points: LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let output = '';
  let prevLat = 0;
  let prevLng = 0;

  for (const point of points) {
    const lat = Math.round(point.lat * factor);
    const lng = Math.round(point.lng * factor);
    output += encodeSignedValue(lat - prevLat) + encodeSignedValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }

  return output;
}

function encodeSignedValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1; // zig-zag
  let output = '';

  while (v >= 0x20) {
    output += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  output += String.fromCharCode(v + 63);
  return output;
}

/**
 * Evenly thins a polyline down to at most `maxPoints` vertices.
 *
 * A long intercity route decodes to thousands of vertices, far more than a
 * preview map a few hundred pixels wide can show. Uniform index sampling is used
 * instead of Douglas–Peucker because the output is only ever that preview, where
 * the two are visually indistinguishable, and uniform sampling has a guaranteed
 * output size.
 */
export function simplifyPolyline(points: LatLng[], maxPoints = 100): LatLng[] {
  if (points.length <= maxPoints) return points;

  const result: LatLng[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.round(i * step)]);
  }
  // Guarantee the true endpoint survives rounding.
  result[result.length - 1] = points[points.length - 1];
  return result;
}
