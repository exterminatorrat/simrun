# Verification summary

- Build and strict TypeScript checks passed; the current Node suite is **147 tests, all passing** (Node 24.21.0).
- New pure modules are covered by Node tests: `src/analysis.ts` (HR zones, histogram, per-unit splits), `src/share.ts` (1e5 polyline codec, share URLs, size warnings), `src/workout.ts` (±0.5% matching and scale-to-route repair), `src/tcx.ts` (TCX activity/course structure) and the library helpers (tags/search/sort).
- Simulation depth is covered by `tests/depth.test.mjs`: neutral weather is exactly neutral; weather scales duration without changing geometry; heat deepens drift while the HR-average contract holds; the smoothed grade is asymmetric; power/cadence are bounded and deterministic; fatigue reshapes timing without changing duration.
- Rest stops are covered by `tests/pauses.test.mjs`: elapsed grows by the dwell, moving time excludes it, co-located zero-speed brackets keep strictly increasing timestamps, splits report stopped time and GPX notes simulated rests. Workout timing is covered by `tests/workout-sim.test.mjs`, and avoid-highways/hills request bodies by `tests/avoid.test.mjs`.
- A managed preview (Chromium via agent-browser) rendered with no console errors or uncaught exceptions. Interaction checks confirmed: route import gives correct distance/duration; weather changes duration (neutral 25:01 → hot 31:07); a rest stop gives elapsed 27:01 / moving 25:01; a structured workout gives 22:31; heart-rate zones populate; and the analysis section, six chart tabs, share dialog, TCX export and PWA manifest are present.
- Second tranche verified in the same preview: gradient shading colours uphill red and downhill blue on the canvas fallback; the elevation scrubber responds to arrow keys with a distance/elevation/grade tooltip and clears on Escape; the share dialog renders a client-side QR (425 modules); the comparison dialog shows six metric rows with a correct elevation delta (250 m); the energy estimate reads 363 kcal for 5 km; FIT export and the corridor-download flow both complete and report honestly.

## Newer modules and their verification

- `src/fit.ts` — FIT activity writer/reader, `crc16`, header and whole-file CRC. Covered by `tests/fit.test.mjs` (9 cases): header magic and CRC, record count, round-trip point/distance/time/heart-rate fidelity, sport mapping, optional power/cadence, and corruption rejection. Not validated against an external FIT tool.
- `src/qr.ts` — byte-mode QR encoder with Reed-Solomon, masking and format/version info. `tests/qr.test.mjs` (6 cases) checks structure and algebra (matrix size, finder/timing/dark modules, format-info BCH decode, capacity boundaries, determinism) plus pinned regression goldens. **Independent decoding:** the encoder's output was rendered and decoded with OpenCV 5.0's QR detector for 9 inputs spanning ECC L/M/Q/H and versions 1–9, including a UTF-8 string with umlauts and the euro sign and a 179-byte payload — **9/9 decoded back to the exact input**. The regression goldens are the encoder's own matrices, not segno's: for 6 of 8 pinned cases segno chooses a different data mask (the encoder's mask-selection penalty scoring diverges from segno's). That is a quality divergence, not a correctness defect — the format info records the chosen mask, and every produced code decodes.
- `src/offline.ts` — Web Mercator tile maths for a bounded route corridor. Covered by `tests/corridor.test.mjs` (8 cases). The browser flow was exercised only for its graceful failure path, because the sandbox cannot reach the tile host.
- `src/analysis.ts` — `compareActivities` plus HR zones, histogram and per-unit splits; covered by `tests/analysis.test.mjs`.
- Provider additions: opt-in offline routing/elevation cache (network-first, 50 entries, 30 days) and one alternate route under 60 km; avoid options covered by `tests/avoid.test.mjs`.

## Not verified

- Live WebGL basemap rendering, offline vector-tile rendering, light/dark switching and long-duration stability; the available browser disables WebGL and showed the coordinate-canvas fallback.
- Native IndexedDB persistence across reloads, TCX import (DOMParser is browser-only), QR rendering, the printable sheet's pagination, and third-party GPX/FIT compatibility.
- Provider behaviour under live load: fixture and mock tests are not evidence of live service behaviour.

Keep any deployment private until live checks are complete and the user approves publication.
