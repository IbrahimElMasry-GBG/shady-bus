import 'server-only';

import type { AppErrorCode, LatLng, ResolvedPlace, RouteOption, RouteStep } from '@/types';
import { AppError } from './errors';
import { parseMapLink } from './parseMapLink';
import { decodePolyline, encodePolyline, simplifyPolyline } from './polyline';

/**
 * All map-service access lives here, server-side only.
 *
 * Everything this app talks to is part of the OpenStreetMap ecosystem and needs
 * **no API key, no billing account and no sign-up**:
 *
 *  - **OSRM** (`router.project-osrm.org`) — driving routes and alternatives,
 *    computed from OSM road data.
 *  - **Nominatim** (`nominatim.openstreetmap.org`) — turning a place name or an
 *    OSM object id into coordinates.
 *
 * Both are volunteer-run demo servers with a usage policy: identify yourself
 * with a real User-Agent, and keep the request rate low (Nominatim allows at
 * most one request per second). This app sends at most three requests per
 * analysis and resolves the two endpoints sequentially, which stays inside that
 * budget. Point `OSRM_BASE_URL` / `NOMINATIM_BASE_URL` at your own instance if
 * you ever need more than that.
 *
 * The `server-only` import above keeps this module out of any client bundle, so
 * the outbound calls (and their User-Agent) always come from the server.
 */

const OSRM_BASE_URL = (process.env.OSRM_BASE_URL?.trim() || 'https://router.project-osrm.org').replace(
  /\/+$/,
  '',
);
const NOMINATIM_BASE_URL = (
  process.env.NOMINATIM_BASE_URL?.trim() || 'https://nominatim.openstreetmap.org'
).replace(/\/+$/, '');

/**
 * Both operators require a User-Agent that identifies the application; Nominatim
 * answers 403 to requests without one.
 */
const USER_AGENT =
  process.env.OSM_USER_AGENT?.trim() ||
  'Mozilla/5.0 (compatible; BusSunAdvisor/1.0; +https://www.openstreetmap.org/copyright)';

/** How many route alternatives to ask OSRM for. It returns fewer when none exist. */
const ALTERNATIVE_ROUTES = 3;

// ---------------------------------------------------------------------------
// Short link expansion
// ---------------------------------------------------------------------------

/**
 * Follows a `maps.app.goo.gl` short link to its full URL.
 *
 * Only Google's short links need this. An OpenStreetMap shortlink carries its
 * coordinates inside the code itself and is decoded offline in `parseMapLink`.
 */
export async function expandShortLink(shortUrl: string): Promise<string> {
  try {
    const response = await fetch(shortUrl, {
      redirect: 'follow',
      // A browser-ish UA: Google serves a bare redirect to these and an
      // interstitial to unknown clients.
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    return response.url || shortUrl;
  } catch {
    throw new AppError('COORDINATES_NOT_FOUND', 'Could not expand that shortened link.', {
      hint:
        'Open the short link in a browser, wait for the full URL to appear in the address bar, and ' +
        'paste that instead.',
    });
  }
}

// ---------------------------------------------------------------------------
// Geocoding (Nominatim)
// ---------------------------------------------------------------------------

/** One Nominatim result. `lat`/`lon` arrive as strings, hence the `Number()`. */
interface NominatimPlace {
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
}

async function nominatim(path: string, params: Record<string, string>): Promise<NominatimPlace[]> {
  const url = new URL(`${NOMINATIM_BASE_URL}${path}`);
  url.searchParams.set('format', 'jsonv2');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError('MAP_SERVICE_ERROR', 'Could not reach the Nominatim geocoding service.', {
      hint: 'Check the server’s network connection and try again.',
      status: 502,
    });
  }

  if (!response.ok) {
    throw nominatimError(response.status);
  }

  const data = (await response.json().catch(() => null)) as NominatimPlace[] | null;
  return Array.isArray(data) ? data : [];
}

function toResolvedPlace(place: NominatimPlace, fallbackLabel: string): ResolvedPlace | null {
  const lat = Number(place.lat);
  const lng = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    label: place.display_name?.trim() || place.name?.trim() || fallbackLabel,
    source: 'geocoded',
  };
}

/** Resolves a place name to coordinates via a Nominatim search. */
export async function geocodePlace(query: string): Promise<ResolvedPlace> {
  const results = await nominatim('/search', { q: query, limit: '1' });
  const resolved = results.length > 0 ? toResolvedPlace(results[0], query) : null;

  if (!resolved) {
    throw new AppError(
      'COORDINATES_NOT_FOUND',
      `OpenStreetMap has no place matching "${query}".`,
      {
        hint: 'Try a share link that contains coordinates, or paste "latitude, longitude" directly.',
      },
    );
  }

  return resolved;
}

/** Resolves an OSM object link (`/node/123`, `/way/123`, `/relation/123`). */
export async function lookupOsmObject(
  osmType: 'node' | 'way' | 'relation',
  osmId: string,
): Promise<ResolvedPlace> {
  const prefix = { node: 'N', way: 'W', relation: 'R' }[osmType];
  const results = await nominatim('/lookup', { osm_ids: `${prefix}${osmId}` });
  const resolved = results.length > 0 ? toResolvedPlace(results[0], `${osmType}/${osmId}`) : null;

  if (!resolved) {
    throw new AppError(
      'COORDINATES_NOT_FOUND',
      `OpenStreetMap ${osmType} ${osmId} could not be resolved to a position.`,
      { hint: 'Open the object on openstreetmap.org, use the Share panel, and paste that link instead.' },
    );
  }

  return resolved;
}

/**
 * Full resolution pipeline for one user-supplied link:
 * parse → (expand short link → parse again) → (search or look up a name/id).
 */
export async function resolvePlaceFromLink(
  link: string,
  which: 'origin' | 'destination',
): Promise<ResolvedPlace> {
  const invalidCode: AppErrorCode =
    which === 'origin' ? 'INVALID_ORIGIN_LINK' : 'INVALID_DESTINATION_LINK';

  let parsed = parseMapLink(link);

  if (parsed.kind === 'short-link') {
    const expanded = await expandShortLink(parsed.url);
    parsed = parseMapLink(expanded);
    // A short link that still resolves to a short link means the redirect did
    // not happen (e.g. a consent interstitial) — say so precisely.
    if (parsed.kind === 'short-link') {
      throw new AppError(invalidCode, `The shortened ${which} link could not be resolved.`, {
        hint: 'Open it in a browser and paste the full link from the address bar instead.',
      });
    }
  }

  if (parsed.kind === 'unknown') {
    throw new AppError(invalidCode, `Invalid ${which} link: ${parsed.reason}`);
  }

  if (parsed.kind === 'coords') {
    return {
      lat: parsed.lat,
      lng: parsed.lng,
      label: parsed.label ?? `${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`,
      source: parsed.label ? 'url-coordinates' : 'raw-coordinates',
    };
  }

  if (parsed.kind === 'osm-object') {
    return lookupOsmObject(parsed.osmType, parsed.osmId);
  }

  // Only a place name — needs a Nominatim search.
  return geocodePlace(parsed.query);
}

// ---------------------------------------------------------------------------
// Routes (OSRM)
// ---------------------------------------------------------------------------

interface OsrmStep {
  distance?: number;
  duration?: number;
  name?: string;
}

interface OsrmLeg {
  summary?: string;
  steps?: OsrmStep[];
}

interface OsrmRoute {
  distance?: number;
  duration?: number;
  geometry?: string;
  legs?: OsrmLeg[];
}

interface OsrmResponse {
  code?: string;
  message?: string;
  routes?: OsrmRoute[];
}

/**
 * Computes the primary driving route plus alternatives.
 *
 * OSRM has no live-traffic model, so the departure time plays no part here — it
 * only matters later, when the sun is evaluated along the route. Durations are
 * free-flow estimates from the road network, which is why the caller surfaces a
 * warning about it rather than quietly presenting them as traffic-aware.
 */
export async function computeRoutes(
  origin: LatLng,
  destination: LatLng,
): Promise<{ routes: RouteOption[]; warnings: string[] }> {
  const warnings: string[] = [];

  // OSRM takes coordinates as `longitude,latitude` — the opposite order to the
  // rest of this codebase. Getting this wrong returns a plausible route through
  // the wrong hemisphere rather than an error, so it is built exactly once here.
  const path = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = new URL(`${OSRM_BASE_URL}/route/v1/driving/${path}`);
  url.searchParams.set('alternatives', String(ALTERNATIVE_ROUTES));
  url.searchParams.set('overview', 'full'); // full-resolution geometry
  url.searchParams.set('geometries', 'polyline'); // precision-5 encoded polyline
  url.searchParams.set('steps', 'true'); // per-step distance/duration + leg summaries

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AppError('MAP_SERVICE_ERROR', 'Could not reach the OSRM routing service.', {
      hint: 'Check the server’s network connection and try again.',
      status: 502,
    });
  }

  const data = (await response.json().catch(() => null)) as OsrmResponse | null;

  if (!response.ok || !data || (data.code && data.code !== 'Ok')) {
    throw osrmError(response.status, data?.code, data?.message);
  }

  if (!data.routes?.length) {
    throw new AppError('NO_ROUTE_FOUND', 'OSRM found no drivable route between these two points.', {
      hint: 'Check that both points are reachable by road — sea crossings and islands often have none.',
    });
  }

  const routes = data.routes
    .map((route, index) => toRouteOption(route, index))
    .filter((route): route is RouteOption => route !== null);

  if (routes.length === 0) {
    throw new AppError(
      'INSUFFICIENT_POLYLINE',
      'OSRM returned routes but none of them included usable path geometry.',
      { hint: 'Try slightly different start or end points.' },
    );
  }

  if (routes.length < data.routes.length) {
    warnings.push(
      `${data.routes.length - routes.length} route(s) were dropped because their path data was unusable.`,
    );
  }

  warnings.push(
    'Routes come from OSRM, which models free-flow road speeds and has no live traffic data, so the ' +
      'bus may be somewhere ahead of or behind the modelled position on a congested day.',
  );

  if (routes.length === 1) {
    warnings.push(
      'OSRM offered no alternative route for this journey, so only the fastest one was analysed.',
    );
  }

  return { routes, warnings };
}

/** Maps one OSRM route onto our domain model; returns null if unusable. */
function toRouteOption(route: OsrmRoute, index: number): RouteOption | null {
  const encoded = route.geometry;
  if (!encoded) return null;

  const points = decodePolyline(encoded);
  if (points.length < 2) return null;

  const legs = route.legs ?? [];

  const steps: RouteStep[] = legs.flatMap((leg) =>
    (leg.steps ?? []).map((step) => ({
      distanceMeters: step.distance ?? 0,
      durationSeconds: step.duration ?? 0,
    })),
  );

  // OSRM's leg summary is the two or three biggest roads on that leg, which is
  // the closest thing it has to Google's route description.
  const summary = legs
    .map((leg) => leg.summary?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' → ');

  return {
    id: `route-${index}`,
    name: index === 0 ? 'Primary route' : `Alternate route ${index}`,
    summary: summary || 'Unnamed road',
    distanceMeters: Math.round(route.distance ?? 0),
    durationSeconds: Math.round(route.duration ?? 0),
    encodedPolyline: encoded,
    // Thinned copy for the map preview: the shape survives, the payload does not
    // carry thousands of near-identical vertices to the browser.
    previewPolyline: encodePolyline(simplifyPolyline(points, 400)),
    steps,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Translates OSRM's own status codes into advice. `NoSegment` in particular
 * looks like a server fault but is really "your coordinates are nowhere near a
 * road", which the user can fix in seconds.
 */
function osrmError(httpStatus: number, code: string | undefined, message: string | undefined): AppError {
  if (code === 'NoRoute') {
    return new AppError('NO_ROUTE_FOUND', 'OSRM found no drivable route between these two points.', {
      hint: 'Check that both points are reachable by road — sea crossings and islands often have none.',
    });
  }

  if (code === 'NoSegment') {
    return new AppError('NO_ROUTE_FOUND', 'One of the points is not near any road OSRM knows about.', {
      hint: 'Move the pin onto a street — a point in the sea, a field or a pedestrian-only area has no road to start from.',
    });
  }

  if (code === 'TooBig') {
    return new AppError('MAP_SERVICE_ERROR', 'That journey is too large for the public OSRM server.', {
      hint: 'Split the trip into shorter legs, or run your own OSRM instance and set OSRM_BASE_URL.',
      status: 502,
    });
  }

  if (httpStatus === 429) {
    return new AppError('MAP_SERVICE_ERROR', 'The public OSRM server is rate-limiting this app.', {
      hint: 'Wait a moment and try again. Heavy use should run against your own OSRM instance (OSRM_BASE_URL).',
      status: 502,
    });
  }

  if (code === 'InvalidValue' || code === 'InvalidQuery' || httpStatus === 400) {
    return new AppError('MAP_SERVICE_ERROR', 'OSRM rejected the request parameters.', {
      hint: 'This usually means the coordinates parsed from a link are not valid road locations.',
      status: 502,
    });
  }

  return new AppError('MAP_SERVICE_ERROR', `OSRM error: ${code ?? `HTTP ${httpStatus}`}`, {
    hint: message ? message.slice(0, 300) : undefined,
    status: 502,
  });
}

/** Nominatim's failures are almost always about its usage policy, not the query. */
function nominatimError(httpStatus: number): AppError {
  if (httpStatus === 403) {
    return new AppError('MAP_SERVICE_ERROR', 'Nominatim refused the request.', {
      hint:
        'Its usage policy requires an identifying User-Agent — set OSM_USER_AGENT to something naming ' +
        'this app and a contact address.',
      status: 502,
    });
  }

  if (httpStatus === 429) {
    return new AppError('MAP_SERVICE_ERROR', 'Nominatim is rate-limiting this app.', {
      hint: 'Its public server allows about one request per second. Wait a moment and try again.',
      status: 502,
    });
  }

  return new AppError('MAP_SERVICE_ERROR', `Nominatim error: HTTP ${httpStatus}`, { status: 502 });
}
