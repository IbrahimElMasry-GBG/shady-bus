'use client';

import { useState } from 'react';
import type { RouteSample } from '@/types';
import { compassPoint, directionLabel } from '@/lib/format';
import { describeIntensity } from '@/lib/sunPosition';

const COLLAPSED_ROWS = 8;

/**
 * Per-interval breakdown — the audit trail behind the recommendation.
 *
 * Long trips produce a lot of rows, so it collapses to the first few with an
 * explicit "show all" rather than silently truncating.
 */
export function IntervalTable({ samples }: { samples: RouteSample[] }) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? samples : samples.slice(0, COLLAPSED_ROWS);
  const hidden = samples.length - visible.length;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Bus position and sun geometry at each sampled interval along this route
          </caption>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-strong)' }}>
              <Th>Time</Th>
              <Th>Approx. location</Th>
              <Th align="right">Bus heading</Th>
              <Th align="right">Sun azimuth</Th>
              <Th align="right">Sun altitude</Th>
              <Th align="right">Relative angle</Th>
              <Th>Exposed side</Th>
              <Th align="right">Intensity</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((sample) => (
              <tr key={sample.timestamp} style={{ borderBottom: '1px solid var(--gridline)' }}>
                <Td tabular>{sample.localTimeLabel}</Td>
                <Td tabular>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {sample.latitude.toFixed(3)}, {sample.longitude.toFixed(3)}
                  </span>
                </Td>
                <Td align="right" tabular>
                  {sample.busHeadingDegrees.toFixed(0)}° {compassPoint(sample.busHeadingDegrees)}
                </Td>
                <Td align="right" tabular>
                  {sample.sunAzimuthDegrees.toFixed(0)}° {compassPoint(sample.sunAzimuthDegrees)}
                </Td>
                <Td align="right" tabular>
                  {sample.sunAltitudeDegrees.toFixed(1)}°
                </Td>
                <Td align="right" tabular>
                  {/* Sign convention: + = sun to the bus's right, − = to its left. */}
                  {sample.relativeSunAngleDegrees > 0 ? '+' : ''}
                  {sample.relativeSunAngleDegrees.toFixed(0)}°
                </Td>
                <Td>
                  <span
                    style={{
                      color:
                        sample.exposedDirection === 'none'
                          ? 'var(--text-muted)'
                          : 'var(--text-primary)',
                    }}
                  >
                    {sample.exposedDirection === 'none' ? '— night' : directionLabel(sample.exposedDirection)}
                  </span>
                </Td>
                <Td align="right" tabular>
                  {sample.sunIntensity.toFixed(0)}
                  <span className="ml-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {describeIntensity(sample.sunIntensity)}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--border-hairline)', color: 'var(--text-secondary)' }}
        >
          Show all {samples.length} intervals ({hidden} more)
        </button>
      )}
      {expanded && samples.length > COLLAPSED_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--border-hairline)', color: 'var(--text-secondary)' }}
        >
          Show fewer
        </button>
      )}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 text-xs font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  tabular = false,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  tabular?: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${
        tabular ? 'tabular' : ''
      }`}
      style={{ color: 'var(--text-secondary)' }}
    >
      {children}
    </td>
  );
}
