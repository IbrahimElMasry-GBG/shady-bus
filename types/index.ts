/**
 * Shared domain models for the Bus Sun-Side Advisor.
 *
 * These types are deliberately framework-free so that every calculation module
 * (`lib/routeSampling.ts`, `lib/sunPosition.ts`, `lib/exposureCalculator.ts`)
 * stays pure and unit-testable without Next.js or network access.
 */

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

/** A resolved trip endpoint: coordinates plus whatever human label we recovered. */
export interface ResolvedPlace extends LatLng {
  /** Human readable label, e.g. "Cairo, Egypt". May be the raw query if unknown. */
  label: string;
  /** How the coordinates were obtained — useful for surfacing confidence to the user. */
  source: 'url-coordinates' | 'geocoded' | 'raw-coordinates';
}

/**
 * Result of statically parsing a map link, *before* any network call.
 * `coords` means we recovered lat/lng from the URL itself; `query` and
 * `osm-object` mean we recovered only a name or an OSM id and need a Nominatim
 * lookup; `short-link` means a Google short link that must be expanded first.
 */
export type ParsedMapsLink =
  | { kind: 'coords'; lat: number; lng: number; label?: string; needsExpansion?: boolean }
  | { kind: 'query'; query: string; needsExpansion?: boolean }
  | { kind: 'osm-object'; osmType: 'node' | 'way' | 'relation'; osmId: string }
  | { kind: 'short-link'; url: string }
  | { kind: 'unknown'; reason: string };

// ---------------------------------------------------------------------------
// Trip input
// ---------------------------------------------------------------------------

export interface TripInput {
  /** OpenStreetMap or Google Maps share link (or raw "lat,lng") for the trip origin. */
  originLink: string;
  /** OpenStreetMap or Google Maps share link (or raw "lat,lng") for the trip destination. */
  destinationLink: string;
  /** Local departure date at the origin, ISO `YYYY-MM-DD`. */
  date: string;
  /** Local departure time at the origin, 24h `HH:mm`. */
  startTime: string;
}

// ---------------------------------------------------------------------------
// Sun
// ---------------------------------------------------------------------------

export interface SunPosition {
  /** Compass bearing of the sun, 0–360, where 0 = true north and 90 = east. */
  azimuthDegrees: number;
  /** Elevation above the horizon in degrees. Negative means below the horizon. */
  altitudeDegrees: number;
  /** True when the sun is above the geometric horizon (altitude > 0). */
  isDaylight: boolean;
  /** Relative irradiance proxy on a 0–100 scale. See `lib/sunPosition.ts`. */
  intensity: number;
}

// ---------------------------------------------------------------------------
// Exposure
// ---------------------------------------------------------------------------

/** Which face of the bus the sun is currently striking. */
export type ExposureDirection = 'front' | 'back' | 'left' | 'right' | 'none';

/** Which side of the aisle we tell the passenger to sit on. */
export type SeatSide = 'left' | 'right' | 'either';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export interface RouteSample {
  /** Absolute instant of this sample, milliseconds since the Unix epoch (UTC). */
  timestamp: number;
  /** The same instant rendered in the origin's local timezone, `HH:mm`. */
  localTimeLabel: string;
  /** Seconds elapsed since departure. */
  elapsedSeconds: number;
  /** Seconds of trip time this sample stands for (used as the weighting factor). */
  durationSeconds: number;
  latitude: number;
  longitude: number;
  /** Metres travelled along the route at this sample. */
  distanceAlongRouteMeters: number;
  /** Direction of travel, compass degrees 0–360. */
  busHeadingDegrees: number;
  sunAzimuthDegrees: number;
  sunAltitudeDegrees: number;
  /** Sun azimuth minus bus heading, normalised to (-180, +180]. */
  relativeSunAngleDegrees: number;
  exposedDirection: ExposureDirection;
  /** 0–100 irradiance proxy. */
  sunIntensity: number;
  isDaylight: boolean;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface ExposureSummary {
  // Share of total trip time each face is sunlit, 0–100. Night time is excluded
  // from every bucket, so these need not add up to 100.
  frontPercentage: number;
  backPercentage: number;
  leftPercentage: number;
  rightPercentage: number;

  // Intensity-weighted exposure per face, expressed as "intensity-minutes"
  // (Σ intensity × minutes). Directly comparable between faces of one route.
  frontWeightedIntensity: number;
  backWeightedIntensity: number;
  leftWeightedIntensity: number;
  rightWeightedIntensity: number;

  /** Share of trip time with the sun above the horizon, 0–100. */
  daylightPercentage: number;
  /** Mean sun intensity across the whole trip (night counted as 0), 0–100. */
  averageIntensity: number;

  recommendedSeatSide: SeatSide;
  confidence: ConfidenceLevel;
  explanation: string;
  /** Known blind spots for this particular result. */
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface RouteStep {
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteOption {
  /** Stable id, e.g. `route-0`. */
  id: string;
  /** "Primary route", "Alternate route 1", … */
  name: string;
  /** OSRM's leg summary — the main roads used, e.g. "Cairo–Alexandria Desert Rd". */
  summary: string;
  distanceMeters: number;
  /** Free-flow driving time from OSRM. It carries no live traffic information. */
  durationSeconds: number;
  /** Full encoded polyline (Google's precision-5 format, which OSRM also emits). */
  encodedPolyline: string;
  /** Down-sampled polyline, small enough to send to the browser for the map preview. */
  previewPolyline: string;
  steps: RouteStep[];
}

export interface RouteRecommendation {
  route: RouteOption;
  samples: RouteSample[];
  summary: ExposureSummary;
}

// ---------------------------------------------------------------------------
// API contract
// ---------------------------------------------------------------------------

/** The POST body of `/api/analyze` is exactly the trip input. */
export type AnalyzeRequestBody = TripInput;

export interface AnalyzeSuccessResponse {
  ok: true;
  origin: ResolvedPlace;
  destination: ResolvedPlace;
  /** IANA timezone resolved from the origin coordinates, e.g. "Africa/Cairo". */
  timeZone: string;
  /** Departure instant, ms since epoch. */
  departureTimestamp: number;
  /** Sampling interval actually used, in minutes (30 unless the trip is short). */
  intervalMinutes: number;
  routes: RouteRecommendation[];
  /** Non-fatal problems worth showing the user. */
  warnings: string[];
}

/** Machine-readable failure codes so the UI can render tailored guidance. */
export type AppErrorCode =
  | 'INVALID_ORIGIN_LINK'
  | 'INVALID_DESTINATION_LINK'
  | 'COORDINATES_NOT_FOUND'
  | 'MISSING_DATE'
  | 'MISSING_TIME'
  | 'NO_ROUTE_FOUND'
  | 'INSUFFICIENT_POLYLINE'
  /** OSRM or Nominatim was unreachable, rate-limiting us, or rejected the request. */
  | 'MAP_SERVICE_ERROR'
  | 'INTERNAL_ERROR';

export interface AnalyzeErrorResponse {
  ok: false;
  code: AppErrorCode;
  message: string;
  /** Optional actionable hint, e.g. how to fix the link that failed to parse. */
  hint?: string;
}

export type AnalyzeResponse = AnalyzeSuccessResponse | AnalyzeErrorResponse;
