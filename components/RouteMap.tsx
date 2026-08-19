'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { decodePolyline } from '@/lib/polyline';
import { TILE_SIZE, buildTileLayout } from '@/lib/tileMath';
import type { LatLng } from '@/types';

interface RouteMapProps {
  /** Down-sampled encoded polyline (see lib/polyline.ts). */
  previewPolyline: string;
  origin: LatLng;
  destination: LatLng;
  routeName: string;
}

/**
 * Route preview drawn on OpenStreetMap tiles.
 *
 * There is no static-map service and no API key involved: the component works
 * out which OSM tiles cover the route, lays them out in a grid, and draws the
 * path over them in an SVG overlay. Tiles come straight from the browser to
 * `tile.openstreetmap.org`, which is how any Leaflet page fetches them — minus
 * the mapping library, since a fixed preview needs no panning or zooming.
 *
 * The attribution link is not decoration: OSM's tile usage policy requires it
 * wherever the tiles are shown.
 *
 * @see https://operations.osmfoundation.org/policies/tiles/
 */

/** Keeps the route clear of the frame edge and the attribution chip. */
const PADDING = 18;

const TILE_URL_TEMPLATE =
  process.env.NEXT_PUBLIC_TILE_URL_TEMPLATE || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function RouteMap({ previewPolyline, origin, destination, routeName }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // Keyed by tile rather than counted, so a re-layout at a new zoom starts clean
  // without an effect resetting anything.
  const [failedTiles, setFailedTiles] = useState<ReadonlySet<string>>(new Set());

  // The frame is fluid, so the tile grid is rebuilt whenever the width changes.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The endpoints bracket the path: OSRM snaps each one to the nearest road, so
  // the markers sit where the route really starts and ends.
  const points = useMemo<LatLng[]>(() => {
    const decoded = decodePolyline(previewPolyline);
    return decoded.length >= 2 ? decoded : [origin, destination];
  }, [previewPolyline, origin, destination]);

  const layout = useMemo(
    () => (size ? buildTileLayout(points, size.width, size.height, TILE_URL_TEMPLATE, PADDING) : null),
    [points, size],
  );

  const allTilesFailed =
    layout !== null && layout.tiles.length > 0 && layout.tiles.every((tile) => failedTiles.has(tile.key));

  return (
    <div
      ref={containerRef}
      className="relative aspect-[64/30] w-full overflow-hidden rounded-lg border"
      style={{ background: 'var(--surface-sunken)', borderColor: 'var(--border-hairline)' }}
    >
      {layout === null && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          Loading map preview…
        </div>
      )}

      {layout?.tiles.map((tile) => (
        // eslint-disable-next-line @next/next/no-img-element -- third-party tiles at computed positions; next/image cannot optimise or place them
        <img
          key={tile.key}
          src={tile.url}
          alt=""
          aria-hidden="true"
          width={TILE_SIZE}
          height={TILE_SIZE}
          draggable={false}
          onError={() =>
            setFailedTiles((failed) => (failed.has(tile.key) ? failed : new Set(failed).add(tile.key)))
          }
          style={{ position: 'absolute', left: tile.left, top: tile.top, maxWidth: 'none' }}
        />
      ))}

      {layout && size && (
        <svg
          className="absolute inset-0"
          width={size.width}
          height={size.height}
          role="img"
          aria-label={`Map of the ${routeName} from marker A at the start to marker B at the destination`}
        >
          {/* A light halo keeps the route readable over dark or busy map areas. */}
          <polyline
            points={layout.path.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.85}
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={layout.path.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#1d4ed8"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Marker point={layout.originPoint} label="A" color="#15803d" />
          <Marker point={layout.destinationPoint} label="B" color="#b91c1c" />
        </svg>
      )}

      {allTilesFailed && (
        <p
          className="absolute inset-x-0 top-2 mx-auto w-fit rounded-full px-2 py-0.5 text-[11px]"
          style={{ background: 'var(--surface-card)', color: 'var(--text-secondary)' }}
        >
          Map tiles unavailable — showing the route shape only.
        </p>
      )}

      {/* Required by the OpenStreetMap tile usage policy. */}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer noopener"
        className="absolute bottom-0 right-0 rounded-tl px-1.5 py-0.5 text-[10px] underline-offset-2 hover:underline"
        style={{ background: 'var(--surface-card)', color: 'var(--text-muted)' }}
      >
        © OpenStreetMap contributors
      </a>
    </div>
  );
}

/** A pin: filled circle with a white ring and the letter inside. */
function Marker({ point, label, color }: { point: { x: number; y: number }; label: string; color: string }) {
  return (
    <g>
      <circle cx={point.x} cy={point.y} r={9} fill={color} stroke="#ffffff" strokeWidth={2} />
      <text
        x={point.x}
        y={point.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={700}
        fill="#ffffff"
      >
        {label}
      </text>
    </g>
  );
}
