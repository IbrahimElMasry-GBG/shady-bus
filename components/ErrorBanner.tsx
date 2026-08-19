'use client';

import type { AnalyzeErrorResponse } from '@/types';

/**
 * Renders a typed API failure with the hint that actually unblocks the user.
 *
 * Every banner pairs a colour with an icon and a heading, so meaning is never
 * carried by hue alone.
 */
export function ErrorBanner({ error }: { error: AnalyzeErrorResponse }) {
  // A map-service failure is upstream and usually temporary, so it is framed as
  // a warning rather than as something the user typed wrong.
  const isServiceIssue = error.code === 'MAP_SERVICE_ERROR';

  return (
    <div
      role="alert"
      className="rounded-xl border p-4"
      style={{
        background: 'var(--surface-card)',
        borderColor: isServiceIssue ? 'var(--status-warning)' : 'var(--status-critical)',
      }}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-lg leading-none">
          {isServiceIssue ? '🛰️' : '⚠'}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {titleFor(error.code)}
          </h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {error.message}
          </p>
          {error.hint && (
            <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {error.hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function titleFor(code: AnalyzeErrorResponse['code']): string {
  switch (code) {
    case 'INVALID_ORIGIN_LINK':
      return 'Starting point link could not be read';
    case 'INVALID_DESTINATION_LINK':
      return 'Destination link could not be read';
    case 'COORDINATES_NOT_FOUND':
      return 'Could not find those coordinates';
    case 'NO_ROUTE_FOUND':
      return 'No driving route found';
    case 'INSUFFICIENT_POLYLINE':
      return 'Route data was incomplete';
    case 'MAP_SERVICE_ERROR':
      return 'OpenStreetMap service unavailable';
    case 'MISSING_DATE':
      return 'Trip date missing';
    case 'MISSING_TIME':
      return 'Start time missing';
    default:
      return 'Something went wrong';
  }
}

/** Non-fatal notes: the trip still analysed, but with known limitations. */
export function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: 'var(--surface-card)', borderColor: 'var(--border-hairline)' }}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        <span aria-hidden="true">ℹ️</span> Things worth knowing
      </h3>
      <ul className="mt-2 space-y-1.5">
        {warnings.map((warning) => (
          <li key={warning} className="flex gap-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
              •
            </span>
            <span>{warning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
