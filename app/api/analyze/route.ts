import { NextResponse } from 'next/server';

import type {
  AnalyzeRequestBody,
  AnalyzeResponse,
  RouteRecommendation,
} from '@/types';
import { AppError } from '@/lib/errors';
import { computeRoutes, resolvePlaceFromLink } from '@/lib/osm';
import { summarizeExposure } from '@/lib/exposureCalculator';
import {
  DEFAULT_INTERVAL_MINUTES,
  chooseIntervalMinutes,
  sampleRoute,
} from '@/lib/routeSampling';
import { timeZoneForCoordinates, zonedWallClockToUtc } from '@/lib/time';

// Route Handlers are uncached by default in Next.js 16, and `nodejs` is the
// default runtime, so no route segment config is needed here.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

/**
 * POST /api/analyze
 *
 * Orchestration only — every calculation lives in a pure module under `lib/`:
 *
 *   1. validate input
 *   2. resolve both links to coordinates (expanding short links, geocoding names)
 *   3. resolve the origin's timezone and turn the wall clock into a real instant
 *   4. ask OSRM for the primary route plus alternatives
 *   5. sample each route on a fixed interval and evaluate the sun at each point
 *   6. aggregate into a per-route recommendation
 */
export async function POST(request: Request): Promise<NextResponse<AnalyzeResponse>> {
  try {
    const body = (await request.json()) as Partial<AnalyzeRequestBody>;

    // --- 1. Validate ---------------------------------------------------------
    if (!body.originLink?.trim()) {
      throw new AppError('INVALID_ORIGIN_LINK', 'Please paste a map link for the starting point.');
    }
    if (!body.destinationLink?.trim()) {
      throw new AppError('INVALID_DESTINATION_LINK', 'Please paste a map link for the destination.');
    }
    if (!body.date?.trim()) {
      throw new AppError('MISSING_DATE', 'Please choose a trip date.');
    }
    if (!DATE_PATTERN.test(body.date)) {
      throw new AppError('MISSING_DATE', 'The trip date must be in YYYY-MM-DD format.');
    }
    if (!body.startTime?.trim()) {
      throw new AppError('MISSING_TIME', 'Please choose a trip start time.');
    }
    if (!TIME_PATTERN.test(body.startTime)) {
      throw new AppError('MISSING_TIME', 'The start time must be in HH:mm format.');
    }

    const warnings: string[] = [];

    // --- 2. Resolve both endpoints ------------------------------------------
    // Sequential rather than parallel so that a bad origin link produces the
    // origin-specific error instead of whichever request happened to reject first.
    // It also keeps us inside Nominatim's one-request-per-second usage policy on
    // the links that need geocoding at all.
    const origin = await resolvePlaceFromLink(body.originLink, 'origin');
    const destination = await resolvePlaceFromLink(body.destinationLink, 'destination');

    if (origin.source === 'geocoded') {
      warnings.push(`The starting point was resolved by name to "${origin.label}".`);
    }
    if (destination.source === 'geocoded') {
      warnings.push(`The destination was resolved by name to "${destination.label}".`);
    }

    // --- 3. Timezone-correct departure instant -------------------------------
    const timeZone = timeZoneForCoordinates(origin.lat, origin.lng);
    if (timeZone === 'UTC') {
      warnings.push(
        'No timezone could be determined for the starting coordinates, so times are treated as UTC.',
      );
    }
    const departureTimestamp = zonedWallClockToUtc(body.date, body.startTime, timeZone);

    // --- 4. Routes -----------------------------------------------------------
    // The departure time plays no part in routing — OSRM has no traffic model —
    // so it is used only when the sun is evaluated along the route below.
    const { routes, warnings: routeWarnings } = await computeRoutes(origin, destination);
    warnings.push(...routeWarnings);

    // --- 5 & 6. Sample and summarise each route ------------------------------
    const intervalMinutes = chooseIntervalMinutes(
      Math.min(...routes.map((route) => route.durationSeconds)),
    );
    if (intervalMinutes !== DEFAULT_INTERVAL_MINUTES) {
      warnings.push(
        `This trip is shorter than ${DEFAULT_INTERVAL_MINUTES} minutes, so it was sampled every ` +
          `${intervalMinutes} minutes instead. Sun exposure over such a short journey barely changes.`,
      );
    }

    const recommendations: RouteRecommendation[] = [];
    for (const route of routes) {
      try {
        const samples = sampleRoute(route, {
          departureTimestamp,
          timeZone,
          intervalMinutes,
        });
        const hasStepData = route.steps.some((step) => step.durationSeconds > 0);
        recommendations.push({
          route,
          samples,
          summary: summarizeExposure(samples, {
            routeDurationSeconds: route.durationSeconds,
            hasStepData,
          }),
        });
      } catch {
        // One unusable route must not sink the whole response.
        warnings.push(`"${route.name}" was skipped because its path data could not be sampled.`);
      }
    }

    if (recommendations.length === 0) {
      throw new AppError(
        'INSUFFICIENT_POLYLINE',
        'None of the returned routes had enough path data to analyse.',
      );
    }

    const nightRoutes = recommendations.filter((r) => r.summary.daylightPercentage < 15);
    if (nightRoutes.length === recommendations.length) {
      warnings.push(
        'The sun is below the horizon for essentially the whole journey on every route — ' +
          'this is a night trip and seat choice will not affect sun exposure.',
      );
    }

    return NextResponse.json({
      ok: true,
      origin,
      destination,
      timeZone,
      departureTimestamp,
      intervalMinutes,
      routes: recommendations,
      warnings,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message, hint: error.hint },
        { status: error.status },
      );
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, code: 'INTERNAL_ERROR', message: 'The request body was not valid JSON.' },
        { status: 400 },
      );
    }

    console.error('[analyze] unexpected failure', error);
    return NextResponse.json(
      {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong while analysing this trip.',
        hint: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
