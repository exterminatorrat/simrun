# Implementation plan — sharing, offline, mobile and provider options

Concrete, file-and-function-level plan for cluster 04 on the current strict-TypeScript, dependency-free app. This is a planning artifact that records the design and what already landed; it is not a second implementation.

## Status

Landed: geometry-only share links with a copy fallback and privacy note (`src/share.ts`, share dialog in `public/index.html` and `src/main.ts`), the printable cue sheet (`#print-sheet` + print stylesheet), shared-link intake through `importedActivity`, the PWA manifest (`public/manifest.json` + `<link rel="manifest">`), and default-off avoid-highways/avoid-hills routing options (`src/providers.ts`).

Remaining: QR rendering, route-corridor tile download, the opt-in offline routing cache, alternate-route requests, and install/offline UI polish.

## Architecture and ownership

- `src/share.ts` (exists) owns the codec; `src/offline.ts` (to add) owns tile maths; `src/providers.ts` owns request shaping; `public/sw.js` owns caches; `src/main.ts` wires UI.
- No backend, secrets or analytics. New network behaviour is user-initiated, capped, abortable and reuses the existing provider queue.

## Remaining work

### 1. QR rendering

- Vendor a single-file MIT QR encoder through `scripts/vendor.mjs` (pinned version, recorded in `THIRD_PARTY_NOTICES.md`), or render nothing and keep the GPX fallback when absent.
- `shareWarning` (exists) already distinguishes the QR cap (`QR_CHAR_LIMIT = 2000`) from the length warning (`SHARE_WARN_CHARS = 8000`); gate the QR panel on it.
- Verify: a share URL under the cap renders a scannable SVG; over the cap the panel is replaced by the "export GPX instead" note.

### 2. Route-corridor tile download

- Add `src/offline.ts`: `lon2tile`, `lat2tile`, `tileRange(bounds,zoom)`, `corridorTiles(path, bufferMeters, zoom, maxTiles)` using `Preferences.corridorZoom` (clamped 8–14) and an explicit per-route tile cap.
- Download sequentially with progress, cancellation and a storage count; store in a separate service-worker cache (`simrun-corridor-v1`) that ordinary basemap trimming never evicts.
- Verify tile maths and caps in `tests/corridor.test.mjs`; verify bounds and abort in the browser harness.

### 3. Opt-in offline routing/elevation cache

- Honour `Preferences.offlineRouting` (default off). Network-first: always contact the provider online; use a cached reply only as fallback.
- Cache key is the request URL; cap 50 entries and 30 days; label cache hits in the UI and never fabricate a route or elevation.
- Verify: preference validation, expiry and the "cached" label; no new online requests when disabled.

### 4. Alternate route requests

- Add one optional alternate for cycling, requested only when a user enables it and the estimated route distance is under 60 km; fetch elevation only for the selected alternative.
- Request shape: Valhalla `alternates` on the existing `route()` call; keep single-retry and queue behaviour.
- Verify the request body with a mocked provider and confirm elevation is fetched once for the chosen route.

### 5. Install and touch polish

- Surface `beforeinstallprompt` when available; otherwise show platform instructions. Enforce ≥44 px coarse-pointer controls in `public/app.css`.
- Verify the manifest is precached by the shell build and the coarse-pointer targets meet the minimum.

## Verification commands

`npm test` (adds `tests/corridor.test.mjs` and share/offline cases), `npm run typecheck`, and `python tests/browser.py --url <preview>` or the agent-browser CLI for share round-trips, QR states, print layout, mocked corridor downloads and offline cache labelling.
