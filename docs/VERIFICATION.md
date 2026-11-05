# Verification summary

Last measured: 2026-11-05 on `main` (`9dea8f8`), Node 24.22.0, TypeScript 5.8.3.

## Current results

- `npm test` (build, strict TypeScript, Node suite): **298 tests, 0 failures**.
- `npm run lint`: **0 errors, 41 warnings** on `9dea8f8`. A separate lint cleanup removes the remaining warnings; they are not suppressed errors.
- `python tests/browser.py --url http://127.0.0.1:5173 --chromium /usr/local/bin/google-chrome`: **29 checks passed** in Chromium with mocked providers. The harness also runs in Firefox and WebKit in CI; Chromium-only checks are skipped elsewhere with a printed reason.
- `python tests/a11y.py --url http://127.0.0.1:5173 --chromium /usr/local/bin/google-chrome`: **4 of 4 checks passed** over 54 states (empty, routed, every dialog and settings section, light and dark, 1440x900 and 390x844). axe-core 4.14.0 reports no violations; 76 checks stay "incomplete" (translucent map and glass contrast, a collapsed combobox, and similar) and were checked by hand. The script also covers 320 px reflow, reduced-motion and high-contrast preferences, dialog focus entry, containment and return, keyboard waypoint add, move and delete, chart arrow scrubbing, and the accented and right-to-left pseudo-locales.
- CI (`.github/workflows/verify.yml`) runs lint, coverage, the Chromium harness and the accessibility script on every pull request, plus a `cross-browser` job for Firefox and WebKit.

## Module-level verification

- `src/fit.ts` — FIT activity writer/reader, `crc16`, header and whole-file CRC. Covered by `tests/fit.test.mjs` (10 cases): header magic and CRC, the spec-correct definition-message header bit, record count, round-trip fidelity, sport mapping, optional power/cadence, and corruption rejection. **Independent parse:** the exported file was read with python-fitparse, which recovered all 752 records with correct timestamp, position, altitude, heart rate, power and cadence; the session reported `sport=running`, `total_distance=5003.78`, `avg_heart_rate=150`; FileId reported `type=activity`; 1 lap and 2 course points were present. A ride export was independently read as `sport=cycling`.
- `src/qr.ts` — byte-mode QR encoder with Reed-Solomon, masking and format/version info. `tests/qr.test.mjs` (9 cases) checks structure and algebra (matrix size, finder/timing/dark modules, format-info BCH decode, capacity boundaries, determinism) plus pinned regression goldens. **Independent decoding:** the encoder's output was rendered and decoded with OpenCV 5.0's QR detector for 9 inputs spanning ECC L/M/Q/H and versions 1–9, including a UTF-8 string with umlauts and the euro sign and a 179-byte payload — **9/9 decoded back to the exact input**. The regression goldens are the encoder's own matrices, not segno's: for 6 of 8 pinned cases segno chooses a different data mask (the encoder's mask-selection penalty scoring diverges from segno's). That is a quality divergence, not a correctness defect — the format info records the chosen mask, and every produced code decodes.
- `src/offline.ts` — Web Mercator tile maths for a bounded route corridor. Covered by `tests/corridor.test.mjs` (10 cases). The browser flow was exercised only for its graceful failure path, because the sandbox cannot reach the tile host.
- `src/analysis.ts` — `compareActivities` plus HR zones, histogram and per-unit splits; covered by `tests/analysis.test.mjs`.
- Provider additions: opt-in offline routing/elevation cache (network-first, 50 entries, 30 days) and one alternate route under 60 km; avoid options covered by `tests/avoid.test.mjs`.
- Simulation depth is covered by `tests/depth.test.mjs`: neutral weather is exactly neutral; weather scales duration without changing geometry; heat deepens drift while the HR-average contract holds; the smoothed grade is asymmetric; power/cadence are bounded and deterministic; fatigue reshapes timing without changing duration.
- Rest stops are covered by `tests/pauses.test.mjs`: elapsed grows by the dwell, moving time excludes it, co-located zero-speed brackets keep strictly increasing timestamps, splits report stopped time and GPX notes simulated rests. Workout timing is covered by `tests/workout-sim.test.mjs`, and avoid-highways/hills request bodies by `tests/avoid.test.mjs`.
- Large simulations (50,000 points, 1 s samples) run in a module worker with a synchronous fallback and byte-identical output. The browser harness checks worker parity and main-thread responsiveness.

## Defects found by verification

- The FIT writer emitted definition messages with header bit 7 (`0x80`, which the FIT spec reserves for a compressed-timestamp data message) instead of bit 6 (`0x40`), so every exported file was unreadable by conforming tools; `importFIT` shared the same wrong bit. Both were corrected and a regression test now pins the header bit.
- Share never opened for real routes: the QR encoder stopped at version 10 (about 213 bytes) while the share handler allowed 2,000 characters, so it threw before showing the dialog. It now supports versions 1 to 40, falls back to a lower error-correction level, and the dialog always opens with the link.
- The offline corridor download stored nothing with the default style: the OpenFreeMap vector source is referenced through a TileJSON `url`, which was ignored. It now resolves TileJSON and each source's zoom range. Verified live: 2 of 2 tiles stored (about 405 KB), listed in the manager, and the app and map reload offline.
- Phone layout on real touch devices: coarse-pointer buttons are 44 px, so the seven top actions did not fit and History, Settings and the shortcut button were clipped. The actions now take a second row on narrow screens. The map attribution toggle was covered by the Activity settings button, the empty-state card sat under the toolbar strip, and the toolbar took about 40 percent of the screen height; all fixed and covered by a harness check.
- A 404 for `/src/locales/en-US.js` on every English-region visitor; the locale list is now explicit.
- Layout: the 761 to 860 px range overflowed horizontally; Share was drawn with the info icon and Send shared Import's icon; Language and Base layer labels were mis-styled; the Language field was a free-text box; collapsed section headers rendered reversed (for example "0Waypoints"); the Weather menu showed an empty value; the two offline buttons ran together; Trim, Split and Merge dialogs had no padding; the Send platform table was unusable on phones; the empty-state card was mispositioned in right-to-left layouts.

## Live provider results

- Valhalla: walking and cycling routes, elevation, GPX export with timestamps and the simulated label, trace-attributes surface and road-type breakdown, and street names in the cue sheet were all exercised against the public service and behaved correctly. A forced routing failure produced an actionable message and no exportable straight line.
- Photon: typing produced one request about 0.6 s after the last keystroke, results appeared in the listbox and keyboard selection moved the map. Nominatim: nothing was sent while typing, and one explicit submit sent one request with the expected results. These counts were checked with mocked responses; a live run appeared to show two requests only because the service worker was counted twice.
- OpenTopoMap and Waymarked Trails tiles loaded with HTTP 200 and attribution.
- Overpass could not be verified. The public instance returned 504 for every request from this environment, including a trivial one. The app handles a 504 with a clear message and a working retry. The query was reshaped to one corridor linestring (`around:80,lat,lon,...`, documented since Overpass 0.7.55) with exact tag filters, which is about a quarter of the previous size.

## Not verified

- Live WebGL basemap rendering, offline vector-tile rendering, light/dark switching and long-duration stability; the available browser disables WebGL and showed the coordinate-canvas fallback.
- Native IndexedDB persistence across reloads on the deployed origin, TCX import (DOMParser is browser-only), QR rendering, the printable sheet's pagination, and third-party GPX/FIT compatibility.
- Provider behaviour under live load: fixture and mock tests are not evidence of live service behaviour. Overpass against a healthy server, live alternate routes and avoid options, and the cancel path of an offline download with real tiles.
- Web Share and folder save on real devices, imports of exported files into real Strava, Garmin Connect, COROS, TrainingPeaks, intervals.icu and Ride with GPS accounts, and a real screen reader.
- Device performance: the only Lighthouse run used software-rendered WebGL and scored 59 on desktop and 47 on mobile; treat those as an upper bound on cost, not device measurements.
- The acceptance scenarios in `docs/ACCEPTANCE.md` on the deployed site.
- The live CSP and CORS settings on the deployed site.

Keep any deployment private until live checks are complete and the user approves publication.
