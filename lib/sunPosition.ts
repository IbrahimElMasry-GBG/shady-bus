// suncalc 2.x is a native ESM package with named exports and no default export,
// and it ships its own type declarations.
import { getPosition } from 'suncalc';
import type { SunPosition } from '@/types';
import { normalizeBearing, toRadians } from './geo';

/**
 * Solar geometry and the intensity model.
 *
 * ## Azimuth convention (the easy thing to get silently wrong)
 *
 * **suncalc v2 returns north-based azimuth in degrees** (0 = N, 90 = E,
 * 180 = S, 270 = W) and a refraction-corrected altitude in degrees. That is
 * already the convention this app uses everywhere else, so no conversion is
 * needed — the values are used as they come.
 *
 * This is a deliberate note because suncalc **v1** was different: it returned
 * radians measured from due *south*, and a great deal of code on the internet
 * still applies the old `azimuth * 180/π + 180` conversion. Applying that here
 * would rotate the sun and confidently recommend the wrong seat, with nothing
 * visibly broken. The unit tests pin the convention against physical facts
 * (northern-hemisphere solar noon ⇒ sun due south ⇒ ≈180°; southern hemisphere
 * ⇒ due north), so a future version bump that changes it will fail loudly.
 *
 * ## Intensity model
 *
 * A first-order proxy for how strongly the sun hits a surface, on a 0–100 scale:
 *
 *     altitude <= 0  ->  intensity = 0        (sun below the horizon: night)
 *     altitude  > 0  ->  intensity = sin(altitude in radians) × 100
 *
 * The sine of the solar elevation is the cosine of the solar zenith angle,
 * which is the geometric term in the standard air-mass / irradiance
 * relationship. It captures the dominant effect — a sun 10° above the horizon
 * delivers roughly a sixth of the energy of one directly overhead — while
 * deliberately ignoring atmospheric attenuation, cloud, haze and glazing.
 *
 * Note this models energy on a *horizontal* surface. A bus window is vertical,
 * so a low sun actually feels harsher through the glass than this number
 * suggests. The model is used only to weight one direction against another
 * within a single trip, where that bias applies to all four faces equally, so
 * the comparison stays sound even though the absolute scale is approximate.
 */

/** Intensity proxy for a given solar altitude, on a 0–100 scale. */
export function sunIntensityFromAltitude(altitudeDegrees: number): number {
  if (altitudeDegrees <= 0) return 0;
  return Math.sin(toRadians(altitudeDegrees)) * 100;
}

/**
 * Solar position for an instant and a place.
 *
 * @param timestamp ms since the Unix epoch (an absolute instant; timezone-free)
 */
export function getSunPosition(timestamp: number, latitude: number, longitude: number): SunPosition {
  const { azimuth, altitude } = getPosition(new Date(timestamp), latitude, longitude);

  // Already north-based compass degrees; normalise only to guard against a
  // value landing exactly on 360.
  const azimuthDegrees = normalizeBearing(azimuth);
  const altitudeDegrees = altitude;

  return {
    azimuthDegrees,
    altitudeDegrees,
    isDaylight: altitudeDegrees > 0,
    intensity: sunIntensityFromAltitude(altitudeDegrees),
  };
}

/**
 * Coarse label for how strong the sun is, used in the interval table.
 * Thresholds correspond to solar altitudes of roughly 6°, 17° and 37°.
 */
export function describeIntensity(intensity: number): string {
  if (intensity <= 0) return 'Night';
  if (intensity < 10) return 'Very low';
  if (intensity < 30) return 'Low';
  if (intensity < 60) return 'Moderate';
  return 'Strong';
}
