# Verification summary

- Build and strict TypeScript checks passed; the current Node suite is **124 tests, all passing** (Node 24.21.0).
- New pure modules are covered by Node tests: `src/analysis.ts` (HR zones, histogram, per-unit splits), `src/share.ts` (1e5 polyline codec, share URLs, size warnings), `src/workout.ts` (±0.5% matching and scale-to-route repair), `src/tcx.ts` (TCX activity/course structure) and the library helpers (tags/search/sort).
- Simulation depth is covered by `tests/depth.test.mjs`: neutral weather is exactly neutral; weather scales duration without changing geometry; heat deepens drift while the HR-average contract holds; the smoothed grade is asymmetric; power/cadence are bounded and deterministic; fatigue reshapes timing without changing duration.
- Rest stops are covered by `tests/pauses.test.mjs`: elapsed grows by the dwell, moving time excludes it, co-located zero-speed brackets keep strictly increasing timestamps, splits report stopped time and GPX notes simulated rests. Workout timing is covered by `tests/workout-sim.test.mjs`, and avoid-highways/hills request bodies by `tests/avoid.test.mjs`.
- A managed preview (Chromium via agent-browser) rendered with no console errors or uncaught exceptions. Interaction checks confirmed: route import gives correct distance/duration; weather changes duration (neutral 25:01 → hot 31:07); a rest stop gives elapsed 27:01 / moving 25:01; a structured workout gives 22:31; heart-rate zones populate; and the analysis section, six chart tabs, share dialog, TCX export and PWA manifest are present.

## Not verified

- Live WebGL basemap rendering, offline vector-tile rendering, light/dark switching and long-duration stability; the available browser disables WebGL and showed the coordinate-canvas fallback.
- Native IndexedDB persistence across reloads, TCX import (DOMParser is browser-only), QR rendering, the printable sheet's pagination, and third-party GPX/FIT compatibility.
- Provider behaviour under live load: fixture and mock tests are not evidence of live service behaviour.

Keep any deployment private until live checks are complete and the user approves publication.
