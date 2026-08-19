import { describe, expect, it } from 'vitest';

import { MAX_ZOOM, TILE_SIZE, buildTileLayout, fitZoom, project, unproject } from '@/lib/tileMath';

/**
 * The map preview has no visual test, so the arithmetic behind it is pinned
 * here: a preview centred on the wrong continent, or at a zoom that cuts the
 * route in half, is invisible in a diff and obvious on screen.
 */

const CAIRO = { lat: 30.0444, lng: 31.2357 };
const ALEXANDRIA = { lat: 31.2001, lng: 29.9187 };
const TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** The documented slippy-map tile formula, written independently of lib/tileMath. */
function referenceTile(point: { lat: number; lng: number }, zoom: number) {
  const n = 2 ** zoom;
  const latRad = (point.lat * Math.PI) / 180;
  return {
    x: Math.floor(((point.lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n),
  };
}

describe('web mercator projection', () => {
  it('agrees with the documented slippy-map tile numbers', () => {
    for (const zoom of [1, 8, 12, 16]) {
      for (const point of [CAIRO, ALEXANDRIA, { lat: -33.8688, lng: 151.2093 }]) {
        const projected = project(point, zoom);
        expect(Math.floor(projected.x / TILE_SIZE)).toBe(referenceTile(point, zoom).x);
        expect(Math.floor(projected.y / TILE_SIZE)).toBe(referenceTile(point, zoom).y);
      }
    }
  });

  it('round-trips through unproject', () => {
    const restored = unproject(project(CAIRO, 14), 14);
    expect(restored.lat).toBeCloseTo(CAIRO.lat, 6);
    expect(restored.lng).toBeCloseTo(CAIRO.lng, 6);
  });

  it('puts the prime meridian at the equator in the middle of the world', () => {
    const centre = project({ lat: 0, lng: 0 }, 0);
    expect(centre.x).toBeCloseTo(TILE_SIZE / 2, 6);
    expect(centre.y).toBeCloseTo(TILE_SIZE / 2, 6);
  });
});

describe('fitZoom', () => {
  it('chooses the deepest zoom that still fits the whole route', () => {
    const zoom = fitZoom([CAIRO, ALEXANDRIA], 604, 264);

    const spanAt = (z: number) => {
      const a = project({ lat: Math.max(CAIRO.lat, ALEXANDRIA.lat), lng: Math.min(CAIRO.lng, ALEXANDRIA.lng) }, z);
      const b = project({ lat: Math.min(CAIRO.lat, ALEXANDRIA.lat), lng: Math.max(CAIRO.lng, ALEXANDRIA.lng) }, z);
      return { width: b.x - a.x, height: b.y - a.y };
    };

    expect(spanAt(zoom).width).toBeLessThanOrEqual(604);
    expect(spanAt(zoom).height).toBeLessThanOrEqual(264);
    // One level deeper would overflow the frame — this really is the best fit.
    const deeper = spanAt(zoom + 1);
    expect(deeper.width > 604 || deeper.height > 264).toBe(true);
  });

  it('goes all the way in for two points in the same street', () => {
    expect(fitZoom([CAIRO, { lat: CAIRO.lat + 0.0001, lng: CAIRO.lng }], 604, 264)).toBe(MAX_ZOOM);
  });

  it('falls back to the whole world rather than a negative zoom', () => {
    expect(fitZoom([{ lat: 70, lng: -170 }, { lat: -70, lng: 170 }], 100, 50)).toBe(0);
  });
});

describe('buildTileLayout', () => {
  const layout = buildTileLayout([CAIRO, ALEXANDRIA], 604, 264, TEMPLATE, 18);

  it('covers the frame with tiles', () => {
    expect(layout).not.toBeNull();
    if (!layout) return;

    for (const tile of layout.tiles) {
      // Every tile overlaps the frame; none is fetched needlessly.
      expect(tile.left).toBeGreaterThan(-TILE_SIZE);
      expect(tile.top).toBeGreaterThan(-TILE_SIZE);
      expect(tile.left).toBeLessThan(604);
      expect(tile.top).toBeLessThan(264);
      expect(tile.url).toContain(`/${layout.zoom}/`);
    }

    // The frame is 604×264, so it takes at least a 3×2 grid of 256px tiles.
    expect(layout.tiles.length).toBeGreaterThanOrEqual(6);
    expect(new Set(layout.tiles.map((tile) => tile.key)).size).toBe(layout.tiles.length);
  });

  it('places both endpoints inside the frame, in the right relative positions', () => {
    if (!layout) return;

    for (const point of [layout.originPoint, layout.destinationPoint]) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(604);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(264);
    }

    // Alexandria is north-west of Cairo: smaller x, smaller y (further up).
    expect(layout.destinationPoint.x).toBeLessThan(layout.originPoint.x);
    expect(layout.destinationPoint.y).toBeLessThan(layout.originPoint.y);
  });

  it('keeps the route inside the padding it was given', () => {
    if (!layout) return;

    for (const point of layout.path) {
      expect(point.x).toBeGreaterThanOrEqual(18 - 1);
      expect(point.x).toBeLessThanOrEqual(604 - 18 + 1);
      expect(point.y).toBeGreaterThanOrEqual(18 - 1);
      expect(point.y).toBeLessThanOrEqual(264 - 18 + 1);
    }
  });

  it('never asks for a tile outside the world', () => {
    const polar = buildTileLayout([{ lat: 84, lng: -179.9 }, { lat: 83, lng: 179.9 }], 604, 264, TEMPLATE, 18);
    expect(polar).not.toBeNull();
    if (!polar) return;

    const tilesPerAxis = 2 ** polar.zoom;
    for (const tile of polar.tiles) {
      const [, , x, y] = tile.url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/) ?? [];
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(x)).toBeLessThan(tilesPerAxis);
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThan(tilesPerAxis);
    }
  });

  it('returns null for an empty route or an unmeasured frame', () => {
    expect(buildTileLayout([], 604, 264, TEMPLATE)).toBeNull();
    expect(buildTileLayout([CAIRO], 0, 0, TEMPLATE)).toBeNull();
  });
});
