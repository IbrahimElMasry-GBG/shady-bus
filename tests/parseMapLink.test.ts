import { describe, expect, it } from 'vitest';

import { decodeOsmShortLink, isValidLatLng, parseMapLink, parseRawCoordinates } from '@/lib/parseMapLink';

describe('coordinate validation', () => {
  it('accepts real coordinates', () => {
    expect(isValidLatLng(30.0444, 31.2357)).toBe(true);
    expect(isValidLatLng(-33.87, 151.2)).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(Number.NaN, 0)).toBe(false);
  });

  it('rejects 0,0, which is almost always a parsing artefact', () => {
    expect(isValidLatLng(0, 0)).toBe(false);
  });
});

describe('raw coordinate input', () => {
  it('accepts "lat, lng" with or without a space', () => {
    expect(parseRawCoordinates('30.0444, 31.2357')).toEqual({ lat: 30.0444, lng: 31.2357 });
    expect(parseRawCoordinates('30.0444,31.2357')).toEqual({ lat: 30.0444, lng: 31.2357 });
  });

  it('accepts negatives', () => {
    expect(parseRawCoordinates('-33.8688,151.2093')).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it('rejects anything else', () => {
    expect(parseRawCoordinates('Cairo')).toBeNull();
    expect(parseRawCoordinates('30.0444')).toBeNull();
    expect(parseRawCoordinates('')).toBeNull();
  });
});

describe('OpenStreetMap link parsing', () => {
  it('prefers the ?mlat/?mlon marker over the #map viewport centre', () => {
    // The marker and the viewport centre deliberately differ here.
    const parsed = parseMapLink(
      'https://www.openstreetmap.org/?mlat=30.0459&mlon=31.2243#map=15/30.0500/31.2000',
    );

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lat).toBeCloseTo(30.0459, 4);
    expect(parsed.lng).toBeCloseTo(31.2243, 4);
  });

  it('reads the #map=zoom/lat/lng viewport centre', () => {
    const parsed = parseMapLink('https://www.openstreetmap.org/#map=12/30.0444/31.2357');

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lat).toBeCloseTo(30.0444, 4);
    expect(parsed.lng).toBeCloseTo(31.2357, 4);
  });

  it('reads a fractional zoom in the hash', () => {
    const parsed = parseMapLink('https://www.openstreetmap.org/#map=12.5/31.2001/29.9187');

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lng).toBeCloseTo(29.9187, 4);
  });

  it('reads the "from" endpoint of a directions link', () => {
    const parsed = parseMapLink(
      'https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=30.0444%2C31.2357%3B31.2001%2C29.9187&from=30.0444%2C31.2357&to=31.2001%2C29.9187',
    );

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lat).toBeCloseTo(30.0444, 4);
  });

  it('returns an object reference for /node, /way and /relation links', () => {
    const node = parseMapLink('https://www.openstreetmap.org/node/1234567');
    expect(node.kind).toBe('osm-object');
    if (node.kind !== 'osm-object') return;
    expect(node.osmType).toBe('node');
    expect(node.osmId).toBe('1234567');

    const way = parseMapLink('https://www.openstreetmap.org/way/767933342#map=19/30.04601/31.22431');
    expect(way.kind).toBe('osm-object');
    if (way.kind !== 'osm-object') return;
    expect(way.osmType).toBe('way');

    expect(parseMapLink('https://www.openstreetmap.org/relation/5466227').kind).toBe('osm-object');
  });

  it('returns a query for a named search link', () => {
    const parsed = parseMapLink('https://www.openstreetmap.org/search?query=Cairo+Tower');

    expect(parsed.kind).toBe('query');
    if (parsed.kind !== 'query') return;
    expect(parsed.query).toBe('Cairo Tower');
  });

  it('accepts the osm.org host and a link without a scheme', () => {
    expect(parseMapLink('osm.org/#map=10/31.20/29.92').kind).toBe('coords');
  });
});

describe('OpenStreetMap shortlink decoding', () => {
  // Ground truth from the OSM wiki: https://osm.org/go/0EEQjE-- is documented as
  // the same view as https://www.openstreetmap.org/#map=9/51.5110/0.0550.
  it('decodes the documented example', () => {
    const decoded = decodeOsmShortLink('0EEQjE--');

    expect(decoded).not.toBeNull();
    if (!decoded) return;
    // Six position characters address a cell roughly 0.0007° tall and 0.0014°
    // wide, so the decoded centre legitimately sits up to half a cell from the
    // coordinates the wiki quotes — about 40 m. Deeper links are far tighter.
    expect(Math.abs(decoded.lat - 51.511)).toBeLessThan(0.0004);
    expect(Math.abs(decoded.lng - 0.055)).toBeLessThan(0.0007);
  });

  it('gets more precise as the code gets longer, without moving', () => {
    // Same area, zoomed in — the wiki notes the common prefix.
    const decoded = decodeOsmShortLink('0EEQjEEb');

    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.lat).toBeCloseTo(51.511, 4);
    expect(decoded.lng).toBeCloseTo(0.055, 4);
  });

  it('decodes a shortlink pasted as a URL', () => {
    const parsed = parseMapLink('https://osm.org/go/0EEQjE--?m=');

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(Math.abs(parsed.lat - 51.511)).toBeLessThan(0.0004);
    expect(Math.abs(parsed.lng - 0.055)).toBeLessThan(0.0007);
  });

  it('returns null for a code with no position bits', () => {
    expect(decodeOsmShortLink('---')).toBeNull();
  });
});

describe('Google Maps link parsing', () => {
  it('prefers the pinned marker (!3d/!4d) over the viewport centre', () => {
    // The @ centre and the !3d/!4d marker deliberately differ here.
    const link =
      'https://www.google.com/maps/place/Cairo+Tower/@30.0500,31.2000,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d30.0459!4d31.2243';
    const parsed = parseMapLink(link);

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lat).toBeCloseTo(30.0459, 4);
    expect(parsed.lng).toBeCloseTo(31.2243, 4);
    expect(parsed.label).toBe('Cairo Tower');
  });

  it('falls back to the @lat,lng viewport centre', () => {
    const parsed = parseMapLink('https://www.google.com/maps/@30.0444,31.2357,14z');

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lat).toBeCloseTo(30.0444, 4);
    expect(parsed.lng).toBeCloseTo(31.2357, 4);
  });

  it('reads coordinates from a ?q= parameter', () => {
    const parsed = parseMapLink('https://maps.google.com/?q=31.2001,29.9187');

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lat).toBeCloseTo(31.2001, 4);
  });

  it('reads coordinates from the Maps URL API destination parameter', () => {
    const parsed = parseMapLink('https://www.google.com/maps/dir/?api=1&destination=31.2001,29.9187');

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lng).toBeCloseTo(29.9187, 4);
  });

  it('returns a query when only a place name is present', () => {
    const parsed = parseMapLink('https://www.google.com/maps/place/Alexandria+Library/');

    expect(parsed.kind).toBe('query');
    if (parsed.kind !== 'query') return;
    expect(parsed.query).toBe('Alexandria Library');
  });

  it('returns a query for a named ?q= parameter', () => {
    const parsed = parseMapLink('https://maps.google.com/?q=Cairo+International+Airport');

    expect(parsed.kind).toBe('query');
    if (parsed.kind !== 'query') return;
    expect(parsed.query).toBe('Cairo International Airport');
  });

  it('flags Google short links as needing server-side expansion', () => {
    expect(parseMapLink('https://maps.app.goo.gl/abc123XYZ').kind).toBe('short-link');
    expect(parseMapLink('https://goo.gl/maps/abc123').kind).toBe('short-link');
  });

  it('handles URL-encoded place names', () => {
    const parsed = parseMapLink('https://www.google.com/maps/place/Giza%20Pyramids/');

    expect(parsed.kind).toBe('query');
    if (parsed.kind !== 'query') return;
    expect(parsed.query).toBe('Giza Pyramids');
  });

  it('accepts a link without a scheme', () => {
    expect(parseMapLink('www.google.com/maps/@30.0444,31.2357,14z').kind).toBe('coords');
  });

  it('does not trust !3d/!4d when a /dir/ link has several waypoints', () => {
    // Multiple marker pairs on a directions link: the first is not necessarily
    // the endpoint we want, so we must not silently pick it.
    const link =
      'https://www.google.com/maps/dir/A/B/@30.05,31.2,12z/data=!3d30.1!4d31.3!3d31.2!4d29.9';
    const parsed = parseMapLink(link);

    // Falls through to the @ centre rather than guessing a waypoint.
    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lat).toBeCloseTo(30.05, 3);
  });
});

describe('other input shapes', () => {
  it('accepts a bare coordinate pair pasted directly', () => {
    const parsed = parseMapLink('30.0444, 31.2357');

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lat).toBeCloseTo(30.0444, 4);
  });

  it('accepts a geo: URI from a phone share sheet', () => {
    const parsed = parseMapLink('geo:30.0444,31.2357?z=15');

    expect(parsed.kind).toBe('coords');
    if (parsed.kind !== 'coords') return;
    expect(parsed.lng).toBeCloseTo(31.2357, 4);
  });

  it('rejects an empty input with a readable reason', () => {
    const parsed = parseMapLink('   ');
    expect(parsed.kind).toBe('unknown');
    if (parsed.kind !== 'unknown') return;
    expect(parsed.reason).toMatch(/empty/i);
  });

  it('rejects an unrelated host', () => {
    const parsed = parseMapLink('https://example.com/maps/@30.04,31.23');

    expect(parsed.kind).toBe('unknown');
    if (parsed.kind !== 'unknown') return;
    expect(parsed.reason).toMatch(/not an OpenStreetMap or Google Maps domain/i);
  });

  it('rejects plain text that is not a URL', () => {
    expect(parseMapLink('somewhere near the station').kind).toBe('unknown');
  });
});
