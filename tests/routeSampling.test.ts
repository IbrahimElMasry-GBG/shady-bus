import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INTERVAL_MINUTES,
  SHORT_TRIP_INTERVAL_MINUTES,
  chooseIntervalMinutes,
  createProgressModel,
  sampleRoute,
} from '@/lib/routeSampling';
import { encodePolyline } from '@/lib/polyline';
import { zonedWallClockToUtc } from '@/lib/time';
import type { RouteOption } from '@/types';

/** A due-EAST route ~100 km long, so bus heading is a known 90°. */
function eastwardRoute(durationSeconds: number, steps: RouteOption['steps'] = []): RouteOption {
  const points = Array.from({ length: 101 }, (_, i) => ({ lat: 30, lng: 31 + i * 0.01 }));
  const encoded = encodePolyline(points);

  return {
    id: 'route-0',
    name: 'Primary route',
    summary: 'Test road',
    distanceMeters: 96_000,
    durationSeconds,
    encodedPolyline: encoded,
    previewPolyline: encoded,
    steps,
  };
}

describe('sampling interval', () => {
  it('uses 30 minutes for a normal trip', () => {
    expect(chooseIntervalMinutes(3 * 3600)).toBe(DEFAULT_INTERVAL_MINUTES);
    expect(chooseIntervalMinutes(30 * 60)).toBe(DEFAULT_INTERVAL_MINUTES);
  });

  it('drops to a finer interval for a trip shorter than 30 minutes', () => {
    // Otherwise a 20-minute trip would produce exactly one sample.
    expect(chooseIntervalMinutes(20 * 60)).toBe(SHORT_TRIP_INTERVAL_MINUTES);
  });
});

describe('progress model', () => {
  it('falls back to constant speed when there is no step data', () => {
    const model = createProgressModel([], 3600, 100_000);

    expect(model.usesStepData).toBe(false);
    expect(model.distanceAtElapsed(0)).toBeCloseTo(0, 5);
    expect(model.distanceAtElapsed(1800)).toBeCloseTo(50_000, 5);
    expect(model.distanceAtElapsed(3600)).toBeCloseTo(100_000, 5);
  });

  it('uses step timings so slow urban stretches cover less ground', () => {
    // Two steps, equal time, very different distance: 10 km of city crawl then
    // 90 km of motorway. At the halfway point the bus should be at 10 km, not 50.
    const model = createProgressModel(
      [
        { distanceMeters: 10_000, durationSeconds: 1800 },
        { distanceMeters: 90_000, durationSeconds: 1800 },
      ],
      3600,
      100_000,
    );

    expect(model.usesStepData).toBe(true);
    expect(model.distanceAtElapsed(1800)).toBeCloseTo(10_000, 0);
    expect(model.distanceAtElapsed(3600)).toBeCloseTo(100_000, 0);
  });

  it('rescales step distances onto the polyline length', () => {
    // Steps claim 50 km total but the polyline is 100 km; the model must still
    // end at the end of the polyline rather than halfway along it.
    const model = createProgressModel([{ distanceMeters: 50_000, durationSeconds: 3600 }], 3600, 100_000);
    expect(model.distanceAtElapsed(3600)).toBeCloseTo(100_000, 0);
  });

  it('clamps beyond the end of the trip', () => {
    const model = createProgressModel([], 3600, 100_000);
    expect(model.distanceAtElapsed(99_999)).toBeCloseTo(100_000, 5);
    expect(model.distanceAtElapsed(-50)).toBeCloseTo(0, 5);
  });

  it('ignores steps with zero duration rather than dividing by zero', () => {
    const model = createProgressModel(
      [{ distanceMeters: 1000, durationSeconds: 0 }],
      3600,
      100_000,
    );
    expect(model.usesStepData).toBe(false);
    expect(Number.isFinite(model.distanceAtElapsed(1800))).toBe(true);
  });
});

describe('route sampling', () => {
  const departure = zonedWallClockToUtc('2026-06-21', '08:00', 'Africa/Cairo');

  it('samples every 30 minutes across the trip', () => {
    const samples = sampleRoute(eastwardRoute(3 * 3600), {
      departureTimestamp: departure,
      timeZone: 'Africa/Cairo',
    });

    // 3 hours → t = 0, 30, 60, 90, 120, 150 minutes.
    expect(samples).toHaveLength(6);
    expect(samples[0].elapsedSeconds).toBe(0);
    expect(samples[1].elapsedSeconds).toBe(1800);
    expect(samples[5].elapsedSeconds).toBe(9000);
  });

  it('weights samples so they add up to exactly the trip duration', () => {
    // 100 minutes is deliberately not a multiple of 30 — the last interval is partial.
    const duration = 100 * 60;
    const samples = sampleRoute(eastwardRoute(duration), {
      departureTimestamp: departure,
      timeZone: 'Africa/Cairo',
    });

    const totalWeight = samples.reduce((sum, s) => sum + s.durationSeconds, 0);
    expect(totalWeight).toBeCloseTo(duration, 5);
    // The final partial interval is 10 minutes, not a full 30.
    expect(samples[samples.length - 1].durationSeconds).toBeCloseTo(600, 5);
  });

  it('always produces at least one sample, even for a trivially short trip', () => {
    const samples = sampleRoute(eastwardRoute(60), {
      departureTimestamp: departure,
      timeZone: 'Africa/Cairo',
      intervalMinutes: 30,
    });

    expect(samples.length).toBeGreaterThanOrEqual(1);
    expect(samples[0].durationSeconds).toBeCloseTo(60, 5);
  });

  it('moves the bus forward along the route', () => {
    const samples = sampleRoute(eastwardRoute(3 * 3600), {
      departureTimestamp: departure,
      timeZone: 'Africa/Cairo',
    });

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].distanceAlongRouteMeters).toBeGreaterThan(
        samples[i - 1].distanceAlongRouteMeters,
      );
      expect(samples[i].longitude).toBeGreaterThan(samples[i - 1].longitude);
    }
  });

  it('reports the correct heading for a due-east route', () => {
    const samples = sampleRoute(eastwardRoute(3 * 3600), {
      departureTimestamp: departure,
      timeZone: 'Africa/Cairo',
    });

    for (const sample of samples) {
      expect(sample.busHeadingDegrees).toBeCloseTo(90, 0);
    }
  });

  it('puts the morning sun on the FRONT of an eastbound bus', () => {
    /*
     * The end-to-end geometric check. Travelling due east at 08:00 in June from
     * Cairo, the sun is in the east-north-east — that is, ahead. If the SunCalc
     * azimuth conversion were off by 180° this test would report "back", and if
     * the relative-angle sign were flipped it would report the wrong side.
     */
    const samples = sampleRoute(eastwardRoute(3600), {
      departureTimestamp: departure,
      timeZone: 'Africa/Cairo',
    });

    expect(samples[0].exposedDirection).toBe('front');
    expect(samples[0].isDaylight).toBe(true);
    expect(Math.abs(samples[0].relativeSunAngleDegrees)).toBeLessThan(45);
  });

  it('puts the same morning sun on the LEFT of a northbound bus', () => {
    // Same instant and place, route rotated 90° anti-clockwise: the sun that was
    // ahead of an eastbound bus must now be on a northbound bus's right-hand...
    // no — north-facing, sun in the east ⇒ the sun is on the RIGHT.
    const northPoints = Array.from({ length: 101 }, (_, i) => ({ lat: 30 + i * 0.01, lng: 31 }));
    const encoded = encodePolyline(northPoints);
    const route: RouteOption = { ...eastwardRoute(3600), encodedPolyline: encoded, previewPolyline: encoded };

    const samples = sampleRoute(route, {
      departureTimestamp: departure,
      timeZone: 'Africa/Cairo',
    });

    expect(samples[0].busHeadingDegrees).toBeCloseTo(0, 0);
    expect(samples[0].exposedDirection).toBe('right');
    expect(samples[0].relativeSunAngleDegrees).toBeGreaterThan(0);
  });

  it('classifies a midnight departure as night on every sample', () => {
    const midnight = zonedWallClockToUtc('2026-01-15', '23:30', 'Africa/Cairo');
    const samples = sampleRoute(eastwardRoute(2 * 3600), {
      departureTimestamp: midnight,
      timeZone: 'Africa/Cairo',
    });

    for (const sample of samples) {
      expect(sample.isDaylight).toBe(false);
      expect(sample.exposedDirection).toBe('none');
      expect(sample.sunIntensity).toBe(0);
    }
  });

  it('refuses to sample a polyline with too few points', () => {
    const degenerate: RouteOption = { ...eastwardRoute(3600), encodedPolyline: encodePolyline([{ lat: 30, lng: 31 }]) };

    expect(() =>
      sampleRoute(degenerate, { departureTimestamp: departure, timeZone: 'Africa/Cairo' }),
    ).toThrow(/too few points/i);
  });

  it('labels sample times in the origin timezone', () => {
    const samples = sampleRoute(eastwardRoute(3600), {
      departureTimestamp: departure,
      timeZone: 'Africa/Cairo',
    });

    expect(samples[0].localTimeLabel).toBe('08:00');
    expect(samples[1].localTimeLabel).toBe('08:30');
  });
});
