# Bus Sun-Side Advisor

Tells you which side of a bus to sit on to stay out of the sun.

Paste a map link for where you're starting and where you're going, pick the date and
departure time, and the app fetches the real driving routes, walks the bus along each
one in 30-minute steps, works out where the sun is at each step, and reports which
side of the vehicle takes the heat — and therefore which side you should sit on.

It runs entirely on OpenStreetMap's open services: **no API key, no billing account,
no sign-up.** Clone it, `npm install`, run it. OpenStreetMap and Google Maps links
are both accepted as input: no keyed or billed Google API is ever called, and the
only remaining contact with Google is following a `maps.app.goo.gl` redirect to see
where a share link points — which needs no key either.

---

## Contents

1. [Architecture and implementation plan](#1-architecture-and-implementation-plan)
2. [Environment variables](#2-environment-variables)
3. [Setup and run](#3-setup-and-run)
4. [Deploying it for free](#4-deploying-it-for-free)
5. [The sun direction and intensity algorithm](#5-the-sun-direction-and-intensity-algorithm)
6. [Example scenario](#6-example-scenario)
7. [Assumptions and limitations](#7-assumptions-and-limitations)
8. [Future improvements](#8-future-improvements)

---

## 1. Architecture and implementation plan

### Stack

Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · Next.js Route
Handlers for the backend. Three choices inside that stack are worth stating:

- **OSRM** (`router.project-osrm.org`) for routing, rather than a keyed commercial
  API. It returns the same things the analysis needs — geometry as a precision-5
  encoded polyline, distance, duration, alternatives and step-level timings — for
  free and without an account. What it does *not* have is a traffic model; the app
  says so in the results rather than quietly presenting free-flow times as live ones.
- **Nominatim** for geocoding, used only when a link carries a name instead of
  coordinates. Also free; its usage policy is the constraint, not a bill.
- **Raster OSM tiles composed in the browser**, rather than a static-map service.
  There is no static-map equivalent in the free stack, so `RouteMap` works out which
  tiles cover the route, lays them out in a grid, and draws the path over them in an
  SVG overlay — which is what a mapping library would do, minus the library, since a
  fixed preview needs no panning or zooming.

### Shape of the system

```
Browser (client components)
    │  POST /api/analyze  { originLink, destinationLink, date, startTime }
    ▼
Route handler  ── resolve links ──► Nominatim   (only if a link has no coordinates)
    │          ── compute routes ─► OSRM
    │
    ├─ sampleRoute()        walk the bus along the polyline every 30 min
    ├─ getSunPosition()     solar azimuth + altitude at each sample (suncalc, local)
    └─ summarizeExposure()  aggregate → per-side totals → recommendation
    │
    ▼  JSON: routes[] each with { route, samples[], summary }
Browser renders RouteCards

Browser <img> ─── GET tile.openstreetmap.org/{z}/{x}/{y}.png ───► OSM tile servers
                  (fetched directly; no proxy and no credentials involved)
```

`lib/osm.ts` still starts with `import 'server-only'`. There is no secret left to
protect, but keeping the service layer off the client means a stray import fails the
**build** instead of moving outbound requests into the browser, where the User-Agent
the OSM services require cannot be set and every user's IP would hit the rate limit
separately.

### Components (`components/`)

| Component | Responsibility |
|---|---|
| `TripForm` | The four inputs (two links, date, time) + submit; per-field validation errors |
| `ErrorBanner` / `WarningList` | Typed error display, and non-fatal warnings |
| `RouteCard` | One route: name, map, distance, duration, recommendation banner, tables |
| `RouteMap` | Route preview on OSM tiles: tile grid + SVG path overlay, with attribution; if every tile fails it still draws the route shape and says so |
| `ExposureChart` | Bar chart of exposure per direction, sunniest bar marked |
| `ExposureTable` | Direction × (% of trip time, weighted intensity, notes) |
| `IntervalTable` | The 30-minute breakdown; collapsed to 8 rows with an explicit "show all" |

`app/page.tsx` is the client orchestrator: it submits the trip, maps typed error
codes back onto the right form field, and renders the results and the assumptions
section. There is no configuration pre-flight, because there is nothing to configure.

### API routes (`app/api/`)

| Route | Purpose |
|---|---|
| `POST /api/analyze` | The whole pipeline, and the only route. Validates input, resolves both endpoints, computes routes, samples and summarises each one, returns typed JSON. |

### Utility modules (`lib/`)

| Module | Contents |
|---|---|
| `parseMapLink.ts` | Extract lat/lng, an OSM object id or a place name from an OSM or Google share link, without any network call — including OSM shortlinks, decoded offline |
| `osm.ts` | *(server-only)* OSRM routing, Nominatim geocoding and lookup, error mapping |
| `polyline.ts` | The encoded polyline format OSRM emits (Google's algorithm, precision 5): decode, encode, and thin |
| `tileMath.ts` | Web Mercator projection, best-fit zoom, and the tile grid behind the route preview |
| `geo.ts` | Haversine distance, bearing, angle normalisation, interpolation along a path |
| `sunPosition.ts` | Solar azimuth/altitude via suncalc, and the intensity model |
| `routeSampling.ts` | Time→distance progress model and the 30-minute sampler |
| `exposureCalculator.ts` | Classification, aggregation, recommendation, confidence |
| `time.ts` | Timezone from coordinates, and wall-clock→UTC conversion that respects DST |
| `format.ts` | Display formatting (split out so `tz-lookup` stays out of the client bundle) |
| `errors.ts` | `AppError` with a machine-readable code |

`geo`, `polyline`, `sunPosition`, `routeSampling` and `exposureCalculator` are pure
functions with no I/O and no framework imports — which is what makes them directly
unit-testable.

### Data models (`types/index.ts`)

`LatLng`, `ResolvedPlace`, `ParsedMapsLink`, `TripInput`, `SunPosition`,
`ExposureDirection`, `SeatSide`, `ConfidenceLevel`, `RouteSample`,
`ExposureSummary`, `RouteStep`, `RouteOption`, `RouteRecommendation`,
`AnalyzeSuccessResponse`, `AppErrorCode`, `AnalyzeErrorResponse`, `AnalyzeResponse`.

`ParsedMapsLink` is a discriminated union (`coords` | `query` | `osm-object` |
`short-link` | `unknown`) so the "we only got a place name, we must geocode" case
can't be confused with the "we have coordinates" case.

### Main algorithms

1. **Link parsing.** For OpenStreetMap links, in priority order: the `?mlat/?mlon`
   marker, a `/go/` shortlink, a `/node|/way|/relation` object id, the `from`/`to`/
   `query` parameters, then the `#map=zoom/lat/lng` viewport centre. For Google
   links: the pinned `!3d<lat>!4d<lng>` marker, explicit query parameters
   (`q`, `ll`, `destination`, …), the `@lat,lng` viewport centre, then the place name
   from the path. OSM shortlinks are decoded arithmetically — their quadtile base64
   encoding carries the position itself, so no network round-trip is needed.
2. **Route retrieval.** One OSRM call with `alternatives=3&overview=full&steps=true`,
   returning up to three routes with polyline, distance, duration and step timings.
   OSRM takes coordinates as `longitude,latitude`, the reverse of everywhere else in
   this codebase; that order is built in exactly one place and pinned by a test,
   because getting it wrong returns a plausible route through the wrong hemisphere
   rather than an error.
3. **Progress model.** Step-level durations become a piecewise-linear time→distance
   curve, rescaled onto the polyline's own geometric length. So a bus crawling
   through a city for the first 30 minutes is placed where it actually is, not at
   a constant-speed guess. With no step data, constant speed is the documented
   fallback.
4. **Sampling.** Every 30 minutes: position along the polyline, heading from a
   ±150 m window around that point (a single vertex pair would be noisy), sun
   position, relative angle, exposed face, intensity.
5. **Aggregation and recommendation.** See the next section.

### Error handling

Every failure returns a typed `AppErrorCode` that the UI turns into a specific
message on a specific field: `INVALID_ORIGIN_LINK`, `INVALID_DESTINATION_LINK`,
`COORDINATES_NOT_FOUND`, `MISSING_DATE`, `MISSING_TIME`, `NO_ROUTE_FOUND`,
`INSUFFICIENT_POLYLINE`, `MAP_SERVICE_ERROR`, `INTERNAL_ERROR`.

The upstream services' own failures are translated into something actionable. OSRM's
`NoSegment` becomes "that pin isn't near a road the router knows — try a point on a
street"; a Nominatim `403` becomes advice about `OSM_USER_AGENT`, because Nominatim
rejects requests that don't identify the caller and the raw status says nothing about
that. `MAP_SERVICE_ERROR` is presented as a service outage rather than as bad input,
so a demo server having a bad day doesn't send the user off editing a link that was
already correct.

Degradation is graded rather than all-or-nothing: if one alternate route can't be
sampled, that route is dropped with a warning and the others still render; if the
tile servers don't answer, the preview still draws the route shape over a blank
background and says the tiles are unavailable, and the analysis is unaffected. Trips
shorter than 30 minutes automatically sample every 5 minutes instead of returning a
single useless data point.

---

## 2. Environment variables

**None are required.** The app works with no `.env.local` at all. Every variable
below is an override, and all four are documented in **`.env.example`**:

| Variable | Default | Purpose |
|---|---|---|
| `OSRM_BASE_URL` | `https://router.project-osrm.org` | Routing engine |
| `NOMINATIM_BASE_URL` | `https://nominatim.openstreetmap.org` | Geocoder, used only for name/object links |
| `OSM_USER_AGENT` | a generic `BusSunAdvisor/1.0` string | Identifies the app to both services |
| `NEXT_PUBLIC_TILE_URL_TEMPLATE` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Tile source for the preview |

Only the last carries the `NEXT_PUBLIC_` prefix, and deliberately: the browser
fetches tiles directly, so that value has to reach the client. Nothing here is a
secret in either direction.

### What the defaults cost you

Nothing in money, something in reliability. The OSRM and Nominatim public endpoints
are **demo and community servers**, not production infrastructure: they are
rate-limited, occasionally slow, and carry no uptime guarantee. Nominatim's policy
allows roughly one request per second and forbids bulk use; the OSM tile policy
requires the attribution the map already displays. For local use and demos this is
entirely fine. For anything with real traffic, self-host OSRM and Nominatim (both are
open source and run in Docker) and point the variables above at your own instances —
the app needs no other change.

Set `OSM_USER_AGENT` to something that names your deployment before you put it on the
internet. Nominatim answers `403` to callers it can't identify, and a generic string
shared by every copy of this app is exactly what that rule exists to catch.

---

## 3. Setup and run

### One click

```bash
./run.sh
```

On Windows, double-click **`run.bat`** instead (it runs the same script inside WSL).

`run.sh` finds Node, installs dependencies if needed, creates `.env.local` from the
example, builds the app, picks a free port if 3000 is taken, starts the server and
opens a browser. It asks you for nothing. It is safe to re-run — every step is
skipped once done.

| Flag | Effect |
|---|---|
| `--dev` | Run the dev server (hot reload) instead of the production build |
| `--rebuild` | Force a fresh production build first |
| `PORT=4000 ./run.sh` | Start from a specific port |

### Manual

Requires **Node.js 20 or newer** (22 LTS recommended).

```bash
npm install
npm run dev          # http://localhost:3000
```

That is the whole setup. Copy `.env.example` to `.env.local` only if you want to
override one of the endpoints in §2.

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Run the unit tests once (Vitest) |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

---

## 4. Deploying it for free

**Use Vercel's Hobby plan.** It is free, needs no card, and is built by the people who
make Next.js, so this app deploys with no configuration file and no adapter. The
alternatives are all worse for *this* stack: Netlify needs its Next.js runtime
adapter, Cloudflare needs OpenNext to translate the app to Workers, and Render's free
tier sleeps after 15 minutes of inactivity and takes about a minute to wake up.

One honest correction to the promise at the top of this file: the *map* services need
no account, but the *host* does. A Vercel account is free and card-free, but it is a
sign-up. Note also that Hobby is licensed for **non-commercial** use — a personal or
portfolio deployment is fine; selling access is not.

### Deploy from GitHub (recommended)

Every `git push` redeploys, and pull requests get their own preview URL.

```bash
# 1. Turn the folder into a repo (it isn't one yet)
git init -b main
git add -A
git commit -m "Bus Sun-Side Advisor"

# 2. Create the GitHub repo and push. With the gh CLI:
gh repo create bus-sun-advisor --private --source=. --push
#    Without gh: create an empty repo on github.com, then
#    git remote add origin git@github.com:<you>/bus-sun-advisor.git && git push -u origin main
```

Then, at [vercel.com/new](https://vercel.com/new): sign in with GitHub → **Import**
the repo → leave every build setting alone (Vercel detects Next.js, `npm install`,
`npm run build`) → add the one environment variable below → **Deploy**. It takes about
a minute and hands you a `https://<project>.vercel.app` URL.

### Deploy without GitHub

From this directory, for a throwaway URL in about two minutes:

```bash
npx vercel login
npx vercel --prod
```

Answer the setup prompts with the defaults. The catch is that there is no repo behind
it, so every future deploy means re-running the command by hand.

### The one environment variable to set

In **Project → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `OSM_USER_AGENT` | `BusSunAdvisor/1.0 (you@example.com)` — your real contact address |

Nominatim answers **403** to requests that do not identify the application making
them, and a shared host's IP is exactly the kind of caller it is strict about. The
other three variables in §2 can stay unset; their defaults are correct.

`.env.local` is git-ignored and is never uploaded, so this is not a duplicate of your
local file — it is the only place the deployed instance reads it from.

### Before you send anyone the link

The public OSRM demo server and OpenStreetMap's Nominatim **explicitly disallow
production traffic**: OSRM's demo instance is for testing, and Nominatim's policy caps
you near one request per second and forbids bulk use. A personal deployment that you
and a few friends use is the tolerated grey area. Anything with real users needs
`OSRM_BASE_URL` and `NOMINATIM_BASE_URL` pointed at your own instances — the overrides
exist for exactly this, and both projects ship Docker images. A commercial endpoint
with a free tier is the other way out, at the cost of the API key this app was
deliberately built without.

Tiles are fetched by the browser straight from `tile.openstreetmap.org`, so they never
touch your Vercel bill — but the same courtesy applies, and the attribution `RouteMap`
renders is a requirement of the tile policy, not decoration. Don't remove it.

### If a deploy misbehaves

- **504 `FUNCTION_INVOCATION_TIMEOUT`.** Unlikely: Hobby functions get 300 s, and a
  real request measures well under a second. It would take every upstream hanging at
  once to approach the limit. If it ever happens, the cause is a dead upstream, not
  the plan.
- **Every geocode fails with a 403-ish error.** `OSM_USER_AGENT` is unset, or was
  added after the last deploy — environment variables only apply to builds that come
  after them, so redeploy.
- **The build fails but `npm run build` works locally.** Delete `.next` and
  `tsconfig.tsbuildinfo` locally and rebuild; a stale cache can hide a real error that
  Vercel's clean checkout finds.

---

## 5. The sun direction and intensity algorithm

### Step 1 — When, exactly

The user picks a wall-clock date and time. That has to be interpreted **in the
timezone of the origin**, not the server's. `tz-lookup` resolves an IANA zone from
the origin coordinates offline, and a two-pass `Intl.DateTimeFormat` conversion
turns the wall clock into a UTC instant — two passes so that a departure near a DST
boundary uses the offset in force *at departure*, not the one in force at the
nominal UTC guess. On a UTC-hosted server, skipping this would silently shift every
sun position by hours.

### Step 2 — Where the bus is

Elapsed time → distance along the route (via the progress model) → a lat/lng by
interpolating between polyline vertices.

**Heading** is the forward azimuth computed over a ±150 m window centred on that
point, rather than between two adjacent vertices. Consecutive vertices on a
motorway can be metres apart, and a bearing over a 5 m baseline is mostly noise;
smoothing gives the direction the bus is genuinely travelling. At the ends of the
route the window is clamped, and a degenerate window falls back to the overall
origin→destination direction.

### Step 3 — Where the sun is

`suncalc` gives azimuth and altitude for the instant and the position.

> **Convention warning, because this is the easy thing to get silently wrong.**
> suncalc **v2** returns a *north-based azimuth in degrees* (0 = N, 90 = E,
> 180 = S, 270 = W) — the same convention as the bus heading, so no conversion is
> needed. suncalc **v1** returned *radians measured from due south*, and the
> `azimuth * 180/π + 180` conversion for it is still all over the internet.
> Applying it here rotates the sun and confidently recommends the wrong seat with
> nothing visibly broken. The tests pin this to physical facts — at true solar noon
> the sun is due south from Cairo and due north from Sydney — so a version bump
> that changes the convention fails loudly instead of quietly inverting the advice.

### Step 4 — Intensity

```
altitude ≤ 0  →  intensity = 0                      (below the horizon: night)
altitude > 0  →  intensity = sin(altitude in radians) × 100     (scale 0–100)
```

The sine of the solar elevation is the cosine of the solar zenith angle, which is
the geometric term in the standard irradiance relationship. It captures the
dominant effect — a sun 10° above the horizon delivers roughly a sixth of the energy
of one directly overhead — while ignoring cloud, haze and atmospheric attenuation.

Note this models energy landing on a *horizontal* surface, whereas a bus window is
vertical, so a low sun feels harsher through the glass than the number suggests.
The value is only ever used to weight one face of the bus against another within a
single trip, where that bias applies to all four faces equally, so the comparison
stays sound even though the absolute scale is approximate.

### Step 5 — Which side is in the sun

```
relative angle = sun azimuth − bus heading,  normalised to (−180°, +180°]
```

A positive angle means the sun is clockwise of straight ahead — that is, on the
bus's right.

| Relative angle | Face in the sun |
|---|---|
| −45° … +45° | **Front** |
| +45° … +135° | **Right** |
| > +135° or < −135° | **Back** |
| −135° … −45° | **Left** |

When the sun is below the horizon the sample is classified `none`, not attributed
to a side — otherwise a night trip would look like a trip with evenly balanced sun.

### Step 6 — Aggregate

Two accumulators, both weighted by how much trip time each sample stands for (so a
trailing partial interval never counts as a full one):

- **Time per face** → the "% of trip time" column. Night is excluded from all four
  buckets, so they sum to the daylight percentage rather than to 100.
- **Weighted intensity** = Σ (intensity × minutes), i.e. *intensity-minutes* → the
  figure the recommendation actually uses, because ten minutes of harsh overhead
  sun matters more than an hour of dusk glow.

### Step 7 — Recommend

The core rule is inversion: **sit on the side the sun is not hitting.** Around that
are the honest special cases, checked in order:

| Condition | Result |
|---|---|
| Daylight < 15% of the trip | `either`, **high** confidence — "sun exposure is negligible, sit wherever you like" |
| Average intensity < 8/100 | `either`, medium — "neither side gets meaningfully more heat or glare" |
| Front or back dominant *and* the sides take < 40% of exposure | Medium — "your choice of left or right has limited impact", with a lean if one side is still ≥20% ahead |
| Left and right within 10% of each other | `either`, **low** — "no clearly better side"; no fake precision |
| Otherwise | Recommend the shady side, with the confidence below |

Confidence combines how lopsided the split is (`sideMargin`), how much of the trip
is in daylight, and how strong the sun gets:

- **high** — margin ≥ 0.35 **and** daylight ≥ 70% **and** average intensity ≥ 25
- **medium** — margin ≥ 0.18 **and** daylight ≥ 40%
- **low** — anything else

Caveats are attached automatically where they apply: no step-level timings from the
router, too few samples, or a majority-night trip.

---

## 6. Example scenario

**Cairo → Alexandria**, ~220 km north-west, 20 August.

Paste these into the two link fields (both carry coordinates in the URL, so this
example never touches the geocoder):

- **From:** `https://www.openstreetmap.org/#map=14/30.0444/31.2357`
- **To:** `https://www.openstreetmap.org/?mlat=31.2001&mlon=29.9187`

Other accepted forms:

| Form | Example | Notes |
|---|---|---|
| OSM object | `https://www.openstreetmap.org/way/767933342` | Resolved through Nominatim's lookup |
| OSM shortlink | `https://osm.org/go/0EEQjE--` | Decoded offline, no request |
| OSM search | `https://www.openstreetmap.org/search?query=Cairo+Tower` | Geocoded |
| Google place with a pin | `https://www.google.com/maps/place/Cairo+Tower/@30.05,31.20,15z/data=…!3d30.0459!4d31.2243` | Parsed locally; Google is never called |
| Google short link | `https://maps.app.goo.gl/…` | Expanded server-side by following the redirect |
| Google directions | `https://www.google.com/maps/dir/?api=1&destination=31.2001,29.9187` | |
| Bare place name | `https://www.google.com/maps/place/Giza+Pyramids/` | Geocoded through Nominatim |
| Raw coordinates | `30.0444, 31.2357` | |
| `geo:` URI | `geo:30.0444,31.2357?z=15` | From a phone share sheet |

The tables below are computed from the idealised straight-line route used in
`tests/pipeline.test.ts` (fixed 2.5 h duration). Run against the live router, the app
follows the actual Desert Road geometry and OSRM's own duration, so the exact headings
and percentages will differ slightly — the logic producing them is the same.

### Departing 08:00 — expect a nuanced answer

The bus heads north-west (≈315°) while the morning sun climbs in the east
(87° → 103°). The relative angle is +131° to +148°, which puts the sun mostly
**behind** the bus:

| Time | Heading | Sun az | Sun alt | Relative | Face | Intensity |
|---|---|---|---|---|---|---|
| 08:00 | 315° | 87° | 19° | +131° | right | 33 |
| 08:30 | 315° | 90° | 26° | +135° | right | 43 |
| 09:00 | 316° | 94° | 32° | +139° | back | 53 |
| 09:30 | 316° | 98° | 38° | +143° | back | 62 |
| 10:00 | 316° | 103° | 44° | +148° | back | 70 |

> Back 60% of trip time · Right 40% · Left 0% · Front 0%
> **Sit on the left — medium confidence.** *"The sun sits mostly behind the bus for
> this journey (71% of the weighted exposure), which means your choice of left or
> right seat has limited impact. If you want to split hairs, the left side gets
> slightly less, so lean that way."*

This is the front/back-dominant branch doing its job: it does not oversell a seat
choice that barely matters.

### Departing 16:00 — the answer flips

Same route, same day. By late afternoon the sun has crossed to the west (257° →
273°), which is now the bus's left:

| Time | Heading | Sun az | Sun alt | Relative | Face | Intensity |
|---|---|---|---|---|---|---|
| 16:00 | 315° | 257° | 45° | −58° | left | 70 |
| 16:30 | 315° | 262° | 38° | −54° | left | 62 |
| 17:00 | 316° | 266° | 32° | −50° | left | 53 |
| 17:30 | 316° | 269° | 26° | −46° | left | 44 |
| 18:00 | 316° | 273° | 20° | −43° | front | 34 |

> Left 80% of trip time · Front 20% · Right 0% · Back 0%
> **Sit on the right — high confidence.** *"The sun falls on the left side of the bus
> for 87% of the weighted sun exposure (2 h of trip time). Sit on the right side to
> stay out of it."*

### Departing 23:00

Daylight 0%, average intensity 0 → `either`, high confidence, "sun exposure is
negligible."

These three cases are asserted in `tests/pipeline.test.ts`, along with a sweep over
all 24 departure hours checking that the summary is always complete and well-formed.

### Test coverage

136 tests across 8 files:

```bash
npm test
```

| File | Covers |
|---|---|
| `sunPosition.test.ts` | Intensity model, azimuth convention pinned to solar noon in both hemispheres, timezone/DST conversion |
| `geo.test.ts` | Distance, bearing, angle normalisation, interpolation |
| `polyline` (in `geo.test.ts`) | Round-trip encode/decode, thinning |
| `parseMapLink.test.ts` | Every link form above, shortlink decoding against the wiki's documented example, plus rejections |
| `osm.test.ts` | The service layer with `fetch` stubbed: OSRM's reversed coordinate order, Nominatim's string coordinates, and each error path |
| `tileMath.test.ts` | Projection checked against the published slippy-map formula, best-fit zoom, tile grid inside the frame |
| `routeSampling.test.ts` | Interval choice, progress model, sample weights, heading, geometric end-to-end checks |
| `exposureCalculator.test.ts` | Quadrant boundaries, aggregation, every recommendation branch |
| `pipeline.test.ts` | The full Cairo→Alexandria journey described above |

The solar assertions are anchored to physical facts rather than to whatever the
code currently returns — that is what caught a real azimuth-convention bug during
development.

---

## 7. Assumptions and limitations

- **Weather is not considered.** Cloud, haze, rain and air quality are ignored; a
  fully overcast day is analysed exactly like a clear one.
- **Nothing that blocks the sun is modelled** — buildings, trees, terrain, tunnels,
  cuttings and roadside walls all cast real shade that this app cannot see.
- **Window tint and glazing are not modelled.** Real coach glass changes both how
  much heat gets through and how much it matters.
- **Bus seat layout is not modelled.** "Left" and "right" mean the left and right
  side of the vehicle in the direction of travel, not a seat number, and not a
  particular operator's floor plan.
- **Intensity is approximated from solar altitude alone** — see the formula above.
  It is a relative comparison between the four faces of one bus, not an absolute
  irradiance figure in W/m².
- **There is no traffic model at all.** OSRM's durations are free-flow estimates
  computed from road classes and speed limits: it does not know about rush hour,
  roadworks or an accident on the Desert Road, and real buses stop besides. This is a
  stronger caveat than a traffic-aware API would carry, and the app states it in the
  results rather than leaving it in the small print. A schedule that slips by an hour
  moves every sun position with it.
- **Bus heading is inferred from route geometry**, so it assumes the bus follows the
  driving route the router returned. Diversions, different bus stations and service
  roads all shift it — as does OpenStreetMap data being wrong or out of date in the
  area you're travelling through, which in sparsely mapped regions it can be.
- **This is directional guidance, not a safety or medical guarantee.** It does not
  replace sunscreen, and it says nothing about UV exposure risk.

---

## 8. Future improvements

**Accuracy**

- Weight the intensity model for a *vertical* surface (window) rather than a
  horizontal one, and add an atmospheric air-mass term so a low sun is not
  understated.
- Pull cloud cover from a weather API per sample point and scale intensity by it —
  the single biggest source of real-world error.
- Use terrain elevation and building footprints to detect when the sun is actually
  blocked, particularly in cities and mountain passes.
- Model the bus as having a length: front-quarter and rear-quarter seats get
  measurably different exposure from the ones at the axle.

**Data**

- Traffic-aware routing. OSRM has no live traffic input, so this needs either a
  self-hosted OSRM fed with traffic speed data (it supports per-segment speed
  updates) or a different engine — the biggest accuracy gap in the routing layer.
- Support transit routes and real bus schedules rather than driving directions, so
  the geometry matches the vehicle the user is actually on.
- Let the user drop waypoints or pick a specific bus operator's route.

**Product**

- Shareable result URLs, so a trip can be sent to whoever is booking the seats.
- "Best departure time" mode: sweep departures across a day and show which one has
  the least sun exposure overall.
- Seat-map picker showing the recommendation on an actual coach layout.
- Return-journey analysis in the same request — the answer usually flips, and
  people usually travel both ways.
- Per-sample map animation of the bus and the sun vector, instead of a static image.

**Engineering**

- Self-host OSRM and Nominatim in Docker, with a `docker compose up` in this repo.
  The public endpoints are the only thing standing between this app and real traffic.
- Cache geocoding and route responses (keyed by endpoints) — the request that costs
  nothing in money still costs a shared community server, which is the whole reason
  Nominatim's policy asks for caching.
- Rate limiting on `/api/analyze`, so this app cannot be the reason someone else's
  OSM requests start getting refused.
- Component and end-to-end tests (the calculation layer is well covered; the UI is
  not yet).
- Structured server-side logging of upstream failures, so a rate-limited or
  unreachable OSRM surfaces as an operational signal rather than as a user-facing
  error nobody sees.
