'use client';

import { useState } from 'react';
import type { LatLng, RouteRecommendation } from '@/types';
import { formatDistance, formatDuration } from '@/lib/format';
import { ExposureChart } from './ExposureChart';
import { ExposureTable } from './ExposureTable';
import { IntervalTable } from './IntervalTable';
import { RouteMap } from './RouteMap';

interface RouteCardProps {
  recommendation: RouteRecommendation;
  origin: LatLng;
  destination: LatLng;
  /** Marks the fastest route, which OSRM returns first. */
  isPrimary: boolean;
}

export function RouteCard({ recommendation, origin, destination, isPrimary }: RouteCardProps) {
  const { route, summary, samples } = recommendation;
  const [showIntervals, setShowIntervals] = useState(false);

  return (
    <article
      className="overflow-hidden rounded-xl border"
      style={{ background: 'var(--surface-card)', borderColor: 'var(--border-hairline)' }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {route.name}
            </h3>
            {isPrimary && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}
              >
                Fastest
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            via {route.summary}
          </p>
        </div>

        <dl className="flex gap-5 text-right">
          <div>
            <dt className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Distance
            </dt>
            <dd className="tabular text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {formatDistance(route.distanceMeters)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Duration
            </dt>
            <dd className="tabular text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {formatDuration(route.durationSeconds)}
            </dd>
          </div>
        </dl>
      </header>

      <div className="px-5">
        <RouteMap
          previewPolyline={route.previewPolyline}
          origin={origin}
          destination={destination}
          routeName={route.name}
        />
      </div>

      {/* ---- The headline answer ---- */}
      <div className="p-5">
        <RecommendationBanner
          seatSide={summary.recommendedSeatSide}
          confidence={summary.confidence}
          explanation={summary.explanation}
        />

        {summary.caveats.length > 0 && (
          <ul className="mt-3 space-y-1">
            {summary.caveats.map((caveat) => (
              <li
                key={caveat}
                className="flex gap-2 text-xs leading-relaxed"
                style={{ color: 'var(--text-muted)' }}
              >
                <span aria-hidden="true">⚠</span>
                <span>{caveat}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t px-5 py-5" style={{ borderColor: 'var(--border-hairline)' }}>
        <ExposureChart summary={summary} />
      </div>

      <div className="border-t px-5 py-5" style={{ borderColor: 'var(--border-hairline)' }}>
        <h4 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Exposure summary
        </h4>
        <ExposureTable summary={summary} />
      </div>

      <div className="border-t px-5 py-5" style={{ borderColor: 'var(--border-hairline)' }}>
        <button
          type="button"
          onClick={() => setShowIntervals((open) => !open)}
          aria-expanded={showIntervals}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Interval breakdown
            <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
              {samples.length} sample{samples.length === 1 ? '' : 's'}
            </span>
          </span>
          <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
            {showIntervals ? '▲' : '▼'}
          </span>
        </button>

        {showIntervals && (
          <div className="mt-4">
            <IntervalTable samples={samples} />
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * The recommendation banner.
 *
 * Green means "sit here", but it always ships with a ✓ icon and the words
 * "Sit on the … side", so the meaning survives for a colourblind reader and in
 * forced-colors mode.
 */
function RecommendationBanner({
  seatSide,
  confidence,
  explanation,
}: {
  seatSide: 'left' | 'right' | 'either';
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
}) {
  const isDecisive = seatSide !== 'either';

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        background: 'var(--surface-sunken)',
        borderColor: isDecisive ? 'var(--status-good)' : 'var(--border-hairline)',
      }}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 text-lg leading-none">
          {isDecisive ? '✅' : '🪑'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {isDecisive ? `Sit on the ${seatSide} side` : 'Either side is fine'}
            </p>
            <ConfidencePill level={confidence} />
          </div>
          <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {explanation}
          </p>
        </div>
      </div>
    </div>
  );
}

function ConfidencePill({ level }: { level: 'high' | 'medium' | 'low' }) {
  // Dots + word: confidence is never encoded by colour alone.
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: 'var(--surface-card)', color: 'var(--text-secondary)' }}
      title={`Confidence: ${level}`}
    >
      <span aria-hidden="true" className="tracking-tight">
        {'●'.repeat(filled)}
        <span style={{ opacity: 0.25 }}>{'●'.repeat(3 - filled)}</span>
      </span>
      {level} confidence
    </span>
  );
}
