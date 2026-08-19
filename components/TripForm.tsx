'use client';

import { useState } from 'react';
import type { TripInput } from '@/types';

interface TripFormProps {
  onSubmit: (input: TripInput) => void;
  isLoading: boolean;
  /** Field-level messages keyed by input name, set from the API's error code. */
  fieldErrors?: Partial<Record<keyof TripInput, string>>;
}

/** Today's date as `YYYY-MM-DD` in the *browser's* zone, for the default value. */
function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function TripForm({ onSubmit, isLoading, fieldErrors = {} }: TripFormProps) {
  const [originLink, setOriginLink] = useState('');
  const [destinationLink, setDestinationLink] = useState('');
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('08:00');

  // Client-side validation mirrors the server's, so obvious mistakes never cost
  // a round trip. The server still re-validates — this is convenience, not trust.
  const [localErrors, setLocalErrors] = useState<Partial<Record<keyof TripInput, string>>>({});

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const errors: Partial<Record<keyof TripInput, string>> = {};
    if (!originLink.trim()) errors.originLink = 'Paste a map link for the starting point.';
    if (!destinationLink.trim()) errors.destinationLink = 'Paste a map link for the destination.';
    if (!date) errors.date = 'Choose a trip date.';
    if (!startTime) errors.startTime = 'Choose a start time.';

    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) return;

    onSubmit({ originLink: originLink.trim(), destinationLink: destinationLink.trim(), date, startTime });
  }

  const errorFor = (field: keyof TripInput) => localErrors[field] ?? fieldErrors[field];

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border p-5 sm:p-6"
      style={{ background: 'var(--surface-card)', borderColor: 'var(--border-hairline)' }}
      noValidate
    >
      <div className="grid gap-5">
        <Field
          label="Starting point"
          hint="OpenStreetMap or Google Maps share link, or “latitude, longitude”"
          error={errorFor('originLink')}
          htmlFor="originLink"
        >
          <input
            id="originLink"
            name="originLink"
            type="text"
            inputMode="url"
            autoComplete="off"
            value={originLink}
            onChange={(e) => setOriginLink(e.target.value)}
            placeholder="https://www.openstreetmap.org/#map=15/30.0444/31.2357"
            className={inputClass(Boolean(errorFor('originLink')))}
            style={inputStyle}
          />
        </Field>

        <Field
          label="Destination"
          hint="OpenStreetMap or Google Maps share link, or “latitude, longitude”"
          error={errorFor('destinationLink')}
          htmlFor="destinationLink"
        >
          <input
            id="destinationLink"
            name="destinationLink"
            type="text"
            inputMode="url"
            autoComplete="off"
            value={destinationLink}
            onChange={(e) => setDestinationLink(e.target.value)}
            placeholder="https://osm.org/go/… or 31.2001, 29.9187"
            className={inputClass(Boolean(errorFor('destinationLink')))}
            style={inputStyle}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Trip date" error={errorFor('date')} htmlFor="date">
            <input
              id="date"
              name="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass(Boolean(errorFor('date')))}
              style={inputStyle}
            />
          </Field>

          <Field
            label="Start time"
            hint="Local time at the starting point"
            error={errorFor('startTime')}
            htmlFor="startTime"
          >
            <input
              id="startTime"
              name="startTime"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass(Boolean(errorFor('startTime')))}
              style={inputStyle}
            />
          </Field>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
        >
          {isLoading ? (
            <>
              <Spinner />
              Analysing routes…
            </>
          ) : (
            'Find the shady side'
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {label}
      </label>
      {hint && (
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      )}
      <div className="mt-2">{children}</div>
      {error && (
        // Icon + text, so the error never depends on colour alone.
        <p className="mt-1.5 flex items-start gap-1.5 text-xs" style={{ color: 'var(--status-critical)' }}>
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-sunken)',
  color: 'var(--text-primary)',
};

function inputClass(hasError: boolean): string {
  return [
    'w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors',
    'focus:ring-2 focus:ring-offset-0',
    hasError ? 'border-[color:var(--status-critical)]' : 'border-[color:var(--border-hairline)]',
    'focus:border-[color:var(--accent)] focus:ring-[color:var(--accent)]/30',
  ].join(' ');
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
