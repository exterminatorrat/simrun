# SimRun — ChatGPT Sites Handoff

This archive contains the complete application source for SimRun.

Your task is to load this existing application into ChatGPT Sites, preserve its current implementation and behavior, verify that it runs correctly in the current Sites environment, fix only compatibility problems that are genuinely necessary, and create a private Site preview.

Do not redesign, rewrite, or rescope the application unless required for Sites compatibility.

The GitHub source of truth is:
https://github.com/exterminatorrat/simrun
Branch: `main`. This ZIP is a snapshot, not a replacement source of truth. Check `BUILD_INFO.json` before comparing versions; synchronize compatibility changes back to the same repository when authorized access is available.

## Product

SimRun is a personal running/cycling route editor and simulated GPX activity studio. No auth, payments, analytics or cloud database. Map-first UI; waypoint editing, undo/redo, reverse, out-and-back, import, timing/simulation, optional synthetic HR, profiles, history and backups. All exports identify themselves as simulated, not recorded device activities.

## Architecture

Strict TypeScript + native DOM + browser ES modules. MapLibre GL JS 5.6.1; OpenFreeMap; purpose-built geometry and SVG charts. TypeScript 5.8.3 is the only npm build dependency. This is intentionally not a React/Vite scaffold. Keep the existing implementation unless the actual Sites runtime cannot host a standard static build.

## Entry Point

`public/index.html` loads `src/main.js` **after compilation**. Source entry: `src/main.ts`. Build output entry: `dist/index.html`. Deploy the **contents of `dist/`**, not raw TypeScript and not the parent `simrun/` directory. The manifest is documentation, not a custom runtime.

## Commands

```sh
npm ci
npm test
npm run build
npm run dev -- --host 0.0.0.0 --port 5173
```

Static output: `dist/`. The dev server is optional; there is no required backend. `npm run package` recreates the handoff ZIP. Optional browser tests and live acceptance checklist are documented in README and `docs/ACCEPTANCE.md`.

## External Services

All require no private credentials. Replaceable endpoints are stored in Settings:
- Map style: `https://tiles.openfreemap.org/styles/liberty` (OpenFreeMap / OpenStreetMap / OpenMapTiles attribution must remain).
- Routing: `https://valhalla1.openstreetmap.de/route`, Valhalla polyline6. Run=`pedestrian`, Ride=`bicycle`.
- Elevation: `https://valhalla1.openstreetmap.de/height`, one small sampled request, missing values stay missing.
- Geocoding: `https://nominatim.openstreetmap.org/search`, intentionally **disabled until informed opt-in**. Require deliberate submitted searches; no autocomplete. Public policy: https://operations.osmfoundation.org/policies/nominatim/.
- Renderer: pinned unpkg MapLibre JS/CSS, unless `public/vendor-status.json` says `bundled:true`. **This archive does not contain the third-party MapLibre bundle.** In a network-enabled environment, `npm run vendor` vendors the exact JS/CSS/license and removes its CDN dependency. Do not substitute a paid map service.

Queues, cancellation, modest retries, 429 handling and cross-tab throttling protect public services. Do not introduce a backend merely to evade provider policies. Public deployment needs a new review of current provider terms and demo-server identification requirements.

## Persistence

IndexedDB `simrun-local`, version 1, holds saved activities and the current draft. localStorage contains only preferences, limited search results and throttling timestamps. Storage-blocked contexts deliberately fall back to session memory and warn the user. Moving origins loses access to the previous origin's data; JSON backup/restore is the transfer mechanism. Do not replace this with Sites storage or a cloud database.

## GPX

Local File API + DOMParser. Invalid coordinates, entity declarations, excessive size and malformed XML are rejected. For disjoint segments, the largest is imported with a visible notice. Exports: GPX 1.1, escaped XML, geodesically resampled coordinates, increasing UTC timestamps, real elevation when available, optional Garmin TrackPointExtension v1 HR (namespace compatibility, not device impersonation). Pace variation is smooth, seeded and normalized to target duration. The selected fixed UTC offset is explicit; check DST for the selected date. Exports are resimulations rather than lossless recording copies.

## Sites Requirements

Discover the actual Sites runtime rather than assuming a particular API/scaffold. Try ordinary static hosting first, build command `npm run build`, output `dist`. Preserve relative asset paths and JavaScript MIME types. Use a secure origin. The environment must permit MapLibre workers (normally blob URLs), the selected map resources and selected HTTPS providers. Vendor MapLibre if CDN loading is blocked. Test routing/geocoding CORS from the real preview. Any compatibility proxy must be narrowly scoped to fixed allowed providers, respect usage limits and forward no private data beyond the intended request.

If WebGL/CDN/style loading fails, retain the honest coordinate canvas and warning. Never describe its grid as a street map. A dashed waypoint preview is not a verified route and cannot be exported as one.

## Known Limitations

No Sites tool was available during creation. **No private Site has been created or tested.** The environment also blocked live dependency downloads and browser navigation. Local build + logic tests and isolated DOM tests passed, but actual MapLibre, live providers, hosted ESM/CSP/CORS and native IndexedDB reload need testing in your environment. The pinned MapLibre CDN dependency above remains. Multi-segment GPX selection/export is limited to the largest continuous segment. Optional custom splits and GPS noise are absent. See `docs/VERIFICATION.md` for the exact evidence, not inferred passes.

## Verification

Run `npm test`. Then rerun `docs/ACCEPTANCE.md` in the actual private Site: live 5 km pedestrian route; drag/insert/delete/reorder; cancellation and undo/redo; reverse/out-back; run/ride costing; pace-duration math; natural timing and HR XML; midnight offset; import/re-export; history/draft reload and duplicate; JSON backup/restore; forced routing/429 failures; no empty/stale export; desktop/mobile; attribution and console. XML parsing was tested; independent GPX XSD validation and third-party importer compatibility were not certified.

## Deployment Goal

Create a **private ChatGPT Site preview first**. Do not publicly publish without user approval. Report any unresolved live-provider or persistence failure accurately. Do not claim this ZIP already contains a working hosted Site. Preserve GitHub as canonical, and regenerate the handoff after verified compatibility changes.
