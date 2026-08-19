import { describe, expect, it } from 'vitest';

import { getTimes } from 'suncalc';

import { getSunPosition, sunIntensityFromAltitude } from '@/lib/sunPosition';
import { timeZoneForCoordinates, zonedWallClockToUtc, timeZoneOffsetMs } from '@/lib/time';

describe('sun intensity model', () => {
  it('is zero at and below the horizon', () => {
    expect(sunIntensityFromAltitude(0)).toBe(0);
    expect(sunIntensityFromAltitude(-5)).toBe(0);
    expect(sunIntensityFromAltitude(-90)).toBe(0);
  });

  it('is 100 with the sun directly overhead', () => {
    expect(sunIntensityFromAltitude(90)).toBeCloseTo(100, 6);
  });

  it('follows sin(altitude): 30° gives half of overhead', () => {
    expect(sunIntensityFromAltitude(30)).toBeCloseTo(50, 6);
  });

  it('increases monotonically with altitude', () => {
    const values = [1, 10, 20, 45, 70, 89].map(sunIntensityFromAltitude);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });
});

describe('azimuth convention', () => {
  /*
   * The most dangerous convention in this app. suncalc v2 reports azimuth as
   * north-based compass degrees, which matches the bus heading directly — but
   * suncalc v1 reported radians measured from SOUTH, and the widely-copied
   * `azimuth * 180/π + 180` conversion for it is still everywhere online.
   * Applying the wrong one rotates the sun and silently inverts the seat
   * recommendation with nothing visibly broken.
   *
   * These assertions are therefore pinned to physical facts — where the sun
   * actually is at solar noon in each hemisphere — not to whatever the code
   * currently returns. A library upgrade that flips the convention fails here.
   */

  it('puts the sun due south at true solar noon in the northern hemisphere', () => {
    /*
     * Anchored to suncalc's own solar-noon instant rather than to 12:00 on the
     * clock. Civil noon is not solar noon: Cairo keeps UTC+3 but sits at 31.2°E,
     * nearly 14° west of that zone's 45°E meridian, so its solar noon falls
     * around 12:57 local. Asserting against the clock would bake that ~55-minute
     * error into the test.
     */
    const { solarNoon } = getTimes(new Date('2026-06-21T09:00:00Z'), 30.0444, 31.2357);
    const sun = getSunPosition(solarNoon.getTime(), 30.0444, 31.2357);

    expect(sun.azimuthDegrees).toBeCloseTo(180, 1); // due south
    expect(sun.altitudeDegrees).toBeGreaterThan(80); // near-overhead at summer solstice
  });

  it('puts the sun in the east at sunrise and the west at sunset', () => {
    const timeZone = timeZoneForCoordinates(30.0444, 31.2357);

    const morning = getSunPosition(
      zonedWallClockToUtc('2026-03-20', '07:00', timeZone),
      30.0444,
      31.2357,
    );
    const evening = getSunPosition(
      zonedWallClockToUtc('2026-03-20', '17:00', timeZone),
      30.0444,
      31.2357,
    );

    // East ≈ 90°, west ≈ 270°.
    expect(morning.azimuthDegrees).toBeGreaterThan(60);
    expect(morning.azimuthDegrees).toBeLessThan(120);
    expect(evening.azimuthDegrees).toBeGreaterThan(240);
    expect(evening.azimuthDegrees).toBeLessThan(300);
  });

  it('puts the sun due north at true solar noon in the southern hemisphere', () => {
    // Sydney, 33.87°S. The sun culminates to the NORTH there — the mirror-image
    // check that a hard-coded "180 = noon" assumption would fail.
    const { solarNoon } = getTimes(new Date('2026-06-21T02:00:00Z'), -33.8688, 151.2093);
    const sun = getSunPosition(solarNoon.getTime(), -33.8688, 151.2093);

    // Due north = 0°/360°.
    const distanceFromNorth = Math.min(sun.azimuthDegrees, 360 - sun.azimuthDegrees);
    expect(distanceFromNorth).toBeLessThan(1);
  });

  it('reports night when the sun is below the horizon', () => {
    const timeZone = timeZoneForCoordinates(30.0444, 31.2357);
    const midnight = zonedWallClockToUtc('2026-01-15', '00:30', timeZone);
    const sun = getSunPosition(midnight, 30.0444, 31.2357);

    expect(sun.altitudeDegrees).toBeLessThan(0);
    expect(sun.isDaylight).toBe(false);
    expect(sun.intensity).toBe(0);
  });
});

describe('timezone handling', () => {
  it('resolves IANA zones from coordinates', () => {
    expect(timeZoneForCoordinates(30.0444, 31.2357)).toBe('Africa/Cairo');
    expect(timeZoneForCoordinates(51.5074, -0.1278)).toBe('Europe/London');
  });

  it('falls back to UTC rather than throwing on bad coordinates', () => {
    expect(timeZoneForCoordinates(999, 999)).toBe('UTC');
  });

  it('interprets the wall clock in the origin zone, not the server zone', () => {
    // 08:00 in Tokyo (UTC+9) is 23:00 UTC the previous day.
    const utc = zonedWallClockToUtc('2026-08-11', '08:00', 'Asia/Tokyo');
    expect(new Date(utc).toISOString()).toBe('2026-08-10T23:00:00.000Z');
  });

  it('handles a zone with a half-hour offset', () => {
    // Kolkata is UTC+5:30 year round.
    const utc = zonedWallClockToUtc('2026-08-11', '08:00', 'Asia/Kolkata');
    expect(new Date(utc).toISOString()).toBe('2026-08-11T02:30:00.000Z');
  });

  it('applies the correct offset on each side of a DST transition', () => {
    // London: BST (UTC+1) in July, GMT (UTC+0) in January.
    const summer = zonedWallClockToUtc('2026-07-15', '12:00', 'Europe/London');
    const winter = zonedWallClockToUtc('2026-01-15', '12:00', 'Europe/London');

    expect(new Date(summer).toISOString()).toBe('2026-07-15T11:00:00.000Z');
    expect(new Date(winter).toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('reports offsets that match the season', () => {
    const july = Date.UTC(2026, 6, 15, 12);
    const january = Date.UTC(2026, 0, 15, 12);

    expect(timeZoneOffsetMs(july, 'Europe/London')).toBe(3_600_000);
    expect(timeZoneOffsetMs(january, 'Europe/London')).toBe(0);
  });

  it('rejects malformed date or time strings', () => {
    expect(() => zonedWallClockToUtc('not-a-date', '08:00', 'UTC')).toThrow();
    expect(() => zonedWallClockToUtc('2026-08-11', '99:99', 'UTC')).toThrow();
  });
});
