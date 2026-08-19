'use client';

import type { ExposureSummary } from '@/types';

/**
 * The table view of the same numbers the bar chart shows.
 *
 * Ships alongside the chart on purpose: it is the accessible fallback that makes
 * the data readable without relying on colour or bar length at all.
 */
export function ExposureTable({ summary }: { summary: ExposureSummary }) {
  const rows = [
    {
      direction: 'Front',
      percentage: summary.frontPercentage,
      weighted: summary.frontWeightedIntensity,
      note: 'Windscreen glare; not avoidable by seat side.',
    },
    {
      direction: 'Back',
      percentage: summary.backPercentage,
      weighted: summary.backWeightedIntensity,
      note: 'Sun behind the bus; little direct exposure for passengers.',
    },
    {
      direction: 'Left side',
      percentage: summary.leftPercentage,
      weighted: summary.leftWeightedIntensity,
      note: summary.recommendedSeatSide === 'left' ? 'Recommended seat side.' : 'Windows on this side catch the sun.',
    },
    {
      direction: 'Right side',
      percentage: summary.rightPercentage,
      weighted: summary.rightWeightedIntensity,
      note: summary.recommendedSeatSide === 'right' ? 'Recommended seat side.' : 'Windows on this side catch the sun.',
    },
  ];

  const nightPercentage = Math.max(0, 100 - summary.daylightPercentage);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <caption className="sr-only">Sun exposure by direction for this route</caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-strong)' }}>
            <Th>Direction</Th>
            <Th align="right">% of trip time</Th>
            <Th align="right">Weighted intensity</Th>
            <Th>Notes</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.direction} style={{ borderBottom: '1px solid var(--gridline)' }}>
              <Td>
                <span style={{ color: 'var(--text-primary)' }}>{row.direction}</span>
              </Td>
              <Td align="right" tabular>
                {row.percentage.toFixed(1)}%
              </Td>
              <Td align="right" tabular>
                {row.weighted.toFixed(0)}
              </Td>
              <Td>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {row.note}
                </span>
              </Td>
            </tr>
          ))}
          <tr>
            <Td>
              <span style={{ color: 'var(--text-secondary)' }}>Night / below horizon</span>
            </Td>
            <Td align="right" tabular>
              {nightPercentage.toFixed(1)}%
            </Td>
            <Td align="right" tabular>
              0
            </Td>
            <Td>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Sun below the horizon — no exposure on any side.
              </span>
            </Td>
          </tr>
        </tbody>
      </table>

      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Weighted intensity</strong> is the sum of
        (sun intensity × minutes) for each side, in intensity-minutes. It is what the recommendation is
        based on, because a short burst of harsh overhead sun matters more than a long stretch of dusk
        glow. Percentages exclude night time, so they need not add up to 100.
      </p>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-xs font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
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
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${tabular ? 'tabular' : ''}`}
      style={{ color: 'var(--text-secondary)' }}
    >
      {children}
    </td>
  );
}
