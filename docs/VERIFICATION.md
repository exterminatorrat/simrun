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

## Dark map style and cue-sheet export (2026-10-09)

- Preferences gained a second style URL, `mapStyleDark` (OpenFreeMap dark), validated through the same HTTPS `endpoint()` rule. The style now follows the appearance; `mapStyleFor` is a pure exported function covered by a Node test.
- `npm test` passes 39 Node tests, including 7 new cue-sheet cases (left/right/U-turn classification, straight and two-point routes, CSV structure and column order, unit labels, activity-name escaping, draft refusal) plus the preference validation case.
- 19 browser checks pass in Chromium over HTTP with mocked providers, including the new cue-sheet download (the actual Blob parsed as CSV) and the separate light/dark style fields in Settings. The three-button inspector footer was inspected at 390px and does not overflow.
- Cue-sheet output was inspected directly: a counter-clockwise rectangle yields three correct left turns with headings 90/0/270/180, monotonic distances and simulated elapsed times.
- **Not verified here:** live basemap style switching. This sandbox's browser disables WebGL, so MapLibre never initializes and no OpenFreeMap style or tile request is made; the labeled coordinate canvas is used instead. Confirm the dark basemap against a WebGL-enabled browser in the acceptance checklist.
