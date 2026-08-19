import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeRoutes, geocodePlace, resolvePlaceFromLink } from '@/lib/osm';
import { AppError } from '@/lib/errors';
import { decodePolyline, encodePolyline } from '@/lib/polyline';

/**
 * Unit tests for the OSM service layer with `fetch` stubbed out.
 *
 * The point of these is not to check that OSRM and Nominatim work — it is to
 * pin the two places where a mistake would be silent rather than loud:
 *
 *  1. OSRM takes `longitude,latitude`, the reverse of every other coordinate in
 *     this codebase. Swapping them returns a real route through the wrong part
 *     of the world, with no error anywhere.
 *  2. Nominatim returns `lat`/`lon` as *strings*. Using them unconverted makes
 *     every downstream calculation NaN.
 */

const CAIRO = { lat: 30.0444, lng: 31.2357 };
const ALEXANDRIA = { lat: 31.2001, lng: 29.9187 };

/** Cairo → Alexandria as a straight line, standing in for real route geometry. */
const GEOMETRY = encodePolyline(
  Array.from({ length: 500 }, (_, i) => ({
    lat: CAIRO.lat + ((ALEXANDRIA.lat - CAIRO.lat) * i) / 499,
    lng: CAIRO.lng + ((ALEXANDRIA.lng - CAIRO.lng) * i) / 499,
  })),
);

const OSRM_OK = {
  code: 'Ok',
  routes: [
    {
      distance: 218285.9,
      duration: 8552.3,
      geometry: GEOMETRY,
      legs: [
        {
          summary: 'Cairo–Alexandria Desert Road',
          steps: [
            { distance: 156.4, duration: 12.5, name: 'Tahrir Square' },
            { distance: 218_129.5, duration: 8539.8, name: 'Desert Road' },
          ],
        },
      ],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The URL passed to the mocked fetch, as a string. */
const requestedUrl = (call: number): string => String(fetchMock.mock.calls[call][0]);

describe('computeRoutes', () => {
  it('sends coordinates to OSRM as longitude,latitude', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OSRM_OK));

    await computeRoutes(CAIRO, ALEXANDRIA);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestedUrl(0);
    expect(url).toContain('/route/v1/driving/31.2357,30.0444;29.9187,31.2001');
    // Guard against the reversed form ever creeping back in.
    expect(url).not.toContain('30.0444,31.2357;');
  });

  it('requests full precision-5 geometry and step timings', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OSRM_OK));

    await computeRoutes(CAIRO, ALEXANDRIA);

    const url = requestedUrl(0);
    expect(url).toContain('geometries=polyline');
    expect(url).toContain('overview=full');
    expect(url).toContain('steps=true');
    expect(url).toContain('alternatives=3');
  });

  it('identifies the app to the demo server', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OSRM_OK));

    await computeRoutes(CAIRO, ALEXANDRIA);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBeTruthy();
  });

  it('maps an OSRM route onto the domain model', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OSRM_OK));

    const { routes } = await computeRoutes(CAIRO, ALEXANDRIA);

    expect(routes).toHaveLength(1);
    const [route] = routes;
    expect(route.id).toBe('route-0');
    expect(route.name).toBe('Primary route');
    expect(route.summary).toBe('Cairo–Alexandria Desert Road');
    expect(route.distanceMeters).toBe(218_286);
    expect(route.durationSeconds).toBe(8552);
    expect(route.steps).toEqual([
      { distanceMeters: 156.4, durationSeconds: 12.5 },
      { distanceMeters: 218_129.5, durationSeconds: 8539.8 },
    ]);
  });

  it('keeps the route shape while thinning the preview polyline', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OSRM_OK));

    const { routes } = await computeRoutes(CAIRO, ALEXANDRIA);
    const preview = decodePolyline(routes[0].previewPolyline);

    expect(preview.length).toBeLessThanOrEqual(400);
    expect(preview[0].lat).toBeCloseTo(CAIRO.lat, 4);
    expect(preview[preview.length - 1].lat).toBeCloseTo(ALEXANDRIA.lat, 4);
  });

  it('says plainly that the durations carry no traffic information', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OSRM_OK));

    const { warnings } = await computeRoutes(CAIRO, ALEXANDRIA);

    expect(warnings.some((warning) => /no live traffic/i.test(warning))).toBe(true);
  });

  it('names the alternatives after the fastest route', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'Ok', routes: [OSRM_OK.routes[0], OSRM_OK.routes[0]] }),
    );

    const { routes, warnings } = await computeRoutes(CAIRO, ALEXANDRIA);

    expect(routes.map((route) => route.name)).toEqual(['Primary route', 'Alternate route 1']);
    expect(warnings.some((warning) => /no alternative route/i.test(warning))).toBe(false);
  });

  it('translates NoRoute into a readable failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'NoRoute', message: 'No route found' }, 400));

    await expect(computeRoutes(CAIRO, ALEXANDRIA)).rejects.toMatchObject({ code: 'NO_ROUTE_FOUND' });
  });

  it('explains NoSegment as a pin that is not on a road', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'NoSegment' }, 400));

    await expect(computeRoutes(CAIRO, ALEXANDRIA)).rejects.toMatchObject({
      code: 'NO_ROUTE_FOUND',
      hint: expect.stringContaining('street'),
    });
  });

  it('reports an unreachable router as a service error, not a bad link', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(computeRoutes(CAIRO, ALEXANDRIA)).rejects.toMatchObject({
      code: 'MAP_SERVICE_ERROR',
      status: 502,
    });
  });

  it('rejects routes with no usable geometry', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'Ok', routes: [{ distance: 1, duration: 1 }] }));

    await expect(computeRoutes(CAIRO, ALEXANDRIA)).rejects.toMatchObject({
      code: 'INSUFFICIENT_POLYLINE',
    });
  });
});

describe('geocodePlace', () => {
  it('converts Nominatim string coordinates into numbers', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          lat: '30.0460136',
          lon: '31.2243131',
          display_name: 'Cairo Tower, Al Borg Street, Gezira, Cairo, Egypt',
        },
      ]),
    );

    const place = await geocodePlace('Cairo Tower');

    expect(place.lat).toBeCloseTo(30.046, 4);
    expect(place.lng).toBeCloseTo(31.2243, 4);
    expect(place.label).toContain('Cairo Tower');
    expect(place.source).toBe('geocoded');
  });

  it('reports an empty result as "not found", not as a service failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await expect(geocodePlace('Nowhere at all')).rejects.toMatchObject({
      code: 'COORDINATES_NOT_FOUND',
    });
  });

  it('turns a 403 into advice about the User-Agent policy', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 403));

    const error = await geocodePlace('Cairo').catch((caught: AppError) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'MAP_SERVICE_ERROR' });
    expect((error as AppError).hint).toMatch(/User-Agent/i);
  });
});

describe('resolvePlaceFromLink', () => {
  it('reads coordinates out of an OSM link without any network call', async () => {
    const place = await resolvePlaceFromLink(
      'https://www.openstreetmap.org/?mlat=30.0444&mlon=31.2357#map=15/30.0444/31.2357',
      'origin',
    );

    expect(place.lat).toBeCloseTo(30.0444, 4);
    expect(place.source).toBe('url-coordinates');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('looks up an OSM object link through Nominatim', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ lat: '30.0460136', lon: '31.2243131', display_name: 'Cairo Tower' }]),
    );

    const place = await resolvePlaceFromLink('https://www.openstreetmap.org/way/767933342', 'destination');

    expect(requestedUrl(0)).toContain('/lookup');
    expect(requestedUrl(0)).toContain('osm_ids=W767933342');
    expect(place.label).toBe('Cairo Tower');
  });

  it('blames the right field when a link cannot be parsed', async () => {
    await expect(resolvePlaceFromLink('not a link at all', 'destination')).rejects.toMatchObject({
      code: 'INVALID_DESTINATION_LINK',
    });
  });
});
