import type { LatLng } from '@/types';

/**
 * The slippy-map arithmetic behind the route preview.
 *
 * Everything here is the standard Web Mercator tile scheme that OpenStreetMap
 * (and every other tile provider) uses: the world is one 256×256 tile at zoom 0
 * and splits into four at each further zoom level. Given a route and a frame
 * size, this module picks the deepest zoom that still fits the whole route, then
 * says which tiles cover the frame and where every route vertex lands in it.
 *
 * It lives apart from the component so the maths can be unit-tested — a preview
 * centred on the wrong continent is exactly the kind of bug that looks fine in a
 * code review and obvious on screen.
 *
 * @see https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */

export const TILE_SIZE = 256;
export const MAX_ZOOM = 18;

export interface Point {
  x: number;
  y: number;
}

export interface Tile {
  /** Stable `z/x/y` identity, unique per layout. */
  key: string;
  url: string;
  left: number;
  top: number;
}

export interface TileLayout {
  zoom: number;
  tiles: Tile[];
  /** Route vertices converted to pixel positions inside the frame. */
  path: Point[];
  originPoint: Point;
  destinationPoint: Point;
}

/** Web Mercator: geographic coordinates → pixel coordinates at a given zoom. */
export function project(point: LatLng, zoom: number): Point {
  const scale = TILE_SIZE * 2 ** zoom;
  // Clamped because the projection sends the poles to infinity.
  const sinLat = Math.min(Math.max(Math.sin((point.lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((point.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

/** Inverse of {@link project}; used in tests and for reasoning about a layout. */
export function unproject(point: Point, zoom: number): LatLng {
  const scale = TILE_SIZE * 2 ** zoom;
  const n = Math.PI * (1 - (2 * point.y) / scale);
  return {
    lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
    lng: (point.x / scale) * 360 - 180,
  };
}

/**
 * Deepest zoom at which `points` fit inside `width × height` pixels.
 *
 * Zoom 0 is the floor: at that point the whole world is on screen and nothing
 * can be made to fit better.
 */
export function fitZoom(points: LatLng[], width: number, height: number): number {
  const northWest = { lat: Math.max(...points.map((p) => p.lat)), lng: Math.min(...points.map((p) => p.lng)) };
  const southEast = { lat: Math.min(...points.map((p) => p.lat)), lng: Math.max(...points.map((p) => p.lng)) };

  for (let zoom = MAX_ZOOM; zoom > 0; zoom -= 1) {
    const a = project(northWest, zoom);
    const b = project(southEast, zoom);
    if (b.x - a.x <= width && b.y - a.y <= height) return zoom;
  }
  return 0;
}

/**
 * Builds the tile grid and pixel path for a route inside a frame.
 *
 * @param padding Pixels kept clear on every edge, so the route never runs into
 *                the frame border or sits under the attribution chip.
 */
export function buildTileLayout(
  points: LatLng[],
  width: number,
  height: number,
  tileUrlTemplate: string,
  padding = 0,
): TileLayout | null {
  if (points.length === 0 || width <= 0 || height <= 0) return null;

  const zoom = fitZoom(points, Math.max(width - padding * 2, 1), Math.max(height - padding * 2, 1));

  const xs = points.map((p) => project(p, zoom).x);
  const ys = points.map((p) => project(p, zoom).y);
  // Top-left corner of the frame, in world pixels at this zoom.
  const originX = (Math.min(...xs) + Math.max(...xs)) / 2 - width / 2;
  const originY = (Math.min(...ys) + Math.max(...ys)) / 2 - height / 2;

  const tilesPerAxis = 2 ** zoom;
  const tiles: Tile[] = [];
  for (let x = Math.floor(originX / TILE_SIZE); x <= Math.floor((originX + width) / TILE_SIZE); x += 1) {
    for (let y = Math.floor(originY / TILE_SIZE); y <= Math.floor((originY + height) / TILE_SIZE); y += 1) {
      // Above the north pole and below the south pole there is no tile to fetch.
      if (y < 0 || y >= tilesPerAxis) continue;
      // Longitude wraps, so a frame crossing the antimeridian reuses tiles.
      const wrappedX = ((x % tilesPerAxis) + tilesPerAxis) % tilesPerAxis;
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        url: tileUrlTemplate
          .replace('{z}', String(zoom))
          .replace('{x}', String(wrappedX))
          .replace('{y}', String(y)),
        left: x * TILE_SIZE - originX,
        top: y * TILE_SIZE - originY,
      });
    }
  }

  const toFrame = (point: LatLng): Point => {
    const projected = project(point, zoom);
    return { x: projected.x - originX, y: projected.y - originY };
  };

  return {
    zoom,
    tiles,
    path: points.map(toFrame),
    originPoint: toFrame(points[0]),
    destinationPoint: toFrame(points[points.length - 1]),
  };
}
