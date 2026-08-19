import { describe, expect, it } from 'vitest';

import {
  bearingDegrees,
  cumulativeDistances,
  haversineMeters,
  headingAtDistance,
  normalizeBearing,
  normalizeRelativeAngle,
  pointAtDistance,
} from '@/lib/geo';
import { decodePolyline, encodePolyline, simplifyPolyline } from '@/lib/polyline';

describe('haversine distance', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters({ lat: 30, lng: 31 }, { lat: 30, lng: 31 })).toBe(0);
  });

  it('matches a known distance (Cairo → Alexandria ≈ 180 km)', () => {
    const meters = haversineMeters({ lat: 30.0444, lng: 31.2357 }, { lat: 31.2001, lng: 29.9187 });
    expect(meters).toBeGreaterThan(175_000);
    expect(meters).toBeLessThan(185_000);
  });

  it('gives ~111 km for one degree of latitude', () => {
    const meters = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(meters).toBeCloseTo(111_195, -2);
  });
});

describe('bearing', () => {
  it('is 0° due north and 180° due south', () => {
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 3);
    expect(bearingDegrees({ lat: 1, lng: 0 }, { lat: 0, lng: 0 })).toBeCloseTo(180, 3);
  });

  it('is 90° due east and 270° due west', () => {
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 3);
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })).toBeCloseTo(270, 3);
  });

  it('always returns a value in [0, 360)', () => {
    const pairs: Array<[number, number]> = [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
    for (const [dLat, dLng] of pairs) {
      const bearing = bearingDegrees({ lat: 0, lng: 0 }, { lat: dLat, lng: dLng });
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }
  });
});

describe('angle normalisation', () => {
  it('wraps bearings into [0, 360)', () => {
    expect(normalizeBearing(370)).toBeCloseTo(10);
    expect(normalizeBearing(-10)).toBeCloseTo(350);
    expect(normalizeBearing(720)).toBeCloseTo(0);
  });

  it('wraps relative angles into (-180, +180]', () => {
    expect(normalizeRelativeAngle(190)).toBeCloseTo(-170);
    expect(normalizeRelativeAngle(-190)).toBeCloseTo(170);
    expect(normalizeRelativeAngle(180)).toBeCloseTo(180);
    expect(normalizeRelativeAngle(0)).toBe(0);
  });

  it('handles the wrap-around case that naive subtraction gets wrong', () => {
    // Bus heading 350°, sun at 10° — the sun is 20° to the RIGHT, not 340° left.
    expect(normalizeRelativeAngle(10 - 350)).toBeCloseTo(20);
  });
});

describe('polyline encode/decode', () => {
  it('decodes the example from the Google specification', () => {
    // Documented example: _p~iF~ps|U_ulLnnqC_mqNvxq`@
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points).toHaveLength(3);
    expect(points[0].lat).toBeCloseTo(38.5, 5);
    expect(points[0].lng).toBeCloseTo(-120.2, 5);
    expect(points[1].lat).toBeCloseTo(40.7, 5);
    expect(points[1].lng).toBeCloseTo(-120.95, 5);
    expect(points[2].lat).toBeCloseTo(43.252, 5);
    expect(points[2].lng).toBeCloseTo(-126.453, 5);
  });

  it('round-trips through encode → decode', () => {
    const original = [
      { lat: 30.0444, lng: 31.2357 },
      { lat: 30.15, lng: 31.1 },
      { lat: 31.2001, lng: 29.9187 },
    ];
    const decoded = decodePolyline(encodePolyline(original));

    expect(decoded).toHaveLength(original.length);
    decoded.forEach((point, i) => {
      expect(point.lat).toBeCloseTo(original[i].lat, 5);
      expect(point.lng).toBeCloseTo(original[i].lng, 5);
    });
  });

  it('returns an empty array for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('simplifies to at most the requested point count, keeping both endpoints', () => {
    const points = Array.from({ length: 500 }, (_, i) => ({ lat: 30 + i * 0.001, lng: 31 }));
    const simplified = simplifyPolyline(points, 50);

    expect(simplified).toHaveLength(50);
    expect(simplified[0]).toEqual(points[0]);
    expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
  });

  it('leaves short polylines untouched', () => {
    const points = [
      { lat: 30, lng: 31 },
      { lat: 31, lng: 32 },
    ];
    expect(simplifyPolyline(points, 50)).toBe(points);
  });
});

describe('walking along a polyline', () => {
  // A due-north line: 0.01° of latitude per step ≈ 1.11 km per step.
  const northLine = Array.from({ length: 11 }, (_, i) => ({ lat: 30 + i * 0.01, lng: 31 }));
  const cumulative = cumulativeDistances(northLine);

  it('builds a monotonically increasing distance table', () => {
    expect(cumulative[0]).toBe(0);
    for (let i = 1; i < cumulative.length; i++) {
      expect(cumulative[i]).toBeGreaterThan(cumulative[i - 1]);
    }
  });

  it('returns the endpoints at distance 0 and at the full length', () => {
    const start = pointAtDistance(northLine, cumulative, 0);
    const end = pointAtDistance(northLine, cumulative, cumulative[cumulative.length - 1]);

    expect(start.point.lat).toBeCloseTo(30, 6);
    expect(end.point.lat).toBeCloseTo(30.1, 6);
  });

  it('interpolates the midpoint', () => {
    const total = cumulative[cumulative.length - 1];
    const middle = pointAtDistance(northLine, cumulative, total / 2);
    expect(middle.point.lat).toBeCloseTo(30.05, 4);
  });

  it('clamps distances beyond either end instead of running off the array', () => {
    const before = pointAtDistance(northLine, cumulative, -5000);
    const after = pointAtDistance(northLine, cumulative, 1e9);

    expect(before.point.lat).toBeCloseTo(30, 6);
    expect(after.point.lat).toBeCloseTo(30.1, 6);
  });

  it('reports a northward heading along a northward line, including at the ends', () => {
    const total = cumulative[cumulative.length - 1];
    for (const distance of [0, total / 2, total]) {
      expect(headingAtDistance(northLine, cumulative, distance)).toBeCloseTo(0, 1);
    }
  });

  it('tracks a turn in the route', () => {
    // North for 5 steps, then due east.
    const elbow = [
      ...Array.from({ length: 6 }, (_, i) => ({ lat: 30 + i * 0.01, lng: 31 })),
      ...Array.from({ length: 5 }, (_, i) => ({ lat: 30.05, lng: 31 + (i + 1) * 0.01 })),
    ];
    const cum = cumulativeDistances(elbow);
    const total = cum[cum.length - 1];

    // Early on: heading north. At the very end: heading east.
    expect(headingAtDistance(elbow, cum, 0, 100)).toBeCloseTo(0, 0);
    expect(headingAtDistance(elbow, cum, total, 100)).toBeCloseTo(90, 0);
  });
});
