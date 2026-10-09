# Cluster 04 — Sharing & printable cue sheets, offline & mobile, provider profiles & alternatives

Plans for three features of SimRun (local-first route editor, explicitly simulated GPX activity studio), grounded in the current code on branch `hoplite/lilaia-d62e62ed`: native strict TypeScript/DOM, ES modules, no framework, single dev dependency (TypeScript 5.8.3), static deploy of `dist/` on Vercel, `npm test` = `npm run build && node --test tests/*.test.mjs`.

Standing constraints honored throughout:

- No backend, no secrets, no analytics; routing/elevation/search go only to user-configured HTTPS endpoints (`endpoint()` in `src/providers.ts`).
- Public FOSSGIS Valhalla caps: ~100 km pedestrian / ~150 km bicycle (`docs/SELF-HOST-VALHALLA.md`); community services are never load-tested; Nominatim stays opt-in.
- Routing, elevation and search are deliberately never cached by the service worker today (`public/sw.js`); anything that changes this must be explicit, bounded, and opt-in.
- "Simulated, not measured" labeling and provider etiquette are preserved (per-feature notes below).

---

## Feature 1 — Route-in-URL sharing, QR code, printable cue-sheet snapshot

### Goals

1. Share a route as a self-contained URL (hash fragment only) that any recipient's SimRun opens locally — no server, no shortener, no upload.
2. Render a QR code of that URL fully client-side so the link can cross to a phone without any network service.
3. Produce a printable one-page cue sheet: activity summary, turn list, and a route sketch.

### Non-goals

- No server-side shortening, no "share" tracking, no cloud copy of the route.
- No raster-basemap snapshot in the printout: OpenFreeMap styles are vector tiles and cannot be rasterized without a GL context; the print sheet shows a labeled SVG route sketch instead (same honesty as the coordinate-canvas fallback in `src/map.ts`). MapLibre canvas export (`preserveBuffer`) is explicitly not pursued: it is renderer-dependent and fails on the coordinate-canvas fallback path.
- No lossless timing/HR transfer: the recipient re-simulates with their own settings; only geometry and sport travel in the URL.
- No editing of the shared payload before decoding; the recipient gets retained geometry they can convert with the existing `edit-import` flow.

### Design

**Payload location.** The route lives in the URL fragment (`#r=…`), which browsers never send to the server — a hard guarantee on a static host (`vercel.json` serves `dist/` statically). Coordinates still land in browser history on both ends; the UI states this plainly.

**Encoding.** A new `encodePolyline(path:Point[],precision=1e5):string` is added to `src/geometry.ts` next to the existing `decodePolyline` (`src/geometry.ts:94`), reusing its delta/varint algorithm with 1e5 precision (~1.1 m) to keep URLs short; `decodePolyline` gains an optional `precision=1e6` parameter so every existing caller and test stays byte-identical. New module `src/share.ts`:

```ts
export const SHARE_MAX_CHARS = 8000;    // warn above this
export const SHARE_QR_MAX_CHARS = 2000; // conservative QR ceiling (v40-L ≈ 2953 bytes)
export const SHARE_MAX_POINTS = 20000;
export interface SharePayload { version:1; sport:Sport; path:Point[]; waypoints:Point[] }
export interface ShareLink { url:string; chars:number; qrFits:boolean; capped:boolean }
export function encodeShare(a:Activity):string;              // "1.<poly path>.<poly waypoints>.<run|ride>"
export function decodeShare(payload:string):SharePayload;    // validates every point via validPoint(), caps via existing limits
export function shareLink(a:Activity,origin:string):ShareLink; // origin+pathname+"#r="+payload
```

Binary payload is base64url (no `+ / =`, URL-safe without escaping). Sport is carried because it drives pedestrian/bicycle costing on intake; the activity name and all timing are excluded by default (privacy by omission). Validation mirrors `validateActivity` bounds (`src/model.ts`): every point through `validPoint` (`src/geometry.ts:5`), path ≤ `SHARE_MAX_POINTS`, rejection throws with a user-facing message.

**Intake.** `src/main.ts` initialization (after the existing draft-restore block at the bottom of the file): if `location.hash` starts with `#r=`, decode and load through the existing `importedActivity(path,'Shared route','')` (`src/model.ts`), so the recipient sees the established honest notices ("Geometry retained. Exports are explicitly resimulated, not original recordings."), then `map.fit()` and a toast: "Shared route loaded — it contains coordinates only; timing is re-simulated locally." Invalid payloads show a non-fatal toast and leave the normal empty state.

**Share dialog.** A `Share` button joins the top-actions nav in `public/index.html` (next to `#import`, `#history`, `#settings`), opening a new `<dialog id="share-dialog">` in the style of `#settings-dialog`: the generated URL with its exact character count, a Copy button (`navigator.clipboard.writeText` with a `document.execCommand('copy')` fallback behind a try/catch, matching the defensive style of `src/ui.ts`), an inline QR rendered as SVG, and two honest notes: (1) "The link contains your route's coordinates. Anyone who has it can read the route, and browsers keep it in history." (2) A QR-disabled state with the reason when the URL exceeds the QR budget, plus "Export GPX instead" wired to the existing `download` helper (`src/gpx.ts:20`).

**QR generation.** Vendor a single-file MIT QR encoder into `public/vendor/qr.min.js` (added to `scripts/vendor.mjs` alongside the pinned MapLibre bundle, with license note in `THIRD_PARTY_NOTICES.md`). `scripts/build.mjs` already walks `public/` for the precache manifest (`scripts/build.mjs` walk + `sw-manifest.json`), so the vendored file is precached with no build changes. The plan pins the library choice at implementation time to the smallest maintained single-file encoder with an SVG output path; no npm runtime dependency is added.

**Printable cue sheet.** New `src/print.ts` renders a hidden `#print-sheet` section appended to `<body>`:

* header: activity name, sport, start date/time honoring `startTime()`/UTC offset (`src/model.ts`);
* summary row: distance, simulated elapsed duration, gain — using the same unit helpers as `render()` in `src/main.ts` (`distanceValue`, `heightValue`);
* cue table from `cues()` (`src/cues.ts:26`) with the same column semantics as `cueSheetCSV` (`src/cues.ts:64`) and the same disclaimer text: turns come from route geometry, activity is simulated;
* route sketch: inline SVG projecting the path with the same `world()` Web-Mercator helper used by the fallback canvas (`src/map.ts`), orange route line, start/finish marks, no basemap claim;
* footer: the share URL (when short enough) and its QR.

A `Print` button (`on('print', …)` in `src/main.ts`) populates the sheet and calls `window.print()` after passing the same `validRoute()` guard used by `#cues` and `#export`. `public/app.css` gains a `@media print` block hiding the workspace and showing `#print-sheet`, reusing existing theme variables so the dark theme prints legibly.

### Files and functions

| File | Change |
| --- | --- |
| `src/geometry.ts` | add `encodePolyline`; optional `precision` arg on `decodePolyline` (default unchanged at 1e6) |
| `src/share.ts` | new: `encodeShare`, `decodeShare`, `shareLink`, `SHARE_*` constants |
| `src/print.ts` | new: `renderPrintSheet(a,sim,preferences,share?)` |
| `src/main.ts` | `#r=` intake at init; `on('share')`, `on('print')` handlers; share-dialog wiring |
| `src/types.ts` | add `SharePayload`, `ShareLink` (or keep them local to `src/share.ts`) |
| `public/index.html` | share button, `#share-dialog`, `#print-sheet` host, manifest note |
| `public/app.css` | share dialog styles + `@media print` block |
| `public/vendor/qr.min.js` | vendored encoder |
| `scripts/vendor.mjs` | fetch/verify the QR vendor file |
| `THIRD_PARTY_NOTICES.md` | QR library license entry |
| `tests/share.test.mjs` | new Node tests |
| `tests/browser.py` | share + print cases |

### Milestones (each with verification)

1. **Payload codec.** Implement `encodePolyline`, `src/share.ts`, and `tests/share.test.mjs`. Verify: `npm test` — round-trip on a 200-point loop matches the source path to 1e5; sport passes through; oversized payloads (`SHARE_MAX_POINTS+1`) and malformed base64 throw with the intended messages; `qrFits` is true for a ~5 km route and false for a 20,000-point import.
2. **Intake + dialog.** Hash parsing on boot, share button/dialog wiring. Verify: `tests/browser.py` imports the existing GPX fixture, opens the dialog, asserts the URL form `…/#r=1.` and its length readout; a second browser context navigates to the copied URL and asserts the loaded activity's `#distance` matches the original within rounding; `window.testRequests` shows no provider calls during share/intake.
3. **QR.** Vendor the encoder, render SVG, disable-with-reason when `!qrFits`. Verify: browser case asserts `#share-qr svg` exists for the fixture and shows the disabled explanation after forcing a >2000-char payload via `page.evaluate`; screenshot `share-qr`.
4. **Print sheet.** `src/print.ts` + CSS + button. Verify: browser case emulates print media, asserts `#print-sheet` visible with cue-row count equal to `cues()` output computed in the test, disclaimer text present, `screenshot(page,'print-cue-sheet')`; desktop screenshot shows the app unchanged.
5. **Docs.** README "Share a route" section; two new items in `docs/ACCEPTANCE.md` (share round-trip on the deployed origin; printed sheet layout on A4). Verify: docs review; checklist numbers added.

### Testing strategy

- `tests/share.test.mjs` (Node): codec round-trip, precision rounding, point validation, caps, base64url alphabet safety (no `+ / =` in the URL), sport round-trip, `qrFits` boundary.
- `tests/browser.py` additions: `test_share_url_roundtrip_and_qr` (fixture → dialog → second context → distance equality; QR svg present) and `test_printable_cue_sheet` (print emulation, row count, disclaimer, screenshots). Both reuse the existing mock (`window.testRequests`) so no real provider is touched.

### Risks and limitations

- **URL length:** dense geometry can exceed what chat/SMS apps preserve; the dialog shows the count, disables QR beyond ~2000 chars with an explanation, and offers GPX export as the fallback. Decoded routes above `SHARE_MAX_POINTS` are rejected with a clear message rather than silently truncated.
- **Privacy:** `#` fragments are not transmitted, but the URL persists in sender/receiver history and any copy-paste. Mitigations: no name/timing/HR in the payload, explicit warning text, and no `localStorage` retention of share URLs.
- **QR library risk:** QR encoders are subtle (masking, ECC levels); vendoring a battle-tested library and pinning it like MapLibre (hash-verified in `scripts/vendor.mjs`) avoids a hand-rolled encoder.
- **Print fidelity:** browsers differ on print CSS; the sheet uses a single-column flow layout and avoids paged-media features beyond `@media print`.

### Effort estimate

~3–4 days total: codec 1 d, UI/dialog + intake 1 d, QR 0.5 d, print sheet + CSS 1 d, docs 0.5 d.

### Honesty and etiquette

- Zero new network calls; everything is local computation.
- Recipient re-simulation is explicit; the share dialog and print sheet both carry the "simulated, not measured" framing, and the printed sheet states turns are derived from geometry, not street names.
- No provider hosts are contacted by share/intake/print flows (asserted by the browser tests via `window.testRequests`).

---

## Feature 2 — Offline & mobile: corridor tiles, opt-in offline routing cache, PWA install, touch targets

### Goals

1. Let a user deliberately download the basemap *corridor* along a route, so the map works offline along a planned activity — not only in areas stumbled across.
2. Opt-in caching of routing/elevation *responses* used only as an offline fallback (network-first semantics preserved online).
3. PWA installability (manifest + install entry point) with honest handling of platforms that never fire `beforeinstallprompt`.
4. ≥44 px touch targets for interactive controls on coarse-pointer devices.

### Non-goals

- No background/scheduled sync, no "download everywhere I go" automation, no GPS-triggered prefetch.
- No offline basemap *style* bundling: glyphs are fetched per text+range at render time and cannot be enumerated ahead; the docs will state that label glyphs may still be missing offline even with a full corridor.
- No offline geocoding, no offline re-routing engine, no fabricated elevation: if the route cache misses offline, routing fails with the existing message and the last good path stays editable.
- No change to the rule that routing/elevation/search are never *silently* cached — the new cache is opt-in, labeled, and visible in Settings.

### Design

**Preferences** (all optional-compatible with stored prefs; `src/types.ts:20` `Preferences`):

```ts
export interface Preferences {
  units:'metric'|'imperial'; theme:'light'|'dark'; mapStyle:string; mapStyleDark:string;
  routingUrl:string; elevationUrl:string; geocodingUrl:string; geocodingEnabled:boolean;
  offlineRouting:boolean;   // opt-in route/elevation offline cache, default false
  corridorZoom:number;      // 8–14, clamped, default 12
}
```

`validatePreferences` (`src/storage.ts:6-13`) gains `offlineRouting:p.offlineRouting===true` and a clamped numeric `corridorZoom`, following the existing normalization style. Settings gains two controls in the existing "Offline map data" fieldset (the one containing `#offline-status` and `#offline-clear`).

**Corridor math.** New pure module `src/offline.ts`:

```ts
export interface TileSpec { z:number; x:number; y:number }
export interface Corridor { tiles:TileSpec[]; capped:boolean }
export function corridorTiles(path:Point[],maxZoom:number,corridorMeters=400,perZoomCap=400):Corridor
export function tilesToUrls(templates:string[],corridor:Corridor):string[]
```

- Reuses the map's mercator projection: move `world()`/`unworld()` from `src/map.ts` into `src/geometry.ts` and import from both places (the only shared-code refactor in this cluster).
- For each route segment, buffer the segment bbox by the corridor width (converted to degrees at the segment's mean latitude), accumulate slippy-tile indices for z = 8…maxZoom, and stop adding zooms above the cap, reporting `capped`. Per-segment (not whole-route) bboxes avoid over-fetching on long diagonal routes.
- `tilesToUrls` substitutes `{z}/{x}/{y}` (and `{ratio}` if present) directly into the `sources[*].tiles` templates read from the fetched style JSON — the same strings MapLibre itself requests, which is what makes the cached entries hit on the later fetch.

**Download flow (service worker).** New messages over the established `MessageChannel` plumbing in `src/sw.ts` (`ask()` helper, 4 s timeout) and `public/sw.js` (`message` handler at `public/sw.js:93`):

```ts
// src/sw.ts additions
export interface CorridorProgress { done:number; total:number }
export function downloadCorridor(urls:string[],limit:number,
  onProgress:(p:CorridorProgress)=>void,signal:AbortSignal):Promise<{cached:number;capped:boolean}>;
export function clearCorridorCache():Promise<boolean>;
export interface CacheStatus { shell:number; map:number; corridor:number; limit:number }
```

- New cache `simrun-corridor-v1`, deliberately separate from the viewed-tiles cache `simrun-map-v1` (`public/sw.js:26`): corridor tiles are a deliberate asset and must not be silently trimmed by casual browsing (`trim()` at `public/sw.js:61` keeps applying only to `simrun-map-v1`).
- The SW receives `{type:'simrun-download-corridor',urls,limit}` and fetches strictly sequentially, `cache.put`-ing into `simrun-corridor-v1`, posting `{done,total}` on the MessageChannel port; an `{type:'simrun-download-abort'}` message stops it. A hard entry cap bounds the cache; it is cleared as a unit by `simrun-clear-corridor`.
- Fetch handler lookup order becomes: corridor cache → `simrun-map-v1` (`basemap()`) → network. Host restriction stays exactly `tiles.openfreemap.org` (`MAP_HOST`, `public/sw.js:27`).
- `CacheStatus` grows `corridor:number` and the UI shows both counts plus `navigator.storage.estimate()` where available.

**Opt-in offline routing/elevation cache.** Service workers cannot read `localStorage`, so the opt-in flag travels by message and persists in a one-entry marker cache (`simrun-route-meta-v1`):

- `main.ts` posts `{type:'simrun-route-cache',enabled:boolean}` whenever `preferences.offlineRouting` changes and on SW `controllerchange`.
- When enabled, the SW's `fetch` handler additionally intercepts GETs to the routing/elevation host (pathname ends with `/route` or `/height`, URL carries a `json` search param) with **network-first** behavior: online requests always go to the provider — the cache only answers when the network fails, so online provider traffic is unchanged and never amplified.
- Cache `simrun-route-v1`, keyed by the existing djb2 `digest` (`public/sw.js:32`) over the canonical JSON of `{locations,costing,units,shape,alternates}`; entries carry an `x-simrun-cached-at` header, expire after 30 days, and are capped at 50 entries with oldest-first eviction (mirroring `trim()`).
- The SW stamps cache hits with `x-simrun-cached-at`; `Editor.recalculate()` (`src/editor.ts`) detects the header is impossible client-side, so instead the *response status label* comes from the SW: the intercepted response gets header `x-simrun-cache: hit`, and `main.ts` reads it to append "· cached offline reply" to `route-status`. The honesty chain stays intact: geometry is still the provider's real answer, only its delivery was cached, and elevation from cache is labeled the same way.

**PWA install.**

- New `public/manifest.webmanifest`: `name/short_name "SimRun"`, `start_url:"./"`, `scope:"./"`, `display:"standalone"`, `background_color:"#f8f9f8"` / `theme_color:"#f8f9f8"` (matching the existing `<meta name="theme-color">`), icons: existing `favicon.png`, `apple-touch-icon.png`, plus one new 512 px PNG generated from `mark.jpg` at implementation time. `scripts/build.mjs` already precaches everything under `public/`, so the manifest is offline-safe with no build changes.
- `public/index.html` gains `<link rel="manifest" href="./manifest.webmanifest">`.
- `src/main.ts` listens for `beforeinstallprompt`, prevents the default banner, and reveals an "Install SimRun" button in the settings offline fieldset (`#pwa-install`). On platforms without the event (iOS Safari) the button is replaced by honest static instructions rather than a dead control. The `appinstalled` event triggers a one-time toast.

**Mobile touch targets.** `public/app.css` gains a `@media (pointer:coarse)` block enforcing ≥44×44 px hit areas on `.map-tools button`, `.top-actions button`, `.waypoint-row button`, `#search-submit`, `.history-row button`, dialog action buttons, and the sport switch — plus slightly larger tap highlights. Desktop layout is untouched.

### Files and functions

| File | Change |
| --- | --- |
| `src/types.ts` | `Preferences.offlineRouting`, `Preferences.corridorZoom` |
| `src/storage.ts` | `validatePreferences` handles both keys |
| `src/offline.ts` | new: `corridorTiles`, `tilesToUrls` |
| `src/geometry.ts` | absorbs `world()`/`unworld()` from `src/map.ts` |
| `src/sw.ts` | `CacheStatus` + `corridor`; `downloadCorridor`, `clearCorridorCache` |
| `public/sw.js` | `simrun-corridor-v1` cache, download loop + progress + abort messages, corridor-first lookup, opt-in `simrun-route-v1` network-first interception, `simrun-clear-corridor` |
| `src/main.ts` | settings wiring (corridor button, zoom select, offlineRouting sync), abort-on-activity-change hook, `beforeinstallprompt`/`appinstalled` |
| `public/index.html` | corridor controls in the offline fieldset, zoom select, install button, manifest `<link>` |
| `public/app.css` | coarse-pointer target sizes |
| `public/manifest.webmanifest`, `public/icon-512.png` | new |
| `site-manifest.json` | `persistence` and `externalServices` entries updated |
| `tests/offline-corridor.test.mjs`, `tests/prefs-offline.test.mjs` | new |
| `tests/offline.test.mjs` | extended SW source assertions |
| `tests/browser.py` | corridor, offline-route-cache, touch-target cases |

### Milestones (each with verification)

1. **Prefs + validation.** Add both preference keys, validation, defaults. Verify: new `tests/prefs-offline.test.mjs` — default `offlineRouting:false`, `corridorZoom` clamps 8–14, `parseBackup` round-trips and drops unknown keys (pattern already proven in `tests/providers.test.mjs`); full `npm test` green.
2. **Corridor math.** `src/offline.ts` + `tests/offline-corridor.test.mjs`. Verify: `npm test` — for a synthetic 100 km diagonal route, assert z=8–12 tile sets cover the buffered bbox, union across segments beats whole-route bbox on the diagonal, `capped` triggers above `perZoomCap`, and generated URLs byte-match hand-substituted templates.
3. **SW download loop.** Corridor cache, sequential fetcher, progress/abort messages, cache-first lookup order. Verify: extend `tests/offline.test.mjs` with source-level assertions in the repo's established regex style (worker fetches only style-host URLs, writes to `simrun-corridor-v1`, honors abort, lookup order corridor→map→network); `npm test`.
4. **UI wiring.** Corridor button + progress + cancel + status counts. Verify: `tests/browser.py` — with `tiles.openfreemap.org` mocked via `page.route` (tiny 200 bodies; bytes are cached verbatim, no rendering needed), import fixture → click corridor download → assert progress messages land and `offlineStatus()` reports `corridor > 0`, then screenshot; separately assert the button is disabled for draft routes.
5. **Offline routing cache.** Flag message + network-first interception + labeling. Verify: node source tests assert the intercept is gated on the flag cache and never rewrites responses without the cache-header; browser case enables the pref, routes once online, then `context.set_offline(True)` + reload asserts the route re-resolves from cache with the "cached" label; if SW control proves flaky under Playwright, keep the node-level tests and document the browser case as a manual step in `docs/VERIFICATION.md` (the repo already documents such limits, e.g. WebGL unavailability).
6. **PWA install.** Manifest, meta tags, install entry point. Verify: browser case fetches `manifest.webmanifest` (200, valid JSON, icons resolve 200), asserts the `#pwa-install` control only appears when a `beforeinstallprompt` is dispatched via `page.evaluate`; actual OS-level install stays a documented manual step.
7. **Touch targets.** CSS block + verification. Verify: browser case at 390×844 evaluates `getBoundingClientRect()` for every coarse-target selector and asserts ≥44 px in both axes; screenshot `mobile-touch-targets`.

### Testing strategy

- `tests/prefs-offline.test.mjs`: preference defaults/validation/backup sanitization.
- `tests/offline-corridor.test.mjs`: pure corridor math (tile counts, caps, URL templating) — no DOM, no network.
- `tests/offline.test.mjs` (extended): SW source assertions for the corridor cache, lookup order, opt-in gating of the route-cache intercept, and that routing/elevation hosts are *never* intercepted when the flag is off.
- `tests/browser.py`: corridor download with mocked tiles; offline route-cache rescue with the mock Valhalla; coarse-pointer size assertions; all provider traffic mocked, consistent with the "never load-test community endpoints" rule in `docs/ACCEPTANCE.md`.

### Risks and limitations

- **Cache eviction:** the viewed-tiles cache (`simrun-map-v1`, 1,500 entries, `MAP_LIMIT` at `public/sw.js:28`) is intentionally *not* enlarged; corridor tiles live in their own capped cache and are never silently trimmed — the tradeoff (disk use vs. deliberate persistence) is stated in Settings copy.
- **URL mismatch:** tile URLs are built from the style's own `tiles` templates so later MapLibre requests hit the same cache keys; templates requiring per-request tokens are unsupported and the corridor button disables with a message for such styles.
- **Storage pressure:** caps are entry-based (corridor limit chosen to keep the download and cache well under typical quota); `storage.estimate()` is surfaced so users see reality.
- **Provider etiquette:** corridor download is user-initiated, sequential, abortable, and announces its request count before starting; aborting on route change is wired into the editor's change path. Style JSON/sprite fetches are one-shot per download; glyph gaps offline are documented rather than hidden.
- **Offline routing cache is not a routing substitute:** it returns the *same* response the provider gave earlier, labeled as cached; it never fabricates geometry, and it never sends extra requests online (network-first).

### Effort estimate

~6–8 days: prefs/types 0.5 d, corridor math + tests 1.5 d, SW download/lookup/eviction 2 d, settings UI + progress/cancel 1.5 d, offline routing cache 1.5 d, PWA 0.5 d, touch targets 0.5 d, docs + verification checklist 0.5–1 d.

### Honesty and etiquette

- Settings copy states exactly what is cached (viewed tiles vs. downloaded corridor vs. route replies), how many entries, and that providers are never asked twice online because of the cache.
- The printed/exported artifacts keep their existing disclaimers; nothing about simulation semantics changes offline — cached routing results are labeled, elevation gaps remain "no climbing is invented," and GPX exports stay explicitly resimulated.

---

## Feature 3 — Provider work: profiles (walk/hike/MTB), avoid options, alternatives, public-cap handling

### Goals

1. First-class routing profiles beyond the implicit run/ride mapping: `walk`, `hike`, `road`, `mtb` — stored per activity and sent as correct Valhalla costing.
2. Bounded "avoid" options (avoid highways, prefer flat) mapped to documented Valhalla costing options.
3. Optional route alternatives: request one alternate, let the user pick, keep the chosen geometry.
4. Convert the public Valhalla distance-cap failure (`HTTP 400`, `error_code 154` per `docs/SELF-HOST-VALHALLA.md`) into a precise, actionable message, and keep the self-host path (`docs/SELF-HOST-VALHALLA.md`) as the documented escalation.

### Non-goals

- No automobile costing, no `max_distance` request overrides (the server's `service_limits` wins, as the self-host doc records).
- No client-side route splitting to evade public caps: silently issuing two provider requests would double the etiquette footprint and produce a synthetic waypoint seam; instead the cap is explained and self-hosting is pointed to.
- No automatic alternatives on every route: alternatives cost the shared service extra geometry work, so they are opt-in and distance-gated.
- No provider-side "avoid polygon" drawing UI in this iteration; avoid options are limited to documented per-costing toggles.

### Design

**Types** (`src/types.ts`):

```ts
export type RouteProfile = 'walk'|'hike'|'road'|'mtb';
export interface Settings { /* existing fields */
  profile?:RouteProfile;   // optional: v1 activities without it behave exactly as today
}
export interface Preferences { /* existing fields */
  routeAlternatives:boolean; // default false
  avoidHighways:boolean;     // default false (bicycle costing)
  avoidHills:boolean;        // default false (pedestrian/bicycle costing)
}
```

`validateSettings` (`src/model.ts`) accepts `profile` only as the four values or `undefined`; `defaultPreferences` (`src/model.ts:8`) gains the three booleans as `false`. Because `Settings.profile` is optional, every existing stored activity and the existing `validateSettings` test surface remain valid unchanged.

**Profile mapping** (new `PROFILE_OPTIONS` table in `src/providers.ts`, next to `ValhallaProvider.route`):

| profile | costing | costing_options |
| --- | --- | --- |
| `walk` | `pedestrian` | — (identical to today) |
| `hike` | `pedestrian` | `type:'hiking'`, `use_hills` per avoid pref |
| `road` | `bicycle` | `bicycle_type:'Hybrid'` |
| `mtb` | `bicycle` | `bicycle_type:'Mountain'`, `use_roads` lowered |

**Verification note for implementation:** the exact `costing_options` keys must be pinned against the Valhalla documentation for the version FOSSGIS runs before milestone 1 is accepted; the node tests assert the exact JSON body, so a silent upstream key change fails tests instead of silently changing routes. `docs/SELF-HOST-VALHALLA.md` gains the profile→options table.

**Request changes in `ValhallaProvider.route`:** resolve the effective profile as `activity.settings.profile ?? (sport==='run' ? 'walk' : 'road')`, look up `costing`/`costing_options` from `PROFILE_OPTIONS`, apply avoid flags, and include `alternates:1` only when the caller requested alternatives (below). The response parsing splits into: primary trip legs (existing code path, unchanged) plus optional `trip.alternates[]` entries, each decoded with the existing `decodePolyline`.

**Public-cap handling.** In `getJSON` (`src/providers.ts`), the current HTTP-400 branch throws the generic "No suitable route…" message. Extend it to parse the body once: when `error_code === 154` or the body matches `max distance limit`, throw `new ProviderError('Public Valhalla caps pedestrian routes at about 100 km and bicycle at 150 km. Shorten the route, or self-host Valhalla — see Settings → Open service endpoints and docs/SELF-HOST-VALHALLA.md.', 400, 'distance-cap')`. `ProviderError` gains an optional `code` field; `Editor.recalculate()` surfaces `ProviderError` messages verbatim (it already shows `error.message` via `onMessage`). A soft pre-flight hint is added in the Editor: sum haversine `distance()` (`src/geometry.ts:6`) over `activity.waypoints`; when it exceeds 0.8× the profile cap (80 km walk/hike, 120 km ride/mtb), the status line warns *before* the request fires that the public service will likely refuse it — the request still goes out once, so behavior stays honest and the estimate never blocks a legitimate route.

**Alternatives.**

```ts
export interface RouteResult { path:Point[]; alternates:Point[][] }
// RoutingProvider gains one method (default throws ProviderError('Alternatives unavailable.')):
routeAlternatives(points:Point[],sport:Sport,profile:RouteProfile,signal:AbortSignal):Promise<RouteResult>
```

- `Editor.recalculate()` calls `routeWithAlternatives` only when `preferences.routeAlternatives` is enabled **and** the pre-flight estimate is under 60 km; otherwise the existing single-route call runs and the request shape is byte-identical to today (guarded by the existing provider tests).
- The provider sends `alternates:1` (two routes total — deliberately one extra, not more, to keep the shared-service footprint small) and parses `trip.alternates`.
- The Editor stores `alternates:Point[][]` (not persisted into the activity; a reload keeps only the chosen path), exposes `chooseAlternate(i)`, and applies elevation only to the chosen path — alternates never trigger elevation requests, so picking one triggers exactly one elevation call for the selected geometry.
- UI: an `#alternates` row above `#route-status` (`public/index.html`) renders chips "Route A · 12.4 km" / "Route B · 13.1 km" (distance from `cumulative()`, the same math the summary already uses); clicking a chip calls `editor.chooseAlternate(i)`; a toast notes "Timing will be re-simulated for the chosen route."
- Avoid options: `avoidHighways` maps to the bicycle costing's documented road-class avoidance option, `avoidHills` maps to the pedestrian/bicycle hill-avoidance option; both are sent only when enabled, and both are included in the node-level request assertions.

**Settings UI.** In `public/index.html`'s settings dialog: a "Routing profile" select (`walk`/`hike`/`road`/`mtb`) next to the existing run/ride switch semantics — per-activity profile lives in `Settings` (so it is saved, exported and re-simulated with the activity), while `routeAlternatives`/`avoid*` live in `Preferences` (global, default-off). The sport switch continues to work exactly as today for activities without an explicit profile.

**Docs.** `README.md` provider section and `docs/SELF-HOST-VALHALLA.md` gain: profile table, avoid options, the 154-cap behavior, and a note that self-hosting raises the caps for all profiles while the app's own ceilings (`MAX_LOOP_*`, 50 waypoints, 100,000 points in `src/model.ts`) still apply.

### Files and functions

| File | Change |
| --- | --- |
| `src/types.ts` | `RouteProfile`; optional `Settings.profile`; 3 new `Preferences` booleans |
| `src/providers.ts` | `PROFILE_OPTIONS`, `RouteResult`, `routeWithAlternatives` on `RoutingProvider` + `ValhallaProvider`, `alternates` request field, 400/154 parsing in `getJSON`, `ProviderError.code` |
| `src/model.ts` | `validateSettings` accepts/validates `profile`; `defaultPreferences` + 3 booleans; `PROFILE_CAPS` export |
| `src/editor.ts` | `recalculate()` uses profile + alternatives path; `alternates` state; `chooseAlternate(i)`; elevation only for chosen path |
| `src/main.ts` | profile select + avoid checkboxes wiring, `#alternates` chips, cap-warning status hook |
| `public/index.html` | profile select, avoid checkboxes, `#alternates` row |
| `public/app.css` | chips + select styles |
| `docs/SELF-HOST-VALHALLA.md`, `README.md`, `docs/ACCEPTANCE.md` | profile/avoid/alternates/cap documentation |
| `tests/providers.test.mjs`, `tests/model.test.mjs` (new or extended) | new cases below |
| `tests/browser.py` | profile/alternatives/cap-message cases |

### Milestones (each with verification)

1. **Profiles.** `PROFILE_OPTIONS`, request mapping, `Settings.profile` validation, default fallbacks. Verify: extend `tests/providers.test.mjs` with mocked-fetch cases asserting the exact request JSON for all four profiles; the existing run→`pedestrian` / ride→`bicycle` test must pass unmodified (default profile path). `npm test`.
2. **Cap message.** 400-body parsing + pre-flight estimate. Verify: node test mocks `error_code:154` → asserts the friendly message and `code:'distance-cap'`; a plain 400 without the marker keeps today's message; unit tests for the 0.8× threshold logic. `npm test`.
3. **Avoid options.** Two preferences + JSON mapping. Verify: node tests assert `use_hills`/road-class options appear only when enabled; browser case toggles a checkbox and inspects `window.testRequests`.
4. **Alternatives.** Provider parsing, Editor state, UI chips. Verify: node test decodes an `alternates` payload into two paths; browser test (existing Valhalla mock in `tests/browser.py` extended to return alternates) asserts exactly one `/route` request per recalculation, chips render with distances, clicking a chip swaps `#distance` and triggers exactly one `/height` request; `npm test` and browser run green.
5. **Docs + acceptance.** Update `docs/SELF-HOST-VALHALLA.md` (profile table incl. self-host behavior), `README.md` provider section, `docs/ACCEPTANCE.md` items (profile switch sends expected costing; alternatives default-off; 154 message). Verify: docs review + live checklist drafted for the private preview.

### Testing strategy

- `tests/providers.test.mjs` (extends the existing file, same `globalThis.fetch` override pattern — zero real requests): profile→costing matrix; avoid-option presence/absence; `alternates` flag only when requested; `trip.alternates` parsing; `error_code:154` friendly message; plain 400 keeps the existing message; no more than one request per invocation even with retries (existing `429` test style).
- `tests/model.test.mjs` (new): `profile` validation (four values + undefined), `defaultPreferences` flags false, `PROFILE_CAPS` constants match `docs/SELF-HOST-VALHALLA.md` numbers.
- `tests/browser.py` additions: MTB profile → assert last mocked `/route` request carries `bicycle_type:'Mountain'`; alternatives off by default (no `alternates` key in `window.testRequests`); cap toast text via a mocked 154 response; profile selector visible and keyboard-reachable at 390×844 (ties into the touch-target work).

### Risks and limitations

- **Provider policy:** alternatives add response weight and elevation follows only for the chosen route; mitigations: opt-in pref, <60 km gate, single `alternates:1`, no elevation for unpicked alternates, everything flows through the existing 1.2 s per-host queue and single-retry logic (`rateSlot`/`getJSON` in `src/providers.ts`).
- **API drift:** unknown `costing_options` keys are silently ignored by Valhalla; node tests pin the exact request JSON so regressions are caught without touching the public service.
- **Caps are server-side:** the 0.8× pre-flight hint is advisory; straight-line distance underestimates road distance, so the message says "likely", and the 154 response remains the authoritative failure with a pointer to self-hosting.
- **UX:** profile changes trigger recalculation like sport changes do (via `Editor.changeSettings`), so mixed-profile editing costs one request per change — acceptable and consistent with the current debounce/recalc design.

### Effort estimate

~4–5 days: profile plumbing + validation + tests 1.5 d, 154 parsing + pre-flight 0.5 d, avoid options 0.5 d, alternatives end-to-end 1.5 d, docs/acceptance 0.5 d, buffer 0.5–1 d.

### Honesty and etiquette

- Swapping profile or picking an alternative changes geometry, so timing is re-simulated and labeled as such; nothing presents provider metadata as measured data.
- The 154 message names the *public service's* limits and points at `docs/SELF-HOST-VALHALLA.md` instead of implying the app can raise them; no retry hammering on 400s (no retry on 4xx today, unchanged).
- Alternatives and avoid options default off; every new request class is user-initiated, abortable, and passes through the existing per-host rate limiting; node/browser tests never touch real endpoints, preserving the repo's sparse-testing rule.

---

## Cross-cutting: honesty labeling and provider etiquette

- **Simulated, not measured** stays the load-bearing claim everywhere: shared links carry geometry only (timing re-simulated on arrival), printed cue sheets reuse the exact disclaimer strings from `src/cues.ts`, cached/offline routing hits are labeled "cached," and no flow ever presents provider output or cached replies as measurements.
- **Provider etiquette** is structural, not aspirational: all new network behavior (corridor downloads, alternatives, avoid-option requests) is user-initiated, bounded by explicit caps, abortable, and mediated by the existing per-host queue, 1.2 s spacing, and single-retry path in `src/providers.ts`. No test makes a real request to FOSSGIS, OpenFreeMap, or Nominatim; `docs/ACCEPTANCE.md`'s "never load-test community endpoints" rule is restated in each feature's docs section.

## Suggested sequencing

1. **Feature 3, milestones 1–2** (profiles + cap message): smallest surface, immediately useful, and its provider-mock test patterns are reused by the other two clusters.
2. **Feature 1** (sharing/print/QR): fully local, no provider or SW risk, fast user-visible win.
3. **Feature 2** (corridor + offline routing cache + PWA + touch targets): largest surface; lands last so the service-worker message contract changes once, reusing the mock patterns established above.

Every milestone keeps `npm test` (`npm run build && node --test tests/*.test.mjs`) green, adds Node tests in the existing style (imports from `dist/`, regex assertions for `public/sw.js`), and adds mocked Playwright cases to `tests/browser.py`.
