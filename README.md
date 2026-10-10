<div align="center">

# SimRun

**Local-first route editor and explicitly simulated GPX activity studio.**

[![Live app](https://img.shields.io/badge/live%20app-simrun.vercel.app-000000?logo=vercel&logoColor=white)](https://simrun.vercel.app)
[![Verify](https://github.com/exterminatorrat/simrun/actions/workflows/verify.yml/badge.svg)](https://github.com/exterminatorrat/simrun/actions/workflows/verify.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-3178c6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/node-%E2%89%A520.19-339933?logo=nodedotjs&logoColor=white)
![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)

### [Open the web app → simrun.vercel.app](https://simrun.vercel.app)

[Features](#features) · [Quick start](#quick-start) · [Architecture](#architecture) · [Deploy](#deploy-to-vercel) · [Privacy](#external-services-and-privacy) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

---

Draw pedestrian or bicycle routes, import GPX, KML or GeoJSON, adjust timing, preview profiles, export simulated activities, and keep a browser-local library. No login, payments, cloud database, analytics, or secrets.

| | |
| --- | --- |
| **Live app** | https://simrun.vercel.app (static Vercel deployment of `dist/`) |
| **Source** | https://github.com/exterminatorrat/simrun (`main`) |
| **Stack** | Strict TypeScript, native DOM, ES modules; no framework, zero runtime dependencies |
| **Data** | Stays in your browser: IndexedDB, localStorage, Cache Storage |
| **Hosting** | Any static host; preconfigured by `vercel.json` |

## Features

- **Routing:** cancellable, throttled Valhalla requests (never automobile costing) with **walk**, **hike**, **road** and **mountain-bike** profiles; over-long routes get a clear public-limit message (about 100 km on foot, 150 km by bike) that points at self-hosting. Waypoint editing, shaping handles, undo/redo, reverse, out-and-back, close-loop, and loop planning by lap count or target distance.
- **Simulation:** deterministic and seeded; terrain-aware pacing from a centered 30 m smoothed grade with asymmetric uphill/downhill cost; weather presets that scale duration and deepen cardiac drift; estimated power, cadence and fatigue; optional synthetic heart rate with warm-up and drift; distance-anchored rest stops with elapsed-vs-moving time; structured interval workouts; simulated GPS noise and signal dropout; custom splits and workout-step boundaries with a per-segment table.
- **Import/export:** GPX, KML and GeoJSON in; GPX (with opt-in power/cadence/temperature extensions), TCX, turn-by-turn cue-sheet CSV, SVG profiles and JSON backup out.
- **Analysis and library:** heart-rate zones, a pace/speed histogram and per-unit split charts; tags, search, sort, drag-and-drop import and a storage estimate.
- **Local-first:** IndexedDB history and drafts with an explicitly labeled **Session only** fallback; offline app shell via service worker.
- **UI:** MapLibre/OpenFreeMap basemap with a labeled coordinate-canvas fallback; metric/imperial units; light/dark appearance; mobile settings sheet.

- **Route editing:** trim, split at a point, merge with a saved route (gaps up to 100 km are routed through the provider, larger gaps are rejected) and freehand drawing that is simplified and snapped through the provider; each action is undoable and a failed route never becomes an exportable straight line.
- **Routing intelligence:** target-distance round trips (at most four Valhalla calls, the achieved distance is reported honestly), optional surface and road-type breakdowns from Valhalla `trace_attributes` (off by default), street names in cue sheets, and opt-in water and toilet points of interest from Overpass (off by default, disclosed in the UI).
- **Simulation depth:** pace strategies (even, negative split, positive split, equal-distance segment paces), grade-adjusted pace, a sex-agnostic Banister TRIMP estimate, six sports (run, ride, walk, hike, trail run, mountain bike), activity name and description in GPX and TCX (FIT has no standard description field), batch generation of up to 20 seeded variants saved to the library, and a worker for large simulations.
- **Send and library:** Web Share with files, save to a folder, ZIP export, per-platform guidance with official import pages (FIT for Strava and TrainingPeaks, GPX for Garmin Connect, intervals.icu and Ride with GPS; COROS imports GPX routes only), library collections, bulk export and delete, and a full-library ZIP that includes the JSON backup. Nothing is uploaded by the app and no credentials are stored: Strava needs a registered application and OAuth, Garmin Connect's developer program is enterprise-only and the COROS Partner API is for established platforms.
- **Maps, search and offline:** opt-in Photon place suggestions as you type (Nominatim stays submit-only because its policy forbids autocomplete), a one-shot locate-me button, OpenTopoMap and Waymarked Trails cycling and hiking layers with attribution, named saved places that search fully offline (there is no worldwide offline gazetteer), and an offline corridor manager with sizes, progress, cancel and delete.
- **Guidance and status:** a dismissible first-run tip, keyboard-shortcut help on `?`, a draft and storage status with a quota warning, grouped settings with a live summary of what is sent to third parties, and touch-friendly waypoint editing.
- **Release tooling:** CI on pull requests with coverage, ESLint, Dependabot, security headers and a CSP, a [privacy page](public/privacy.html) and a [changelog](CHANGELOG.md).

There is **no seeded activity, artificial road network, or fake successful routing**. Browser tests use their own synthetic fixtures and mocked providers. Failed road routing never promotes a straight waypoint preview into an exportable route.

Routes can be shared as a geometry-only URL fragment with a copy fallback, a client-rendered QR code, a coordinate/history privacy note and a printable cue sheet; a PWA manifest enables installation. Gradient-shaded route segments and an interactive elevation scrubber (pointer or arrow keys, Escape to clear) sit on the profile chart. **FIT** activity files export and import alongside GPX/TCX; the library offers tags, search, sort, drag-and-drop import, a storage estimate and a side-by-side comparison of two activities. Optional, default-off offline behaviour downloads the bounded tile corridor that covers a route and can cache routing/elevation replies (network-first, capped at 50 entries and 30 days). Avoid-highways/hills options and one alternate route (under 60 km) shape routing requests. Every simulated value stays labeled as estimated, not measured.

**Not implemented:** traffic modelling, a worldwide offline gazetteer, a satellite layer (no key-free source with suitable terms was found), direct API upload to Strava, Garmin or COROS, FIT activity descriptions, and translations beyond English.

## Quick start

Node.js 20.19 or newer and npm. The tested toolchain is Node 22 and TypeScript 5.8.3.

```sh
npm ci
npm test
npm run dev -- --host 0.0.0.0 --port 5173
```

| Script | Purpose |
| --- | --- |
| `npm run dev` / `npm start` | Local static server (`scripts/serve.mjs`); not a production dependency |
| `npm run build` | `tsc` then `scripts/build.mjs`, producing `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Build, then `node --test tests/*.test.mjs` |
| `npm run vendor` | Refresh the pinned MapLibre bundle |
| `npm run package` | Create the source handoff archive |

For static hosting, serve **`dist/`** (entry `dist/index.html`). Relative asset paths support deployment below a URL prefix. Use HTTPS or a normal localhost origin, not `file://`.

## Deploy to Vercel

The production app is live at **https://simrun.vercel.app**. `vercel.json` pins the build (`npm ci`, `npm run build`, output `dist`). Never serve the unbuilt `public/` directory. Project linkage, deploy commands and credential handling are in [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md).

## Architecture

Strict TypeScript, native DOM components, ES modules, and standard browser APIs. TypeScript is the only build dependency, exactly pinned in `package-lock.json`. The project does not use React/Vite: a small standards-based static app was chosen over an unverified framework dependency chain.

```mermaid
flowchart LR
  UI[main.ts / ui.ts] --> Editor[editor.ts<br/>undo, redo, cancellation]
  Editor --> Providers[providers.ts<br/>route, elevation, search]
  Editor --> Model[model.ts / geometry.ts<br/>deterministic simulation]
  UI --> Map[map.ts<br/>MapLibre or canvas fallback]
  Model --> Export[gpx.ts / cues.ts / charts.ts]
  Import[gpx.ts / import.ts] --> Editor
  UI --> Storage[storage.ts<br/>IndexedDB, backups]
  Providers -. HTTPS .-> Ext[(OpenFreeMap, FOSSGIS Valhalla, Nominatim opt-in)]
```

| Module | Responsibility |
| --- | --- |
| `src/main.ts` | Composition, forms, library, settings and workflow |
| `src/editor.ts` | Route changes, undo/redo and stale-request cancellation |
| `src/map.ts` | MapLibre integration and honest coordinate-only fallback |
| `src/providers.ts` | Routing, elevation, intentional geocoding and rate limits |
| `src/geometry.ts`, `src/model.ts` | Geodesic math, validation and deterministic simulation |
| `src/gpx.ts` | Browser-local XML parsing and GPX serialization |
| `src/import.ts` | KML and GeoJSON parsing onto the shared import pipeline |
| `src/cues.ts` | Cue-sheet CSV generation |
| `src/storage.ts` | Versioned IndexedDB, preferences and validated backups |
| `src/charts.ts`, `src/ui.ts` | Responsive SVG profiles and DOM primitives |
| `src/sw.ts` | Service worker: app-shell precache and basemap cache |
| `src/routeops.ts` | Trim, split, merge and freehand simplification |
| `src/roundtrip.ts`, `src/poi.ts` | Target-distance loops and opt-in points of interest |
| `src/sports.ts`, `src/gap.ts`, `src/trimp.ts`, `src/batch.ts` | Sports, grade-adjusted pace, training load and batch variants |
| `src/simulation.ts`, `src/simulation-worker.ts` | Worker offload for large simulations with a synchronous fallback |
| `src/zip.ts`, `src/send.ts` | Store-only ZIP writer and the send and share flow |
| `src/places.ts` | Photon suggestions, saved places and offline search |
| `src/shortcuts.ts`, `src/messages.ts` | One shortcut list for handler and help, and actionable error messages |

Application-specific assets are in `public/`. System fonts are used; there are no bundled font files.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md) | Vercel project, commands, protection notes |
| [docs/SELF-HOST-VALHALLA.md](docs/SELF-HOST-VALHALLA.md) | Self-hosting routing to lift public limits |
| [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | Implementation notes |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | What was and was not verified |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | Acceptance scenarios |
| [docs/plans/05-polish-and-release.md](docs/plans/05-polish-and-release.md) | Polish and release-readiness plan |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow and PR checklist |
| [SECURITY.md](SECURITY.md) | Threat model and vulnerability reporting |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Licenses, attribution and data terms |

## External services and privacy

OpenFreeMap supplies the Liberty basemap. The default routing/elevation endpoint is FOSSGIS's public Valhalla service, with `pedestrian` or `bicycle` costing, never automobile costing. These endpoints are replaceable in Settings. FOSSGIS's public Valhalla caps a single route at 100 km (`pedestrian`) or 150 km (`bicycle`) and rejects longer requests with its own error; self-host Valhalla and raise `service_limits` to route farther, as described in [docs/SELF-HOST-VALHALLA.md](docs/SELF-HOST-VALHALLA.md). Map views, waypoint coordinates and requested elevation samples go to the providers. GPX file contents are not uploaded; converting an imported route to routed waypoints sends those chosen coordinates after confirmation.

**MapLibre GL JS 5.6.1 is served locally.** The checked-in `public/vendor/` includes its CSP build, dedicated same-origin worker, CSS and upstream license. Runtime rendering no longer requests unpkg. To refresh the pinned bundle from upstream:

```sh
npm run vendor
npm run build
```

The OpenFreeMap Liberty style, and the OpenFreeMap dark style that is selected automatically in dark appearance, keep their vector tiles, sprites and glyphs external. Both style URLs are replaceable in Settings. If WebGL or all basemap resources fail, the app shows a labeled coordinate canvas and keeps route editing usable. A single failed tile or glyph does not immediately disable the map.

Cue-sheet export writes a CSV with start, turn and finish rows. Turns are read from the exported route geometry rather than from street names, so routed, imported and loop-planned routes all produce one.

Optional services, all off by default: Nominatim place search, Photon suggestions as you type, Overpass points of interest, Valhalla `trace_attributes` surface data, OpenTopoMap and Waymarked Trails tiles, and the one-shot browser location request. Each sends only what its Settings text states; see the [privacy page](public/privacy.html).

Nominatim place search is **off by default**. Enable it deliberately only after reading the policy linked in Settings: https://operations.osmfoundation.org/policies/nominatim/. No autocomplete; searches are user-submitted, cached and limited to a small result set. Service requests are queued at least 1.2 seconds apart, with cross-tab coordination where browser APIs permit. Public providers offer no availability guarantee. Before a public release, review current provider terms, notify the Valhalla demo operators as requested in their guidance, and configure a suitable identifying client header if required. Do not deploy this personal-use configuration as a high-volume public service.

## Persistence and backups

IndexedDB database `simrun-local`, schema version 1: `activities` and `meta` (current draft). Small preferences and search/rate-limit caches use localStorage. Each saved activity stores versioned settings, seed and geometry, not duplicated full simulation output. On unsupported/blocked storage, the interface explicitly says **Session only**. Clearing site data or moving to a different origin does not migrate your library. Use History → Back up local data / Restore backup. Do not expect a new Sites preview URL to inherit the old origin's data.

**Offline map data.** A service worker precaches the built application shell from `dist/sw-manifest.json`, so the app opens without a network after one visit. Basemap resources from the OpenFreeMap endpoint are cached as you view them and served cache-first, bounded to 1,500 entries; routing, elevation and search are never cached. Cache Storage is a third store beside IndexedDB and localStorage, and clearing site data removes it too. Settings → Offline map data reports how many resources are cached and clears them. Only the areas you have actually viewed are available offline.

## Verification and real limitations

See [docs/VERIFICATION.md](docs/VERIFICATION.md) and [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). The Node suite, strict type check and lint run in CI, and the Playwright harness runs in headless Chrome with mocked providers. **Live road routing, actual MapLibre rendering (WebGL was unavailable in the test browser), hosted CORS and CSP behaviour, native IndexedDB persistence across real reloads, cross-browser behaviour, real screen readers, and uploads into real Strava, Garmin and COROS accounts are not verified.**

GPX, KML and GeoJSON imports retain the largest continuous segment when a file contains disjoint segments and tell the user; they do not invent connecting paths. GeoJSON and KML geometry without timestamps falls back to the activity timing settings. Exports are resimulations, not lossless copies of original recordings. Start time uses an explicit fixed UTC offset; check that offset for the chosen date, including daylight-saving changes. Very long simulations increase the effective sample interval to cap output at approximately 50,000 points. Optional custom splits and GPS noise/dropout are simulated deterministically from the saved seed: noise jitters exported coordinates while distance and timing stay on the true route, and dropout removes fixes in outages, which export as separate track segments instead of invented straight lines. These remain synthetic effects, not device measurements.

## Browser checks

The optional test runner is separate from application runtime dependencies:

```sh
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
# In another terminal, leave npm run dev running:
python tests/browser.py --url http://127.0.0.1:5173
# Use an installed Chrome instead of the downloaded Chromium:
python tests/browser.py --url http://127.0.0.1:5173 --chromium /usr/bin/google-chrome
```

Other checks: `npm run lint`, `npm run typecheck` and `npm run test:coverage`.

This uses mocked providers and intentionally unavailable CDN to exercise the coordinate fallback; it never hits public routing services. On a normal HTTP origin it also checks native IndexedDB restoration. `--isolated` compiles an AMD test harness into a temporary directory and runs without navigation; it explicitly does not test HTTP/ESM, MapLibre or persistent storage. `--screenshots <directory>` is optional; keep screenshots outside the source archive.

## Package

```sh
npm ci
npm test
npm run package
```

Creates `simrun-sites-handoff.zip` with one `simrun/` root. The packager excludes dependencies, builds, caches, secrets and test outputs; includes a source hash manifest; and resolves Git metadata when available. It refuses a dirty Git checkout. For a connector-verified source copy without `.git`, use `node scripts/package.mjs --commit <verified-source-sha>`. `BUILD_INFO.json` is generated snapshot metadata: its Git SHA names the source commit, avoiding an impossible self-referential commit hash. `SOURCE_DATE_EPOCH` can fix archive creation time for repeatability.


## License

[MIT](LICENSE). The license does not cover the brand images in `public/` (`logo.jpg`, `mark.jpg`, `favicon.png`, `apple-touch-icon.png`): they are third-party artwork the project owner has no rights to, and they are not licensed for reuse. Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
