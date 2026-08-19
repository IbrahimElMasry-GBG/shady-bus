import type {
  ConfidenceLevel,
  ExposureDirection,
  ExposureSummary,
  RouteSample,
  SeatSide,
} from '@/types';

/**
 * Classifies which face of the bus the sun strikes.
 *
 * `relativeAngle` is the sun's compass azimuth minus the bus heading, wrapped
 * to (-180, +180]. Because the bus's nose points along its heading, a positive
 * relative angle means the sun is clockwise of straight ahead — i.e. on the
 * **right-hand side** of the vehicle (assuming right-hand-drive-agnostic
 * geometry; this is about the physical side of the body, not the seating plan).
 *
 *   front:  -45° .. +45°
 *   right:  +45° .. +135°
 *   back:   > +135° or < -135°
 *   left:  -135° .. -45°
 *
 * When the sun is below the horizon there is no exposure at all, so we return
 * `none` rather than attributing darkness to a side. That distinction matters:
 * a night trip must not look like a trip with evenly balanced sun.
 */
export function classifyExposure(
  relativeAngleDegrees: number,
  sunAltitudeDegrees: number,
): ExposureDirection {
  if (sunAltitudeDegrees <= 0) return 'none';

  const angle = relativeAngleDegrees;
  if (angle >= -45 && angle <= 45) return 'front';
  if (angle > 45 && angle <= 135) return 'right';
  if (angle < -45 && angle >= -135) return 'left';
  return 'back';
}

interface DirectionTotals {
  front: number;
  back: number;
  left: number;
  right: number;
}

const emptyTotals = (): DirectionTotals => ({ front: 0, back: 0, left: 0, right: 0 });

/**
 * Aggregates samples into per-direction exposure and a seating recommendation.
 *
 * Two parallel accumulators are kept:
 *
 * - **Time** (seconds per face) → the "% of trip time" figures.
 * - **Weighted intensity** (Σ intensity × minutes, i.e. "intensity-minutes")
 *   → the figure the recommendation is actually based on, because ten minutes
 *   of harsh overhead sun matters more than an hour of dusk glow.
 *
 * Both are weighted by each sample's `durationSeconds`, so a trailing partial
 * interval never counts as a full one.
 */
export function summarizeExposure(
  samples: RouteSample[],
  context: { routeDurationSeconds: number; hasStepData: boolean } = {
    routeDurationSeconds: 0,
    hasStepData: true,
  },
): ExposureSummary {
  const timeByDirection = emptyTotals();
  const weightedByDirection = emptyTotals();

  let totalSeconds = 0;
  let daylightSeconds = 0;
  let intensitySecondsTotal = 0;

  for (const sample of samples) {
    const seconds = sample.durationSeconds;
    if (seconds <= 0) continue;

    totalSeconds += seconds;
    intensitySecondsTotal += sample.sunIntensity * seconds;
    if (sample.isDaylight) daylightSeconds += seconds;

    if (sample.exposedDirection === 'none') continue;

    timeByDirection[sample.exposedDirection] += seconds;
    // Intensity-minutes keeps the numbers in a readable range.
    weightedByDirection[sample.exposedDirection] += (sample.sunIntensity * seconds) / 60;
  }

  const pct = (seconds: number) => (totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0);

  const daylightPercentage = pct(daylightSeconds);
  const averageIntensity = totalSeconds > 0 ? intensitySecondsTotal / totalSeconds : 0;

  const { seatSide, confidence, explanation, caveats } = recommendSeat({
    weighted: weightedByDirection,
    time: timeByDirection,
    daylightPercentage,
    averageIntensity,
    sampleCount: samples.length,
    hasStepData: context.hasStepData,
  });

  return {
    frontPercentage: pct(timeByDirection.front),
    backPercentage: pct(timeByDirection.back),
    leftPercentage: pct(timeByDirection.left),
    rightPercentage: pct(timeByDirection.right),

    frontWeightedIntensity: weightedByDirection.front,
    backWeightedIntensity: weightedByDirection.back,
    leftWeightedIntensity: weightedByDirection.left,
    rightWeightedIntensity: weightedByDirection.right,

    daylightPercentage,
    averageIntensity,

    recommendedSeatSide: seatSide,
    confidence,
    explanation,
    caveats,
  };
}

interface RecommendationInput {
  weighted: DirectionTotals;
  time: DirectionTotals;
  daylightPercentage: number;
  averageIntensity: number;
  sampleCount: number;
  hasStepData: boolean;
}

interface RecommendationResult {
  seatSide: SeatSide;
  confidence: ConfidenceLevel;
  explanation: string;
  caveats: string[];
}

/** Below this average intensity the sun is too weak for seat choice to matter. */
const NEGLIGIBLE_INTENSITY = 8;
/** Below this share of daylight we treat the trip as essentially a night trip. */
const NIGHT_TRIP_DAYLIGHT_PCT = 15;

/**
 * Turns aggregated exposure into advice.
 *
 * The core inversion: you want to sit on the side the sun is *not* hitting, so
 * heavy left-side exposure means "sit on the right". Front/back exposure is
 * reported but cannot be escaped by choosing a side of the aisle, so when it
 * dominates we say so instead of pretending the choice matters.
 */
export function recommendSeat(input: RecommendationInput): RecommendationResult {
  const { weighted, time, daylightPercentage, averageIntensity, sampleCount, hasStepData } = input;
  const caveats: string[] = [];

  const sideTotal = weighted.left + weighted.right;
  const allTotal = sideTotal + weighted.front + weighted.back;

  // --- Degenerate cases first -------------------------------------------------

  if (daylightPercentage < NIGHT_TRIP_DAYLIGHT_PCT) {
    caveats.push('The sun is below the horizon for most or all of this trip.');
    return {
      seatSide: 'either',
      confidence: 'high',
      explanation:
        `The sun is above the horizon for only ${daylightPercentage.toFixed(0)}% of the journey, ` +
        'so sun exposure is negligible. Sit wherever you like — pick for legroom or the view.',
      caveats,
    };
  }

  if (averageIntensity < NEGLIGIBLE_INTENSITY || allTotal <= 0) {
    caveats.push('Average sun intensity across the trip is very low (sun stays near the horizon).');
    return {
      seatSide: 'either',
      confidence: 'medium',
      explanation:
        `Average sun intensity is only ${averageIntensity.toFixed(0)}/100, so neither side gets ` +
        'meaningfully more heat or glare. Either side is acceptable.',
      caveats,
    };
  }

  // --- Normal case ------------------------------------------------------------

  const dominant = dominantDirection(weighted);
  const sideShare = allTotal > 0 ? sideTotal / allTotal : 0;

  // How lopsided is left vs right? 0 = perfectly balanced, 1 = entirely one side.
  const sideMargin = sideTotal > 0 ? Math.abs(weighted.left - weighted.right) / sideTotal : 0;

  if (!hasStepData) {
    caveats.push(
      'The router returned no step-level timings for this route, so the bus position was ' +
        'interpolated at constant speed.',
    );
  }
  if (sampleCount < 3) {
    caveats.push('Only a couple of sample points fit in this trip, so the split is coarse.');
  }
  if (daylightPercentage < 60) {
    caveats.push(
      `Only ${daylightPercentage.toFixed(0)}% of the trip is in daylight; the rest contributes nothing.`,
    );
  }

  // Front/back dominant: the aisle side barely matters.
  if ((dominant === 'front' || dominant === 'back') && sideShare < 0.4) {
    const label = dominant === 'front' ? 'ahead of' : 'behind';
    const seatSide: SeatSide =
      sideMargin > 0.2 ? (weighted.left > weighted.right ? 'right' : 'left') : 'either';

    const tail =
      seatSide === 'either'
        ? 'Left and right receive almost the same amount, so choose either side.'
        : `If you want to split hairs, the ${seatSide} side gets slightly less, so lean that way.`;

    return {
      seatSide,
      confidence: 'medium',
      explanation:
        `The sun sits mostly ${label} the bus for this journey (${percentOf(weighted, dominant)}% of ` +
        `the weighted exposure), which means your choice of left or right seat has limited impact. ${tail}`,
      caveats,
    };
  }

  const sunnySide: 'left' | 'right' = weighted.left >= weighted.right ? 'left' : 'right';
  const shadySide: 'left' | 'right' = sunnySide === 'left' ? 'right' : 'left';

  // Near-tie between the two sides: don't fake precision.
  if (sideMargin < 0.1) {
    return {
      seatSide: 'either',
      confidence: 'low',
      explanation:
        'Left and right receive almost identical sun over this journey ' +
        `(${time.left.toFixed(0) === time.right.toFixed(0) ? 'an even split' : 'within 10% of each other'}), ` +
        'so there is no clearly better side. Either will do.',
      caveats,
    };
  }

  const confidence = confidenceFromMargin(sideMargin, daylightPercentage, averageIntensity);

  return {
    seatSide: shadySide,
    confidence,
    explanation:
      `The sun falls on the ${sunnySide} side of the bus for ` +
      `${percentOf(weighted, sunnySide)}% of the weighted sun exposure ` +
      `(${input.time[sunnySide] > 0 ? formatMinutes(input.time[sunnySide]) : '0 min'} of trip time). ` +
      `Sit on the ${shadySide} side to stay out of it.`,
    caveats,
  };
}

function dominantDirection(weighted: DirectionTotals): keyof DirectionTotals {
  return (Object.keys(weighted) as (keyof DirectionTotals)[]).reduce((best, key) =>
    weighted[key] > weighted[best] ? key : best,
  );
}

function percentOf(weighted: DirectionTotals, key: keyof DirectionTotals): string {
  const total = weighted.front + weighted.back + weighted.left + weighted.right;
  if (total <= 0) return '0';
  return ((weighted[key] / total) * 100).toFixed(0);
}

function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Confidence combines three things: how lopsided the left/right split is, how
 * much of the trip is actually in daylight, and how strong the sun gets. A
 * decisive split during a bright midday trip is high confidence; a marginal
 * split at dusk is not.
 */
function confidenceFromMargin(
  sideMargin: number,
  daylightPercentage: number,
  averageIntensity: number,
): ConfidenceLevel {
  if (sideMargin >= 0.35 && daylightPercentage >= 70 && averageIntensity >= 25) return 'high';
  if (sideMargin >= 0.18 && daylightPercentage >= 40) return 'medium';
  return 'low';
}
