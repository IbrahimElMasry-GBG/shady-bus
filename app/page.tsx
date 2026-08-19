'use client';

import { useState } from 'react';

import { TripForm } from '@/components/TripForm';
import { RouteCard } from '@/components/RouteCard';
import { ErrorBanner, WarningList } from '@/components/ErrorBanner';
import { formatLocalDateTime } from '@/lib/format';
import type {
  AnalyzeErrorResponse,
  AnalyzeResponse,
  AnalyzeSuccessResponse,
  TripInput,
} from '@/types';

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeSuccessResponse | null>(null);
  const [error, setError] = useState<AnalyzeErrorResponse | null>(null);

  async function handleSubmit(input: TripInput) {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as AnalyzeResponse;

      if (data.ok) setResult(data);
      else setError(data);
    } catch {
      setError({
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'Could not reach the server.',
        hint: 'Check that the dev server is still running and try again.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  // Map a typed error code back onto the field that caused it.
  const fieldErrors: Partial<Record<keyof TripInput, string>> = {};
  if (error?.code === 'INVALID_ORIGIN_LINK') fieldErrors.originLink = error.message;
  if (error?.code === 'INVALID_DESTINATION_LINK') fieldErrors.destinationLink = error.message;
  if (error?.code === 'MISSING_DATE') fieldErrors.date = error.message;
  if (error?.code === 'MISSING_TIME') fieldErrors.startTime = error.message;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: 'var(--text-primary)' }}>
          Which side of the bus should I sit on?
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Paste the start and end of your journey as OpenStreetMap or Google Maps links, pick when you are
          travelling, and this works out where the sun will be relative to the bus for every 30 minutes of
          the trip — then tells you which side stays in the shade. Routes, search and map tiles all come
          from OpenStreetMap, so there is nothing to sign up for.
        </p>
      </header>

      <TripForm onSubmit={handleSubmit} isLoading={isLoading} fieldErrors={fieldErrors} />

      {error && !isFieldError(error.code) && (
        <div className="mt-6">
          <ErrorBanner error={error} />
        </div>
      )}

      {result && (
        <section className="mt-10" aria-live="polite">
          <div className="mb-5">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {result.routes.length} route{result.routes.length === 1 ? '' : 's'} analysed
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{result.origin.label}</strong> →{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{result.destination.label}</strong>
            </p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              Departing {formatLocalDateTime(result.departureTimestamp, result.timeZone)} ({result.timeZone}) ·
              sampled every {result.intervalMinutes} minutes
            </p>
          </div>

          {result.warnings.length > 0 && (
            <div className="mb-6">
              <WarningList warnings={result.warnings} />
            </div>
          )}

          <div className="space-y-6">
            {result.routes.map((recommendation, index) => (
              <RouteCard
                key={recommendation.route.id}
                recommendation={recommendation}
                origin={result.origin}
                destination={result.destination}
                isPrimary={index === 0}
              />
            ))}
          </div>

          <Assumptions />
        </section>
      )}
    </main>
  );
}

function isFieldError(code: AnalyzeErrorResponse['code']): boolean {
  return (
    code === 'INVALID_ORIGIN_LINK' ||
    code === 'INVALID_DESTINATION_LINK' ||
    code === 'MISSING_DATE' ||
    code === 'MISSING_TIME'
  );
}

/** Stated plainly under the results, because the model has real blind spots. */
function Assumptions() {
  const items = [
    'Weather, cloud cover, window tint, roadside trees, buildings and tunnels are not considered.',
    'Sun intensity is approximated from solar altitude alone — it is a relative measure, not an irradiance figure.',
    'OSRM’s durations are free-flow estimates with no traffic model, so the bus may be somewhere else than modelled.',
    'The bus heading comes from route geometry, so it assumes the bus faces its direction of travel.',
    'Seat layout, which way seats face, and where the aisle sits are not modelled.',
    'This is directional guidance for comfort — not a safety, health or UV-exposure guarantee.',
  ];

  return (
    <section
      className="mt-8 rounded-xl border p-5"
      style={{ background: 'var(--surface-card)', borderColor: 'var(--border-hairline)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        What this model does not know
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
              •
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
