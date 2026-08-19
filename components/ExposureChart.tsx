'use client';

import { useState } from 'react';
import type { ExposureSummary } from '@/types';

type Measure = 'time' | 'weighted';

/**
 * Sun exposure per side of the bus.
 *
 * Form: a horizontal bar chart. The data's job is **magnitude comparison across
 * four named categories**, and the category names are words ("Right side"), so
 * horizontal bars avoid rotated axis labels entirely.
 *
 * Colour: this is a single-series chart — one measure across four categories —
 * so all bars share one hue rather than being needlessly rainbowed. The single
 * exception is the most-exposed side, drawn in the alert colour and carrying a
 * "☀ most sun" text label, so the highlight is never colour-alone. That
 * two-colour pair (`--series-1`, `--mark-alert`) was validated for colourblind
 * separation against both the light and dark chart surfaces.
 *
 * The recommended-seat badge uses green, but it lives outside this chart and
 * always ships with a ✓ icon and text, because green↔red is precisely the pair
 * a red-green colourblind reader cannot separate.
 */
export function ExposureChart({ summary }: { summary: ExposureSummary }) {
  const [measure, setMeasure] = useState<Measure>('time');

  const rows = [
    {
      key: 'front',
      label: 'Front',
      time: summary.frontPercentage,
      weighted: summary.frontWeightedIntensity,
    },
    {
      key: 'back',
      label: 'Back',
      time: summary.backPercentage,
      weighted: summary.backWeightedIntensity,
    },
    {
      key: 'left',
      label: 'Left side',
      time: summary.leftPercentage,
      weighted: summary.leftWeightedIntensity,
    },
    {
      key: 'right',
      label: 'Right side',
      time: summary.rightPercentage,
      weighted: summary.rightWeightedIntensity,
    },
  ];

  const values = rows.map((row) => (measure === 'time' ? row.time : row.weighted));
  const max = Math.max(...values, measure === 'time' ? 1 : 0.0001);
  const peak = Math.max(...values);
  // Only call something "the sunniest side" when there is real sun to speak of.
  const hasExposure = peak > 0.5;

  return (
    <figure className="m-0">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Sun exposure by side of the bus
          </h4>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {measure === 'time'
              ? 'Share of total trip time each side is in sunlight'
              : 'Intensity-weighted exposure (intensity × minutes)'}
          </p>
        </div>

        <div
          className="inline-flex rounded-lg border p-0.5 text-xs"
          style={{ borderColor: 'var(--border-hairline)', background: 'var(--surface-sunken)' }}
          role="group"
          aria-label="Choose which measure the bars show"
        >
          <MeasureButton active={measure === 'time'} onClick={() => setMeasure('time')}>
            % of time
          </MeasureButton>
          <MeasureButton active={measure === 'weighted'} onClick={() => setMeasure('weighted')}>
            Weighted
          </MeasureButton>
        </div>
      </figcaption>

      <div className="space-y-2.5">
        {rows.map((row) => {
          const value = measure === 'time' ? row.time : row.weighted;
          const isPeak = hasExposure && value === peak;
          // Bars are drawn from the baseline; a hair of width keeps zero visible.
          const widthPercent = max > 0 ? Math.max((value / max) * 100, value > 0 ? 1.5 : 0) : 0;

          return (
            <div key={row.key} className="group grid grid-cols-[5.5rem_1fr] items-center gap-3">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {row.label}
              </span>

              <div className="relative flex items-center gap-2">
                <div
                  className="relative h-5 flex-1 overflow-hidden rounded-[3px]"
                  style={{ background: 'var(--gridline)' }}
                  title={`${row.label}: ${row.time.toFixed(1)}% of trip time · ${row.weighted.toFixed(0)} intensity-minutes`}
                >
                  <div
                    className="h-full rounded-r-[4px] transition-[width] duration-500"
                    style={{
                      width: `${widthPercent}%`,
                      background: isPeak ? 'var(--mark-alert)' : 'var(--series-1)',
                    }}
                  />
                </div>

                {/* Direct value label — only four marks, so labelling each is legible. */}
                <span
                  className="tabular w-24 shrink-0 text-right text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {measure === 'time' ? `${value.toFixed(0)}%` : value.toFixed(0)}
                  {isPeak && (
                    <span className="ml-1 whitespace-nowrap" style={{ color: 'var(--mark-alert)' }}>
                      ☀ most
                    </span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {!hasExposure && (
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          No side receives meaningful sun on this trip.
        </p>
      )}
    </figure>
  );
}

function MeasureButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-[6px] px-2.5 py-1 font-medium transition-colors"
      style={{
        background: active ? 'var(--surface-card)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
      }}
    >
      {children}
    </button>
  );
}
