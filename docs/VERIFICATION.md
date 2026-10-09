# Verification record — 2026-09-27

## Verified in the creation environment

- `npm ci` / locked TypeScript 5.8.3 installation using the available npm cache; `npm run build` and strict TypeScript checks.
- **24 Node tests**: geodesic math, dateline interpolation, known pace/speed cases, rounding, natural timing, exact elapsed duration, increasing timestamps, timezone rollover, deterministic HR/mean/smoothness, HR-off isolation, XML escaping, validation, undo/redo, cancellation races, routing-error state, profile selection, 429 handling, opt-in search, backup sanitation, memory history and export guards.
- **17 isolated browser checks** in Chromium via Python Playwright: meaningful app load, no uncaught application exceptions, malformed/empty states, imported geometry and profiles, timing edits, natural/HR output, actual Blob contents parsed as XML, session history/duplicate/open, route edits, reverse/out-and-back/close-loop/undo/redo, loop planning with a derived finish and lap-aware export, mocked provider failure/retry and costing, offline coordinate search, backup content, units/theme, responsive controls and honest blocked-storage state.
- Visually inspected 1440x900 desktop, 1280x800 laptop and 390x844 mobile. Fixed chart text scaling, toolbar overlap and resize fitting. The screenshots use a synthetic test route, not an advertised real road.
- No Image Gen / Browser plugin was available. No approved generated design concept exists. Visual implementation was reviewed directly against the user's map-first layout and restrained styling requirements, not falsely described as a pixel match to an approved image.

## What those tests do NOT prove

The environment did not expose a ChatGPT Sites tool. The container could not resolve external package/provider hosts, and Chromium blocked both local HTTP and file navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`). No browser policy was changed to get around that restriction. Isolated tests compiled the same TypeScript to AMD in a temporary DOM-only harness. Its origin does not support IndexedDB, so only the explicit memory fallback was tested there. The real application build remains ordinary ES modules, not AMD.

**Not verified:** private Sites preview; browser-loaded production ESM over HTTP; actual MapLibre/CDN/WebGL rendering; live OpenFreeMap, Valhalla or Nominatim; preview CORS/CSP; native IndexedDB recovery across reloads; independent GPX XSD validation; compatibility with a specific third-party GPX importer. Provider fixture tests are never counted as live service passes. The original 15 live Site acceptance scenarios remain to be rerun in the target environment.

## Visual review points

Map remains the primary surface; no marketing landing page. Controls use a single restrained orange accent and light/dark neutral surfaces. Route tools and inspector remain separate. Chart axis text now scales at readable native pixel sizes, rather than shrinking inside a fixed wide SVG. Short-laptop zoom controls no longer cover route actions. Mobile inspector opens as a sheet; route geometry refits when the viewport changes. Original vector icons and system typography need no external font assets.

## Archive verification

The packaging script writes an allowlisted, sorted source archive, resolves source-commit metadata and hashes each included source file. The delivered archive must additionally pass extraction, frozen dependency installation, build, Node tests, isolated browser checks and file/secret inspection from the extracted directory before handoff. The final response should report the actual reconstruction result, not assume this paragraph constitutes a pass.

## Sites compatibility update (2026-09-27)

The private Site's initial unpkg-based map could become blank. The renderer now ships a pinned local MapLibre CSP build, worker, CSS and license. The coordinate canvas stays over the renderer until real vector features appear and returns when the basemap as a whole stops rendering; ordinary isolated tile/glyph errors are tolerated. The managed HTTP preview also uses a secure random ID fallback where `crypto.randomUUID` is unavailable. The 24 Node tests pass. In the managed browser, WebGL context creation is disabled, so the real basemap could not be verified there. The coordinate fallback, coordinate search, waypoint creation, native local storage and live Valhalla routing worked. A direct request to the hosted HTML showed no CSP header; the OpenFreeMap Liberty style, a Shanghai vector tile, sprite JSON/PNG and glyph PBF responded with CORS `*`. These HTTP checks do not prove browser WebGL rendering or 30-second stability in a WebGL-enabled browser. Rerun the acceptance checklist there before claiming the visual map is fixed.

## KML/GeoJSON import (2026-10-09)

- Added `src/import.ts` for KML (LineString and gx:Track coordinates) and GeoJSON (LineString/MultiLineString, bare geometry or FeatureCollection). The GPX import builder moved to `model.importedActivity` and is shared, so GPX, KML and GeoJSON keep the largest continuous segment and never invent connecting paths. Files without timestamps fall back to the activity timing settings.
- `npm test` passes 41 Node tests (5 added here), including new cases for GeoJSON import, KML coordinate parsing, largest-segment selection and file dispatch.
- The Playwright harness passes all checks in HTTP mode (19) and the isolated DOM harness, including new KML and GeoJSON file-import checks. Verification used the repo's own browser tool with mocked providers; live WebGL basemap rendering remains unverified here.

## Custom splits and GPS simulation (2026-10-09)

Added deterministic GPS noise and dropout plus custom splits. `npm run typecheck`, `npm run build` and **36 Node tests** pass (12 new cases cover noise determinism and bounded coordinates, dropout gaps and strictly increasing timestamps, split boundaries/totals, validation round-trips and multi-`trkseg` export). A headless Chrome run against `npm run dev` imported a 2.17 km GPX route, set 6 m noise and 15% dropout (point count 436 → 356, no console errors), and rendered a 4-row Splits table for a 1 km auto split plus a 1.5 km marker. The basemap stayed on the labeled coordinate fallback because external providers are unreachable here; the new controls are not yet checked in the private Sites preview.

## Offline basemap cache (2026-10-09)

- `npm run build` emits `dist/sw-manifest.json`. The Node suite asserts the precache list covers the shell, the vendored MapLibre bundle, its worker and its CSS while excluding the service worker itself, and that registration is a no-op without service worker support. `npm test` passes 39 Node tests after merging the splits/noise work.
- In Chromium over HTTP the service worker installs and activates, precaches the shell, reloads the app shell with the page set offline, and reports and clears the basemap cache from Settings (20 browser checks). No uncaught exceptions. Like the rest of the suite, these checks make no live provider request: they seed the basemap cache through Cache Storage directly.
- Inspected manually here with exactly one live `https://tiles.openfreemap.org/styles/dark` request: the service worker's basemap handler fetches `cors:200`, stores the entry, and the same resource is served back from the cache byte-for-byte with the network disabled. Response cloning was required before `cache.put`, because storing the response otherwise disturbs the body returned to the page.
- The offline reload is asserted to boot the application, not merely to return the static HTML: the UTC offset select, which only the application populates, must be non-empty after an offline reload. This caught a real defect. The worker skipped every request path ending in `/sw.js`, which also matched the application's own compiled `src/sw.js` module, so offline that import reached the network, the module graph failed and the app never started. The skip now compares against the worker script's exact path, and a Node test guards it.
- **Not verified here:** offline *rendering* of vector tiles. This sandbox's browser disables WebGL, so MapLibre never initializes and no tiles, glyphs or sprites are requested. These checks prove the shell loads and the cache, bound and clear paths work, not that the map draws from cache. Confirm on a WebGL-enabled browser.
