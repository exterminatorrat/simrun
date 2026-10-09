# SimRun

A local-first route editor and **explicitly simulated** GPX activity studio. Draw pedestrian or bicycle routes, import GPX, adjust timing, preview profiles, export simulated activities, and keep a browser-local library. No login, payments, cloud database, analytics, or secrets.

**Canonical source:** https://github.com/exterminatorrat/simrun (private, `main`).
**Sites agent:** read [CHATGPT-SITES-HANDOFF.md](CHATGPT-SITES-HANDOFF.md) first.

## Run from source

Node.js 20 or newer, npm. The tested toolchain is Node 22 and TypeScript 5.8.3.

```sh
npm ci
npm test
npm run dev -- --host 0.0.0.0 --port 5173
```

For static hosting, run `npm run build` and serve **`dist/`**. Its entry is `dist/index.html`. The development Node server is not a production dependency. Relative asset paths support deployment below a URL prefix. Use HTTPS (or a normal localhost development origin), not file://.

## Deploy to Vercel

This repository is preconfigured for static Vercel deployment through `vercel.json` (`npm ci`, `npm run build`, output `dist`). Never serve the unbuilt `public/` directory. The linked project, deploy commands and credential handling are documented in [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md).

## What is here

MapLibre/OpenFreeMap integration; cancellable and throttled Valhalla pedestrian/bicycle requests; waypoint editing, shaping handles, undo/redo, reverse, out-and-back and close-loop (return to the start); loop planning by lap count or target distance around a closed loop with a start you can drag along the loop and a derived finish; time/pace/speed conversion; smooth deterministic simulation; optional synthetic HR; GPX import/export; custom splits (auto interval and markers) with a per-segment table; deterministic simulated GPS noise and signal dropout; SVG profiles; IndexedDB history/drafts with an explicitly labeled memory fallback; JSON backup/restore; metric/imperial units; light/dark appearance; mobile settings sheet.

There is **no seeded activity, artificial road network, or fake successful routing in the application**. Browser tests use their own synthetic fixtures and mocked provider responses. If the basemap cannot load, a clearly labeled coordinate canvas can display/edit geometry. Failed road routing never promotes a straight waypoint preview into an exportable route.

## Architecture

Strict TypeScript, native DOM components, ES modules, and standard browser APIs. The project does not use React/Vite: registry access was unavailable in the build environment, and a small standards-based static app was used instead of an unverified framework dependency chain. TypeScript is the only build dependency, exactly pinned in `package-lock.json`.

| Module | Responsibility |
| --- | --- |
| `src/main.ts` | Composition, forms, library, settings and workflow |
| `src/editor.ts` | Route changes, undo/redo and stale-request cancellation |
| `src/map.ts` | MapLibre integration and honest coordinate-only fallback |
| `src/providers.ts` | Routing, elevation, intentional geocoding and rate limits |
| `src/geometry.ts`, `src/model.ts` | Geodesic math, validation and deterministic simulation |
| `src/gpx.ts` | Browser-local XML parsing and GPX serialization |
| `src/storage.ts` | Versioned IndexedDB, preferences and validated backups |
| `src/charts.ts`, `src/ui.ts` | Responsive SVG profiles and DOM primitives |

All application-specific assets are in `public/`. System fonts are used; there are no bundled font files.

## External services and privacy

OpenFreeMap supplies the Liberty basemap. The default routing/elevation endpoint is FOSSGIS's public Valhalla service, with `pedestrian` or `bicycle` costing, never automobile costing. These endpoints are replaceable in Settings. Map views, waypoint coordinates and requested elevation samples go to the providers. GPX file contents are not uploaded; converting an imported route to routed waypoints sends those chosen coordinates after confirmation.

**MapLibre GL JS 5.6.1 is served locally.** The checked-in `public/vendor/` includes its CSP build, dedicated same-origin worker, CSS and upstream license. Runtime rendering no longer requests unpkg. To refresh the pinned bundle from upstream:

```sh
npm run vendor
npm run build
```

The OpenFreeMap Liberty style, vector tiles, sprites and glyphs remain external. If WebGL or all basemap resources fail, the app shows a labeled coordinate canvas and keeps route editing usable. A single failed tile or glyph does not immediately disable the map.

Nominatim place search is **off by default**. Enable it deliberately only after reading the policy linked in Settings: https://operations.osmfoundation.org/policies/nominatim/. No autocomplete; searches are user-submitted, cached and limited to a small result set. Service requests are queued at least 1.2 seconds apart, with cross-tab coordination where browser APIs permit. Public providers offer no availability guarantee. Before a public release, review current provider terms, notify the Valhalla demo operators as requested in their guidance, and configure a suitable identifying client header if required. Do not deploy this personal-use configuration as a high-volume public service.

## Persistence and backups

IndexedDB database `simrun-local`, schema version 1: `activities` and `meta` (current draft). Small preferences and search/rate-limit caches use localStorage. Each saved activity stores versioned settings, seed and geometry, not duplicated full simulation output. On unsupported/blocked storage, the interface explicitly says **Session only**. Clearing site data or moving to a different origin does not migrate your library. Use History → Back up local data / Restore backup. Do not expect a new Sites preview URL to inherit the old origin's data.

## Verification and real limitations

See [docs/VERIFICATION.md](docs/VERIFICATION.md) and [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). The creation environment had no Sites tool, no package-network access and a browser that blocked HTTP/file navigation. The source builds and logic tests run locally; UI tests ran in an isolated DOM harness with mocked providers. **A private Sites preview, live road routing, actual MapLibre rendering, hosted CORS/CSP and native IndexedDB reload persistence are not verified here.**

GPX import retains the largest continuous segment when a file contains disjoint segments and tells the user; it does not invent connecting paths. Exports are resimulations, not lossless copies of original recordings. Start time uses an explicit fixed UTC offset; check that offset for the chosen date, including daylight-saving changes. Very long simulations increase the effective sample interval to cap output at approximately 50,000 points. Optional custom splits and GPS noise/dropout are simulated deterministically from the saved seed: noise jitters exported coordinates while distance and timing stay on the true route, and dropout removes fixes in outages, which export as separate track segments instead of invented straight lines. These remain synthetic effects, not device measurements.

## Browser checks

The optional test runner is separate from application runtime dependencies:

```sh
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
# In another terminal, leave npm run dev running:
python tests/browser.py --url http://127.0.0.1:5173
```

This uses mocked providers and intentionally unavailable CDN to exercise the coordinate fallback; it never hits public routing services. On a normal HTTP origin it also checks native IndexedDB restoration. `--isolated` compiles an AMD test harness into a temporary directory and runs without navigation; it explicitly does not test HTTP/ESM, MapLibre or persistent storage. `--screenshots <directory>` is optional; keep screenshots outside the source archive.

## Package

```sh
npm ci
npm test
npm run package
```

Creates `simrun-sites-handoff.zip` with one `simrun/` root. The packager excludes dependencies, builds, caches, secrets and test outputs; includes a source hash manifest; and resolves Git metadata when available. It refuses a dirty Git checkout. For a connector-verified source copy without `.git`, use `node scripts/package.mjs --commit <verified-source-sha>`. `BUILD_INFO.json` is generated snapshot metadata: its Git SHA names the source commit, avoiding an impossible self-referential commit hash. `SOURCE_DATE_EPOCH` can fix archive creation time for repeatability. See the handoff for private-preview instructions.
