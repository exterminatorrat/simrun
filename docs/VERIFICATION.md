# Verification summary

- Build and strict TypeScript checks passed; the Node suite is **248 tests, all passing** (Node 24.21.0); this figure was 147 before the polish work and is re-measured in the final section below.
- New pure modules are covered by Node tests: `src/analysis.ts` (HR zones, histogram, per-unit splits), `src/share.ts` (1e5 polyline codec, share URLs, size warnings), `src/workout.ts` (±0.5% matching and scale-to-route repair), `src/tcx.ts` (TCX activity/course structure) and the library helpers (tags/search/sort).
- Simulation depth is covered by `tests/depth.test.mjs`: neutral weather is exactly neutral; weather scales duration without changing geometry; heat deepens drift while the HR-average contract holds; the smoothed grade is asymmetric; power/cadence are bounded and deterministic; fatigue reshapes timing without changing duration.
- Rest stops are covered by `tests/pauses.test.mjs`: elapsed grows by the dwell, moving time excludes it, co-located zero-speed brackets keep strictly increasing timestamps, splits report stopped time and GPX notes simulated rests. Workout timing is covered by `tests/workout-sim.test.mjs`, and avoid-highways/hills request bodies by `tests/avoid.test.mjs`.
- A managed preview (Chromium via agent-browser) rendered with no console errors or uncaught exceptions. Interaction checks confirmed: route import gives correct distance/duration; weather changes duration (neutral 25:01 → hot 31:07); a rest stop gives elapsed 27:01 / moving 25:01; a structured workout gives 22:31; heart-rate zones populate; and the analysis section, six chart tabs, share dialog, TCX export and PWA manifest are present.
- Second tranche verified in the same preview: gradient shading colours uphill red and downhill blue on the canvas fallback; the elevation scrubber responds to arrow keys with a distance/elevation/grade tooltip and clears on Escape; the share dialog renders a client-side QR (425 modules); the comparison dialog shows six metric rows with a correct elevation delta (250 m); the energy estimate reads 363 kcal for 5 km; FIT export and the corridor-download flow both complete and report honestly.

## Newer modules and their verification

- `src/fit.ts` — FIT activity writer/reader, `crc16`, header and whole-file CRC. Covered by `tests/fit.test.mjs` (10 cases): header magic and CRC, the spec-correct definition-message header bit, record count, round-trip fidelity, sport mapping, optional power/cadence, and corruption rejection. **Independent parse:** the exported file was read with python-fitparse, which recovered all 752 records with correct timestamp, position, altitude, heart rate, power and cadence; the session reported `sport=running`, `total_distance=5003.78`, `avg_heart_rate=150`; FileId reported `type=activity`; 1 lap and 2 course points were present. A ride export was independently read as `sport=cycling`.
  - This check found and fixed a real defect the round-trip test could not: the writer emitted definition messages with header bit 7 (`0x80`, which the FIT spec reserves for a compressed-timestamp data message) instead of bit 6 (`0x40`), so every exported file was unreadable by conforming tools; `importFIT` shared the same wrong bit. Both were corrected and a regression test now pins the header bit.
- `src/qr.ts` — byte-mode QR encoder with Reed-Solomon, masking and format/version info. `tests/qr.test.mjs` (6 cases) checks structure and algebra (matrix size, finder/timing/dark modules, format-info BCH decode, capacity boundaries, determinism) plus pinned regression goldens. **Independent decoding:** the encoder's output was rendered and decoded with OpenCV 5.0's QR detector for 9 inputs spanning ECC L/M/Q/H and versions 1–9, including a UTF-8 string with umlauts and the euro sign and a 179-byte payload — **9/9 decoded back to the exact input**. The regression goldens are the encoder's own matrices, not segno's: for 6 of 8 pinned cases segno chooses a different data mask (the encoder's mask-selection penalty scoring diverges from segno's). That is a quality divergence, not a correctness defect — the format info records the chosen mask, and every produced code decodes.
- `src/offline.ts` — Web Mercator tile maths for a bounded route corridor. Covered by `tests/corridor.test.mjs` (8 cases). The browser flow was exercised only for its graceful failure path, because the sandbox cannot reach the tile host.
- `src/analysis.ts` — `compareActivities` plus HR zones, histogram and per-unit splits; covered by `tests/analysis.test.mjs`.
- Provider additions: opt-in offline routing/elevation cache (network-first, 50 entries, 30 days) and one alternate route under 60 km; avoid options covered by `tests/avoid.test.mjs`.

## Not verified

- Live WebGL basemap rendering, offline vector-tile rendering, light/dark switching and long-duration stability; the available browser disables WebGL and showed the coordinate-canvas fallback.
- Native IndexedDB persistence across reloads, TCX import (DOMParser is browser-only), QR rendering, the printable sheet's pagination, and third-party GPX/FIT compatibility.
- Provider behaviour under live load: fixture and mock tests are not evidence of live service behaviour.

Keep any deployment private until live checks are complete and the user approves publication.

## Integration verification (polish branch)

Date: 2026-10-10. Worktree: `hoplite/polish-w9`.

### Commands and results

- Installed the pinned browser test requirement in `/tmp/hoplite/w9-venv` with `pip install playwright==1.57.0`; launched `/usr/local/bin/google-chrome` directly, with no browser download.
- Ran `npm test`: **220 passed, 0 failed**. Ran `npm run typecheck`, `python -m py_compile tests/browser.py`, and `git diff --check`: passed.
- Also ran `npm run lint`: it exited 1 on four existing errors in unchanged `src/poi.ts` (`preserve-caught-error`) and `tests/markup.test.mjs` (`no-useless-escape`), with 46 warnings. Focused ESLint on the new simulation modules and Node test passed.
- Built and served the merged app at `http://127.0.0.1:5174`; ran `python tests/browser.py --url http://127.0.0.1:5174 --chromium /usr/local/bin/google-chrome --screenshots /tmp/hoplite/shots/merged-final`: **26 checks passed**, including 50k-point worker parity/responsiveness, IndexedDB reload, offline shell behavior, responsive layouts, and no uncaught exceptions.
- Built original commit `9163514` in a throwaway `/tmp/hoplite/baseline-w9` worktree and served it at port 5175; ran the same harness and flags. Its first seven checks passed, then it failed the existing 390 px horizontal-scroll assertion. At 390 px the original reports `scrollWidth=405`; the merged app reports `scrollWidth=390`. This is a pre-existing baseline failure, not a merge regression; the merged layout passes. The harness aborts at the first assertion, so later baseline checks did not run.
- With mocked Valhalla and Overpass responses, exercised trim (5.10 km to 3.50 km), split/save, merge (back to 5.10 km), and freehand drawing (0 to 5 waypoints); generated a 5 km round trip (4.99 km, within tolerance, one route call); enabled optional surface data and POI lookup (mock classified paved/gravel/road edges and returned one water stop); selected all six sports and four pace strategies; checked description in GPX, TRIMP (58.9), GAP (6:01/km), batch save (3 variants), collection filtering, History ZIP export and bulk deletion, Send guidance, settings persistence, and Escape-close for Settings, Trim, Merge, History, Compare, Share, and Send. No duplicate IDs, console errors, or uncaught page errors were found.

### Simulation performance

The input was a 50,000-point, 250 km route with a requested 1-second sample interval and a 75,000-second run. Synchronous Node `simulate()` produced 49,968 points at a 1.501-second effective interval; five timings were 124–524 ms (median 176 ms). In headless Chrome, synchronous timings were 244–828 ms. The module worker returned the same serialized result in 1,377 ms including packing, worker startup, simulation, and unpacking; `PerformanceObserver` recorded no main-thread long tasks during that worker run. The browser harness asserts worker parity and no task over 100 ms. The synchronous fallback and service-worker precache entry are covered by `tests/simulation-worker.test.mjs`.

### Built `dist/` sizes

Raw and gzip byte counts for each of the 48 files after `npm run build` (gzip level 9; PNG/JPEG gzip figures are informational and normally are not used for HTTP transfer):

| File | Raw bytes | Gzip bytes |
|---|---:|---:|
| `app.css` | 25,572 | 6,331 |
| `apple-touch-icon.png` | 64,738 | 64,776 |
| `favicon.png` | 8,688 | 8,711 |
| `index.html` | 32,930 | 8,979 |
| `logo.jpg` | 19,906 | 19,781 |
| `manifest.json` | 448 | 265 |
| `mark.jpg` | 5,892 | 5,911 |
| `privacy.html` | 2,756 | 1,297 |
| `src/analysis.js` | 7,646 | 2,294 |
| `src/batch.js` | 1,756 | 777 |
| `src/charts.js` | 9,517 | 2,929 |
| `src/cues.js` | 5,419 | 2,092 |
| `src/editor.js` | 21,447 | 4,657 |
| `src/fit.js` | 12,844 | 3,817 |
| `src/gap.js` | 1,091 | 478 |
| `src/geometry.js` | 7,039 | 2,404 |
| `src/gpx.js` | 7,055 | 2,782 |
| `src/id.js` | 615 | 365 |
| `src/import.js` | 5,469 | 1,851 |
| `src/main.js` | 71,295 | 19,129 |
| `src/map.js` | 28,178 | 7,529 |
| `src/model.js` | 33,164 | 9,823 |
| `src/offline.js` | 2,215 | 837 |
| `src/poi.js` | 4,956 | 1,937 |
| `src/providers.js` | 18,199 | 5,417 |
| `src/qr.js` | 12,163 | 3,570 |
| `src/roundtrip.js` | 3,090 | 1,146 |
| `src/routeops.js` | 6,824 | 1,886 |
| `src/send.js` | 5,549 | 1,924 |
| `src/share.js` | 3,948 | 1,520 |
| `src/simulation-worker.js` | 2,588 | 878 |
| `src/simulation.js` | 4,833 | 1,405 |
| `src/sports.js` | 1,212 | 398 |
| `src/storage.js` | 9,792 | 2,921 |
| `src/sw.js` | 1,095 | 525 |
| `src/tcx.js` | 7,239 | 2,605 |
| `src/trimp.js` | 1,103 | 517 |
| `src/types.js` | 11 | 31 |
| `src/ui.js` | 3,275 | 1,518 |
| `src/workout.js` | 2,501 | 943 |
| `src/zip.js` | 4,744 | 1,431 |
| `sw-manifest.json` | 1,012 | 329 |
| `sw.js` | 5,403 | 1,933 |
| `vendor/maplibre-LICENSE.txt` | 5,984 | 1,530 |
| `vendor/maplibre-gl-csp-worker.js` | 377,635 | 103,627 |
| `vendor/maplibre-gl-csp.js` | 863,343 | 222,180 |
| `vendor/maplibre-gl.css` | 69,422 | 9,997 |
| `vendor-status.json` | 52 | 68 |

Total: **1,791,653 raw bytes; 548,051 bytes summed after gzip**. MapLibre's vendored CSP bundle and worker are the largest assets; application `src/main.js` is 71,295 raw / 19,129 gzip bytes. Gzipping already-compressed images slightly increases their byte counts, as expected.

### Not verified

- No cross-browser run, Lighthouse audit, live routing/elevation/Overpass request, real Strava/Garmin/COROS account import, or provider compatibility test was performed; provider interactions above used local mocks.
- Live WebGL basemap and offline vector-tile rendering remain unverified. The original-commit browser harness did not continue beyond its first failure.
- Screenshots were captured under `/tmp/hoplite/shots/merged-final` and `/tmp/hoplite/shots/baseline-final`; image inspection was unavailable because the image tool rejects paths outside `/tmp/hoplite/workspace`, which this task was instructed not to touch.
- No new owner decision is required by this workstream. Provider selection, public deployment, and live third-party verification remain owner-gated decisions from the release plan.

## Final integration (all polish workstreams merged)

Date: 2026-10-10. Branch `hoplite/kos-04c6f62d`, after W1 to W9a were merged.

- `npm test` (type check, build, Node suite): **248 passed, 0 failed**. `npm run lint`: **0 errors, 47 warnings** (existing `no-explicit-any`, unused variables and empty blocks that were tuned to warnings).
- `python tests/browser.py` in headless Chrome with mocked providers: **26 of 26 checks pass** on three of four runs of the final tree. One run stopped at the 50k-point worker check, which bounds main-thread long tasks at 100 ms; it passed on the two following runs, so treat it as an intermittent timing flake on a cold page.
- `python tests/a11y.py`: axe-core 4.14.0 (WCAG 2.0 and 2.1 A and AA, best practice) over 52 states (empty, routed, every dialog and settings section, light and dark, 1440x900 and 390x844) reports **no violations**; 60 checks stay "incomplete" (translucent map and glass contrast and a collapsed combobox) and were checked by hand. It also covers 320 px reflow, reduced-motion and high-contrast preferences, dialog focus entry, containment and return, keyboard waypoint add, move and delete, chart arrow scrubbing, and the accented and right-to-left pseudo-locales.
- A browser baseline against the original commit showed the 390 px horizontal overflow already failing there; it passes in the merged UI.
- Integration fixes made while merging: the left toolbar no longer runs underneath the chart panel on desktop; the offline cache status again shows its 1,500-entry cap; the loop-plan undo expectation in the harness reflects that each plan change is now its own undo step; two error rethrows keep their cause.
- Large simulations (50,000 points, 1 s samples) took 124 to 524 ms in Node and 244 to 828 ms in the browser on the main thread; they now run in a module worker with a synchronous fallback and byte-identical output.

### Still not verified

- Live WebGL basemap rendering, the topo, cycling and hiking overlays on the map, and offline vector tiles (the test browser fell back to the coordinate canvas).
- Real behaviour of the live providers under normal use: FOSSGIS Valhalla (including `trace_attributes`), Photon, Overpass, OpenFreeMap and the overlay tile hosts. Only a handful of response shapes were confirmed with single requests.
- Web Share and folder-save on real devices, and imports of the exported GPX, TCX and FIT files into real Strava, Garmin Connect, COROS, TrainingPeaks, intervals.icu and Ride with GPS accounts.
- Firefox and Safari; Lighthouse; a real screen reader; native IndexedDB persistence across real reloads on the deployed origin; the deployed security headers.
- The acceptance scenarios 17 to 25 added to `docs/ACCEPTANCE.md` and the original 1 to 16 on the real deployment.

