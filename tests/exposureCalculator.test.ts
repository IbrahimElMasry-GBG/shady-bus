import { describe, expect, it } from 'vitest';

import { classifyExposure, summarizeExposure } from '@/lib/exposureCalculator';
import type { RouteSample } from '@/types';

describe('exposure classification', () => {
  it('places the sun at the front when it is straight ahead', () => {
    expect(classifyExposure(0, 40)).toBe('front');
    expect(classifyExposure(44, 40)).toBe('front');
    expect(classifyExposure(-44, 40)).toBe('front');
  });

  it('places a clockwise sun on the right', () => {
    expect(classifyExposure(90, 40)).toBe('right');
    expect(classifyExposure(46, 40)).toBe('right');
    expect(classifyExposure(134, 40)).toBe('right');
  });

  it('places an anti-clockwise sun on the left', () => {
    expect(classifyExposure(-90, 40)).toBe('left');
    expect(classifyExposure(-46, 40)).toBe('left');
    expect(classifyExposure(-134, 40)).toBe('left');
  });

  it('places the sun behind past ±135°', () => {
    expect(classifyExposure(180, 40)).toBe('back');
    expect(classifyExposure(136, 40)).toBe('back');
    expect(classifyExposure(-136, 40)).toBe('back');
  });

  it('uses the boundaries exactly as specified', () => {
    expect(classifyExposure(45, 40)).toBe('front');
    expect(classifyExposure(-45, 40)).toBe('front');
    expect(classifyExposure(135, 40)).toBe('right');
    expect(classifyExposure(-135, 40)).toBe('left');
  });

  it('reports no exposure at all when the sun is below the horizon', () => {
    // Critical: darkness must not be attributed to a side.
    expect(classifyExposure(90, 0)).toBe('none');
    expect(classifyExposure(90, -1)).toBe('none');
    expect(classifyExposure(-90, -20)).toBe('none');
  });
});

// ---------------------------------------------------------------------------

/** Builds a sample with sensible defaults so each test states only what matters. */
function makeSample(overrides: Partial<RouteSample> = {}): RouteSample {
  const base: RouteSample = {
    timestamp: 0,
    localTimeLabel: '08:00',
    elapsedSeconds: 0,
    durationSeconds: 1800,
    latitude: 30,
    longitude: 31,
    distanceAlongRouteMeters: 0,
    busHeadingDegrees: 0,
    sunAzimuthDegrees: 90,
    sunAltitudeDegrees: 45,
    relativeSunAngleDegrees: 90,
    exposedDirection: 'right',
    sunIntensity: 70,
    isDaylight: true,
    ...overrides,
  };
  return base;
}

describe('exposure summary', () => {
  it('splits percentages by trip time, not by sample count', () => {
    // One long left sample, one short right sample: 90 min vs 30 min.
    const samples = [
      makeSample({ durationSeconds: 5400, exposedDirection: 'left', relativeSunAngleDegrees: -90 }),
      makeSample({ durationSeconds: 1800, exposedDirection: 'right' }),
    ];

    const summary = summarizeExposure(samples);

    expect(summary.leftPercentage).toBeCloseTo(75, 5);
    expect(summary.rightPercentage).toBeCloseTo(25, 5);
  });

  it('computes weighted intensity as intensity × minutes', () => {
    const samples = [
      makeSample({ durationSeconds: 1800, sunIntensity: 100, exposedDirection: 'right' }),
    ];

    const summary = summarizeExposure(samples);

    // 100 intensity × 30 minutes = 3000 intensity-minutes.
    expect(summary.rightWeightedIntensity).toBeCloseTo(3000, 5);
    expect(summary.leftWeightedIntensity).toBe(0);
  });

  it('excludes night samples from every direction bucket', () => {
    const samples = [
      makeSample({ durationSeconds: 1800, exposedDirection: 'right' }),
      makeSample({
        durationSeconds: 1800,
        exposedDirection: 'none',
        isDaylight: false,
        sunIntensity: 0,
        sunAltitudeDegrees: -20,
      }),
    ];

    const summary = summarizeExposure(samples);

    expect(summary.rightPercentage).toBeCloseTo(50, 5);
    expect(summary.leftPercentage).toBe(0);
    expect(summary.frontPercentage).toBe(0);
    expect(summary.backPercentage).toBe(0);
    // Percentages deliberately do NOT sum to 100 — the other half was night.
    expect(summary.daylightPercentage).toBeCloseTo(50, 5);
  });
});

describe('seat recommendation', () => {
  it('recommends the opposite side to the sun (sun right → sit left)', () => {
    const samples = Array.from({ length: 6 }, () =>
      makeSample({ exposedDirection: 'right', relativeSunAngleDegrees: 90, sunIntensity: 70 }),
    );

    const summary = summarizeExposure(samples);

    expect(summary.recommendedSeatSide).toBe('left');
    expect(summary.explanation).toContain('right side');
  });

  it('recommends the right when the sun is on the left', () => {
    const samples = Array.from({ length: 6 }, () =>
      makeSample({ exposedDirection: 'left', relativeSunAngleDegrees: -90, sunIntensity: 70 }),
    );

    expect(summarizeExposure(samples).recommendedSeatSide).toBe('right');
  });

  it('says either side for a night trip, with a caveat', () => {
    const samples = Array.from({ length: 6 }, () =>
      makeSample({
        exposedDirection: 'none',
        isDaylight: false,
        sunIntensity: 0,
        sunAltitudeDegrees: -25,
      }),
    );

    const summary = summarizeExposure(samples);

    expect(summary.recommendedSeatSide).toBe('either');
    expect(summary.confidence).toBe('high');
    expect(summary.explanation.toLowerCase()).toContain('negligible');
    expect(summary.caveats.join(' ')).toMatch(/below the horizon/i);
  });

  it('says either side when the sun never climbs high enough to matter', () => {
    const samples = Array.from({ length: 6 }, () =>
      makeSample({ exposedDirection: 'right', sunIntensity: 3, sunAltitudeDegrees: 2 }),
    );

    const summary = summarizeExposure(samples);

    expect(summary.recommendedSeatSide).toBe('either');
    expect(summary.caveats.join(' ')).toMatch(/very low/i);
  });

  it('explains that side choice matters little when the sun is mostly ahead', () => {
    const samples = Array.from({ length: 6 }, () =>
      makeSample({ exposedDirection: 'front', relativeSunAngleDegrees: 5, sunIntensity: 80 }),
    );

    const summary = summarizeExposure(samples);

    expect(summary.explanation).toMatch(/ahead of the bus/i);
    expect(summary.explanation).toMatch(/limited impact/i);
  });

  it('refuses to pick a side on a near-perfect left/right tie', () => {
    const samples = [
      ...Array.from({ length: 3 }, () =>
        makeSample({ exposedDirection: 'left', relativeSunAngleDegrees: -90, sunIntensity: 70 }),
      ),
      ...Array.from({ length: 3 }, () =>
        makeSample({ exposedDirection: 'right', relativeSunAngleDegrees: 90, sunIntensity: 70 }),
      ),
    ];

    const summary = summarizeExposure(samples);

    expect(summary.recommendedSeatSide).toBe('either');
    expect(summary.confidence).toBe('low');
  });

  it('is more confident about a lopsided, bright, all-daylight trip', () => {
    const lopsided = Array.from({ length: 8 }, () =>
      makeSample({ exposedDirection: 'right', relativeSunAngleDegrees: 90, sunIntensity: 80 }),
    );
    const marginal = [
      ...Array.from({ length: 5 }, () =>
        makeSample({ exposedDirection: 'right', relativeSunAngleDegrees: 90, sunIntensity: 20 }),
      ),
      ...Array.from({ length: 4 }, () =>
        makeSample({ exposedDirection: 'left', relativeSunAngleDegrees: -90, sunIntensity: 20 }),
      ),
    ];

    expect(summarizeExposure(lopsided).confidence).toBe('high');
    expect(summarizeExposure(marginal).confidence).not.toBe('high');
  });

  it('flags missing step data as a caveat', () => {
    const samples = Array.from({ length: 6 }, () =>
      makeSample({ exposedDirection: 'right', sunIntensity: 70 }),
    );

    const summary = summarizeExposure(samples, { routeDurationSeconds: 10_800, hasStepData: false });

    expect(summary.caveats.join(' ')).toMatch(/constant speed/i);
  });

  it('survives an empty sample list without dividing by zero', () => {
    const summary = summarizeExposure([]);

    expect(summary.leftPercentage).toBe(0);
    expect(summary.rightPercentage).toBe(0);
    expect(summary.recommendedSeatSide).toBe('either');
    expect(Number.isNaN(summary.averageIntensity)).toBe(false);
  });
});
