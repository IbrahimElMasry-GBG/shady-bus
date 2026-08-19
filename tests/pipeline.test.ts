import { describe, expect, it } from 'vitest';

import { encodePolyline } from '@/lib/polyline';
import { summarizeExposure } from '@/lib/exposureCalculator';
import { sampleRoute } from '@/lib/routeSampling';
import { zonedWallClockToUtc } from '@/lib/time';
import { bearingDegrees } from '@/lib/geo';
import type { RouteOption } from '@/types';

/**
 * End-to-end check of the calculation pipeline on a realistic journey:
 * Cairo → Alexandria, ~220 km north-west, in high summer.
 *
 * The route here is a synthetic straight line rather than a live OSRM response, so
 * the test says nothing about the router — deliberately. It is pinned against solar
 * geometry that holds regardless of what any routing service returns, which keeps it
 * meaningful when the public OSRM endpoint is slow, rate-limited or down.
 */

const CAIRO = { lat: 30.0444, lng: 31.2357 };
const ALEXANDRIA = { lat: 31.2001, lng: 29.9187 };

/** Straight-line route between two points, sampled into `steps` vertices. */
function straightRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  durationSeconds: number,
): RouteOption {
  const vertices = 200;
  const points = Array.from({ length: vertices + 1 }, (_, i) => ({
    lat: from.lat + ((to.lat - from.lat) * i) / vertices,
    lng: from.lng + ((to.lng - from.lng) * i) / vertices,
  }));
  const encoded = encodePolyline(points);

  return {
    id: 'route-0',
    name: 'Primary route',
    summary: 'Cairo–Alexandria Desert Road',
    distanceMeters: 220_000,
    durationSeconds,
    encodedPolyline: encoded,
    previewPolyline: encoded,
    steps: [],
  };
}

describe('Cairo → Alexandria, full pipeline', () => {
  const route = straightRoute(CAIRO, ALEXANDRIA, 2.5 * 3600);
  const timeZone = 'Africa/Cairo';

  it('heads north-west, as the geography requires', () => {
    const heading = bearingDegrees(CAIRO, ALEXANDRIA);
    expect(heading).toBeGreaterThan(300); // NW quadrant
    expect(heading).toBeLessThan(330);
  });

  it('puts the morning sun on the right of a north-west-bound bus', () => {
    /*
     * Physical reasoning, independent of the code: heading ≈ 312°, and at 08:00
     * in August the sun sits in the east at ≈ 80°. Going clockwise from 312°,
     * the sun is ~128° round — the bus's right-hand side. So the passenger
     * should be told to sit on the LEFT.
     */
    const departure = zonedWallClockToUtc('2026-08-20', '08:00', timeZone);
    const samples = sampleRoute(route, { departureTimestamp: departure, timeZone });
    const summary = summarizeExposure(samples, {
      routeDurationSeconds: route.durationSeconds,
      hasStepData: false,
    });

    expect(summary.rightWeightedIntensity).toBeGreaterThan(summary.leftWeightedIntensity);
    expect(summary.recommendedSeatSide).toBe('left');
    expect(summary.daylightPercentage).toBe(100);
  });

  it('flips the answer for the same route in the late afternoon', () => {
    // By 16:00 the sun has crossed to the west (≈ 270°), which is now on the
    // bus's left. The recommendation must flip accordingly.
    const departure = zonedWallClockToUtc('2026-08-20', '16:00', timeZone);
    const samples = sampleRoute(route, { departureTimestamp: departure, timeZone });
    const summary = summarizeExposure(samples, {
      routeDurationSeconds: route.durationSeconds,
      hasStepData: false,
    });

    expect(summary.leftWeightedIntensity).toBeGreaterThan(summary.rightWeightedIntensity);
    expect(summary.recommendedSeatSide).toBe('right');
  });

  it('calls a midnight departure a night trip and declines to pick a side', () => {
    const departure = zonedWallClockToUtc('2026-08-20', '23:00', timeZone);
    const samples = sampleRoute(route, { departureTimestamp: departure, timeZone });
    const summary = summarizeExposure(samples, {
      routeDurationSeconds: route.durationSeconds,
      hasStepData: false,
    });

    expect(summary.daylightPercentage).toBe(0);
    expect(summary.recommendedSeatSide).toBe('either');
    expect(summary.averageIntensity).toBe(0);
    expect(summary.explanation.toLowerCase()).toContain('negligible');
  });

  it('produces percentages that never exceed 100 in total', () => {
    // A sample belongs to exactly one direction, so the four shares plus the
    // night share must account for the trip exactly once.
    for (const time of ['05:00', '08:00', '12:00', '16:00', '19:00', '23:00']) {
      const departure = zonedWallClockToUtc('2026-08-20', time, timeZone);
      const samples = sampleRoute(route, { departureTimestamp: departure, timeZone });
      const summary = summarizeExposure(samples, {
        routeDurationSeconds: route.durationSeconds,
        hasStepData: false,
      });

      const total =
        summary.frontPercentage +
        summary.backPercentage +
        summary.leftPercentage +
        summary.rightPercentage;

      expect(total).toBeLessThanOrEqual(100.0001);
      expect(total).toBeCloseTo(summary.daylightPercentage, 4);
    }
  });

  it('always returns a complete, well-formed summary whatever the departure time', () => {
    for (let hour = 0; hour < 24; hour++) {
      const departure = zonedWallClockToUtc(
        '2026-08-20',
        `${String(hour).padStart(2, '0')}:00`,
        timeZone,
      );
      const samples = sampleRoute(route, { departureTimestamp: departure, timeZone });
      const summary = summarizeExposure(samples, {
        routeDurationSeconds: route.durationSeconds,
        hasStepData: false,
      });

      expect(samples.length).toBeGreaterThan(0);
      expect(['left', 'right', 'either']).toContain(summary.recommendedSeatSide);
      expect(['high', 'medium', 'low']).toContain(summary.confidence);
      expect(summary.explanation.length).toBeGreaterThan(20);

      for (const value of [
        summary.frontPercentage,
        summary.backPercentage,
        summary.leftPercentage,
        summary.rightPercentage,
        summary.averageIntensity,
        summary.daylightPercentage,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
