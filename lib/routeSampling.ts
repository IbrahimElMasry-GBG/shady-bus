import type { LatLng, RouteOption, RouteSample, RouteStep } from '@/types';
import { cumulativeDistances, headingAtDistance, normalizeRelativeAngle, pointAtDistance } from './geo';
import { decodePolyline } from './polyline';
import { classifyExposure } from './exposureCalculator';
import { getSunPosition } from './sunPosition';
import { formatLocalTime } from './format';

export const DEFAULT_INTERVAL_MINUTES = 30;
/** Used instead of 30 min when the whole trip is shorter than one interval. */
export const SHORT_TRIP_INTERVAL_MINUTES = 5;
/** Below this many polyline vertices we cannot compute a meaningful heading. */
export const MIN_POLYLINE_POINTS = 2;

/**
 * Maps elapsed trip time to distance travelled along the route.
 *
 * Two strategies:
 *
 * 1. **Step-based (preferred).** OSRM returns per-step distance and duration.
 *    A bus crawling through a city centre covers far less ground per minute
 *    than one on a motorway, and step data captures that. We build a piecewise
 *    linear time→distance curve from the steps.
 * 2. **Uniform fallback.** With no usable step data we assume constant speed,
 *    i.e. progress proportional to distance, as the spec allows.
 *
 * Step distances are rescaled onto the *geometric* length of the decoded
 * polyline, because the router's reported distances and the polyline's own length
 * differ by a fraction of a percent and an unscaled model would run off the end.
 */
export function createProgressModel(
  steps: RouteStep[],
  totalDurationSeconds: number,
  polylineLengthMeters: number,
) {
  const usable = steps.filter((s) => s.durationSeconds > 0 && s.distanceMeters >= 0);
  const stepDistanceTotal = usable.reduce((sum, s) => sum + s.distanceMeters, 0);
  const stepDurationTotal = usable.reduce((sum, s) => sum + s.durationSeconds, 0);

  const stepsUsable = usable.length > 0 && stepDistanceTotal > 0 && stepDurationTotal > 0;

  if (!stepsUsable) {
    return {
      usesStepData: false,
      distanceAtElapsed(elapsedSeconds: number): number {
        if (totalDurationSeconds <= 0) return 0;
        const fraction = Math.min(1, Math.max(0, elapsedSeconds / totalDurationSeconds));
        return fraction * polylineLengthMeters;
      },
    };
  }

  // Normalise both axes so the curve spans exactly [0, totalDuration] × [0, polylineLength].
  const distanceScale = polylineLengthMeters / stepDistanceTotal;
  const durationScale = totalDurationSeconds > 0 ? totalDurationSeconds / stepDurationTotal : 1;

  const timeMarks: number[] = [0];
  const distanceMarks: number[] = [0];
  let t = 0;
  let d = 0;
  for (const step of usable) {
    t += step.durationSeconds * durationScale;
    d += step.distanceMeters * distanceScale;
    timeMarks.push(t);
    distanceMarks.push(d);
  }

  return {
    usesStepData: true,
    distanceAtElapsed(elapsedSeconds: number): number {
      const target = Math.min(Math.max(elapsedSeconds, 0), timeMarks[timeMarks.length - 1]);

      // Binary search the piecewise segment containing `target`.
      let lo = 0;
      let hi = timeMarks.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (timeMarks[mid] <= target) lo = mid;
        else hi = mid - 1;
      }
      if (lo >= timeMarks.length - 1) return distanceMarks[distanceMarks.length - 1];

      const span = timeMarks[lo + 1] - timeMarks[lo];
      const fraction = span > 0 ? (target - timeMarks[lo]) / span : 0;
      return distanceMarks[lo] + (distanceMarks[lo + 1] - distanceMarks[lo]) * fraction;
    },
  };
}

/**
 * Picks the sampling interval. The spec asks for 30 minutes, but a trip shorter
 * than that would produce a single sample and a meaningless recommendation, so
 * short trips fall back to 5-minute sampling and the caller raises a warning.
 */
export function chooseIntervalMinutes(durationSeconds: number): number {
  return durationSeconds < DEFAULT_INTERVAL_MINUTES * 60
    ? SHORT_TRIP_INTERVAL_MINUTES
    : DEFAULT_INTERVAL_MINUTES;
}

export interface SampleRouteOptions {
  /** Departure instant, ms since epoch (already resolved to a real UTC moment). */
  departureTimestamp: number;
  /** IANA zone of the origin, used only for display labels. */
  timeZone: string;
  intervalMinutes?: number;
}

/**
 * Walks a route in fixed time steps and evaluates the sun at each one.
 *
 * Every sample carries a `durationSeconds` weight equal to the slice of trip
 * time it represents. Weights sum to exactly the route duration, so downstream
 * percentages are true shares of trip time even when the final interval is a
 * partial one.
 */
export function sampleRoute(route: RouteOption, options: SampleRouteOptions): RouteSample[] {
  const { departureTimestamp, timeZone } = options;
  const points: LatLng[] = decodePolyline(route.encodedPolyline);

  if (points.length < MIN_POLYLINE_POINTS) {
    throw new Error('Route polyline has too few points to sample.');
  }

  const cumulative = cumulativeDistances(points);
  const polylineLength = cumulative[cumulative.length - 1];
  const duration = Math.max(route.durationSeconds, 1);

  const intervalMinutes = options.intervalMinutes ?? chooseIntervalMinutes(duration);
  const intervalSeconds = intervalMinutes * 60;

  const progress = createProgressModel(route.steps, duration, polylineLength);

  const samples: RouteSample[] = [];
  for (let elapsed = 0; elapsed < duration || samples.length === 0; elapsed += intervalSeconds) {
    // The last interval is usually partial; weights must still add up to `duration`.
    const weight = Math.min(intervalSeconds, duration - elapsed);
    const timestamp = departureTimestamp + elapsed * 1000;

    const distance = progress.distanceAtElapsed(elapsed);
    const { point } = pointAtDistance(points, cumulative, distance);
    const busHeadingDegrees = headingAtDistance(points, cumulative, distance);

    const sun = getSunPosition(timestamp, point.lat, point.lng);
    // Positive = sun is clockwise of the heading, i.e. towards the bus's right.
    const relativeSunAngleDegrees = normalizeRelativeAngle(sun.azimuthDegrees - busHeadingDegrees);

    samples.push({
      timestamp,
      localTimeLabel: formatLocalTime(timestamp, timeZone),
      elapsedSeconds: elapsed,
      durationSeconds: Math.max(weight, 0),
      latitude: point.lat,
      longitude: point.lng,
      distanceAlongRouteMeters: distance,
      busHeadingDegrees,
      sunAzimuthDegrees: sun.azimuthDegrees,
      sunAltitudeDegrees: sun.altitudeDegrees,
      relativeSunAngleDegrees,
      exposedDirection: classifyExposure(relativeSunAngleDegrees, sun.altitudeDegrees),
      sunIntensity: sun.intensity,
      isDaylight: sun.isDaylight,
    });
  }

  return samples;
}
