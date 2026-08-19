import type { ParsedMapsLink } from '@/types';

/**
 * Static parsing of map links — no network, no API key, no paid service.
 *
 * Two families of link are understood:
 *
 * **OpenStreetMap** (the primary format now that routing and geocoding both run
 * on OSM data):
 *  1. `?mlat=30.0444&mlon=31.2357` — the marker OSM pinned. Most trustworthy.
 *  2. `#map=15/30.0444/31.2357`    — the map viewport centre from the Share tab.
 *  3. `/directions?from=…&to=…`    — either endpoint of a directions link.
 *  4. `osm.org/go/0EEQjE--`        — a shortlink, decoded locally (see below).
 *  5. `/node/123`, `/way/123`      — an object id; needs a Nominatim lookup.
 *  6. `?query=Cairo+Tower`         — a name; needs a Nominatim search.
 *
 * **Google Maps**, still accepted because reading those URLs costs nothing and
 * people have them in their chat history. In rough order of trustworthiness:
 *  1. `.../data=...!3d30.0444!4d31.2357`  — the exact marker Google pinned.
 *  2. `?q=30.0444,31.2357` / `?query=` / `?ll=` / `?destination=`.
 *  3. `/@30.0444,31.2357,14z` — the map viewport centre, close but not identical.
 *  4. `/place/Some+Name/` with no coordinates — needs a Nominatim search.
 *
 * Google short links (`maps.app.goo.gl`, `goo.gl/maps`) carry no coordinates and
 * must be expanded by following the redirect server-side; that is handled in
 * `lib/osm.ts`, which calls back into this function with the expanded URL.
 * OSM shortlinks need no such round trip — the coordinates are *in* the code.
 */

const GOOGLE_SHORT_LINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co', 'maps.google.com.sa']);
const OSM_HOSTS = new Set(['openstreetmap.org', 'osm.org', 'openstreetmap.com', 'openstreetmap.de']);

/** Plausibility check — rejects transposed or garbage coordinates early. */
export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // 0,0 is in the Gulf of Guinea and is nearly always a parsing artefact.
    !(lat === 0 && lng === 0)
  );
}

/** Accepts a bare `"30.0444, 31.2357"` string as a convenience input. */
export function parseRawCoordinates(input: string): { lat: number; lng: number } | null {
  const match = input.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

export function parseMapLink(rawInput: string): ParsedMapsLink {
  const input = rawInput.trim();

  if (!input) {
    return { kind: 'unknown', reason: 'The link is empty.' };
  }

  // Convenience: allow pasting coordinates directly.
  const raw = parseRawCoordinates(input);
  if (raw) return { kind: 'coords', ...raw, label: coordLabel(raw.lat, raw.lng) };

  // `geo:30.0444,31.2357` — what a phone's share sheet often produces.
  const geo = input.match(/^geo:(-?\d+\.?\d*),(-?\d+\.?\d*)/i);
  if (geo) {
    const lat = Number(geo[1]);
    const lng = Number(geo[2]);
    if (isValidLatLng(lat, lng)) return { kind: 'coords', lat, lng, label: coordLabel(lat, lng) };
  }

  let url: URL;
  try {
    url = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    return {
      kind: 'unknown',
      reason:
        'That does not look like a URL. Paste an OpenStreetMap or Google Maps link, or "latitude, longitude".',
    };
  }

  const host = url.hostname.replace(/^www\./, '');

  if (OSM_HOSTS.has(host)) return parseOsmUrl(url);

  if (GOOGLE_SHORT_LINK_HOSTS.has(host)) {
    // Needs a redirect fetch before we can see any coordinates.
    return { kind: 'short-link', url: url.toString() };
  }

  if (/(^|\.)google\.[a-z.]+$/.test(host) || host === 'maps.google.com') {
    return parseGoogleUrl(url);
  }

  return {
    kind: 'unknown',
    reason:
      `"${host}" is not an OpenStreetMap or Google Maps domain. Use the Share panel on ` +
      'openstreetmap.org and paste that link, or paste "latitude, longitude".',
  };
}

// ---------------------------------------------------------------------------
// OpenStreetMap
// ---------------------------------------------------------------------------

function parseOsmUrl(url: URL): ParsedMapsLink {
  // --- 1. The pinned marker: ?mlat=&mlon= -----------------------------------
  const mlat = Number(url.searchParams.get('mlat'));
  const mlon = Number(url.searchParams.get('mlon'));
  if (url.searchParams.has('mlat') && url.searchParams.has('mlon') && isValidLatLng(mlat, mlon)) {
    return { kind: 'coords', lat: mlat, lng: mlon, label: coordLabel(mlat, mlon) };
  }

  // --- 2. Shortlink: /go/<code> ---------------------------------------------
  const shortMatch = url.pathname.match(/^\/go\/([A-Za-z0-9_~@-]+)/);
  if (shortMatch) {
    const decoded = decodeOsmShortLink(shortMatch[1]);
    if (decoded && isValidLatLng(decoded.lat, decoded.lng)) {
      return { kind: 'coords', lat: decoded.lat, lng: decoded.lng, label: coordLabel(decoded.lat, decoded.lng) };
    }
    return {
      kind: 'unknown',
      reason: 'That OpenStreetMap shortlink could not be decoded — it looks truncated.',
    };
  }

  // --- 3. An object id: /node/1234, /way/1234, /relation/1234 ---------------
  const objectMatch = url.pathname.match(/^\/(node|way|relation)\/(\d+)/);
  if (objectMatch) {
    return { kind: 'osm-object', osmType: objectMatch[1] as 'node' | 'way' | 'relation', osmId: objectMatch[2] };
  }

  // --- 4. Directions endpoints: /directions?from=lat,lng&to=lat,lng ---------
  // A directions link holds *both* ends. Nothing in the URL says which one the
  // user meant to paste into which field, so `from` wins when both are present
  // and the resolved label lets them see what was used.
  for (const key of ['from', 'to', 'query', 'q']) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    const coords = parseRawCoordinates(value);
    if (coords) return { kind: 'coords', ...coords, label: coordLabel(coords.lat, coords.lng) };
    const cleaned = value.replace(/\+/g, ' ').trim();
    if (cleaned.length > 1) return { kind: 'query', query: cleaned };
  }

  // --- 5. Viewport centre in the hash: #map=15/30.0444/31.2357 --------------
  const mapMatch = safeDecode(url.hash).match(/map=\d+(?:\.\d+)?\/(-?\d+\.?\d*)\/(-?\d+\.?\d*)/);
  if (mapMatch) {
    const lat = Number(mapMatch[1]);
    const lng = Number(mapMatch[2]);
    if (isValidLatLng(lat, lng)) return { kind: 'coords', lat, lng, label: coordLabel(lat, lng) };
  }

  return {
    kind: 'unknown',
    reason:
      'No coordinates or place name could be found in that OpenStreetMap link. ' +
      'Open the location on openstreetmap.org, use the Share panel, and copy the link it gives you.',
  };
}

const SHORT_LINK_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_~';

/**
 * Decodes an OpenStreetMap shortlink code (`osm.org/go/0EEQjE--`).
 *
 * The code *is* the coordinate: each character carries three bits of longitude
 * interleaved with three bits of latitude, refining a quadtile address from the
 * whole globe downwards. Trailing `-` characters encode the zoom remainder and
 * contribute no position bits, so they are skipped.
 *
 * Bit shifts are done with multiplication rather than `<<` because the address
 * is padded out to 32 bits, and JavaScript's bitwise operators would wrap that
 * into a negative signed integer.
 *
 * We return the *centre* of the addressed cell rather than its corner: the code
 * truncates position, so the centre halves the worst-case error (≈75 m for a
 * 6-character code, under a metre for 8).
 *
 * @see https://wiki.openstreetmap.org/wiki/Shortlink
 */
export function decodeOsmShortLink(code: string): { lat: number; lng: number } | null {
  let x = 0;
  let y = 0;
  let bits = 0;

  for (const character of code) {
    // `@` is an older spelling of `~`.
    const value = SHORT_LINK_ALPHABET.indexOf(character === '@' ? '~' : character);
    if (value < 0) continue; // zoom padding ('-'), not position

    let remaining = value;
    for (let i = 0; i < 3; i += 1) {
      x = x * 2 + ((remaining & 32) === 0 ? 0 : 1);
      remaining = (remaining << 1) & 63;
      y = y * 2 + ((remaining & 32) === 0 ? 0 : 1);
      remaining = (remaining << 1) & 63;
    }
    bits += 3;
  }

  if (bits === 0) return null;

  const scale = 2 ** (32 - bits);
  const world = 2 ** 32;
  const cellLng = (360 * scale) / world;
  const cellLat = (180 * scale) / world;

  const lng = (x * scale * 360) / world - 180 + cellLng / 2;
  const lat = (y * scale * 180) / world - 90 + cellLat / 2;

  return { lat, lng };
}

// ---------------------------------------------------------------------------
// Google Maps
// ---------------------------------------------------------------------------

function parseGoogleUrl(url: URL): ParsedMapsLink {
  const decodedHref = safeDecode(url.toString());

  // --- 1. The pinned marker: !3d<lat>!4d<lng> --------------------------------
  // Present on /place/ links. Direction links (/dir/) contain one pair per
  // waypoint, so we only trust it when there is exactly one, or when the URL is
  // unambiguously a single place.
  const markerMatches = [...decodedHref.matchAll(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/g)];
  const isSinglePlace = url.pathname.includes('/place/') || url.pathname.includes('/search/');
  if (markerMatches.length === 1 || (isSinglePlace && markerMatches.length > 0)) {
    const [, latStr, lngStr] = markerMatches[0];
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (isValidLatLng(lat, lng)) {
      return { kind: 'coords', lat, lng, label: placeNameFromPath(url.pathname) };
    }
  }

  // --- 2. Explicit query parameters -----------------------------------------
  const paramKeys = ['q', 'query', 'll', 'destination', 'daddr', 'saddr', 'center', 'viewpoint'];
  for (const key of paramKeys) {
    const value = url.searchParams.get(key);
    if (!value) continue;

    const coords = parseRawCoordinates(value);
    if (coords) return { kind: 'coords', ...coords, label: coordLabel(coords.lat, coords.lng) };

    // A named place — resolvable only through a geocoding search.
    const cleaned = value.replace(/\+/g, ' ').trim();
    if (cleaned.length > 1) return { kind: 'query', query: cleaned };
  }

  // --- 3. Viewport centre: /@lat,lng,zoom -----------------------------------
  const atMatch = decodedHref.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (atMatch) {
    const lat = Number(atMatch[1]);
    const lng = Number(atMatch[2]);
    if (isValidLatLng(lat, lng)) {
      return { kind: 'coords', lat, lng, label: placeNameFromPath(url.pathname) };
    }
  }

  // --- 4. Place name in the path only ---------------------------------------
  const placeName = placeNameFromPath(url.pathname);
  if (placeName) return { kind: 'query', query: placeName };

  return {
    kind: 'unknown',
    reason:
      'No coordinates or place name could be found in that link. ' +
      'Open the location in Google Maps, tap Share, and copy the link it gives you.',
  };
}

/** Extracts a readable place name from `/maps/place/Some+Name/...`. */
function placeNameFromPath(pathname: string): string | undefined {
  const match = pathname.match(/\/(?:place|search|dir)\/([^/@]+)/);
  if (!match) return undefined;
  const name = safeDecode(match[1]).replace(/\+/g, ' ').trim();
  // Skip segments that are really coordinates or Google's internal ids.
  if (!name || /^-?\d+\.\d+,/.test(name) || name.startsWith('data=')) return undefined;
  return name;
}

const coordLabel = (lat: number, lng: number): string => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
