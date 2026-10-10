# 05 — Polish and release readiness

Scope: close the gap between "roadmap features implemented" and a complete, release-ready local-first route and simulated-activity studio. Sources: README "Not implemented" list, `docs/VERIFICATION.md` "Not verified", `docs/ACCEPTANCE.md`, and the typical feature set of route planners.

## Decisions

- **Local-first is not violated by handing files to other platforms.** The app stays account-free and keeps all data in the browser; exporting or sending a file to Strava, Garmin, COROS and similar services is a user-initiated hand-off.
- **Direct API upload.** Strava requires a registered application and OAuth; Garmin Connect's developer program is enterprise-only; the COROS Partner API is for established platforms. A static, secretless app cannot hold those credentials. The send flow therefore uses: Web Share API with files, platform-specific recommended format plus the official import page, File System Access "save to folder", and a documented CORS probe that decides whether any direct upload is feasible. Nothing is built that needs a shipped secret.
- **Honesty invariant.** Every export and send path keeps the existing "simulated, not measured" labeling. No feature may impersonate a real device, manufacturer or recording, and device metadata stays free text.
- **Zero runtime dependencies.** Dev dependencies are allowed only in W6 and W9.
- **New network behaviour is opt-in, default off,** disclosed in the UI and `README`, sparse, abortable, and never load-tested against community endpoints.
- **Determinism.** Seeded simulation output for existing settings stays byte-identical unless a workstream explicitly adds a new setting with a neutral default.

## Workstreams

| # | Workstream | Owns (primary files) | Deliverables |
|---|------------|----------------------|--------------|
| W1 | Simulation depth II | `src/model.ts`, `src/analysis.ts`, `src/types.ts` (additive), `src/trimp.ts` (new) | Pace strategies (even, negative split, positive split, per-segment targets); grade-adjusted pace; TRIMP training load; sports beyond run/ride (walk, hike, trail run, mountain bike); activity name and description carried into GPX/TCX/FIT; batch generation of N seeded variants saved to the library |
| W2 | Route editing | `src/routeops.ts` (new), `src/editor.ts` | Trim, split at a point, merge two routes; freehand draw mode simplified to waypoints and snapped; undo/redo coverage for each |
| W3 | Export, send and library | `src/zip.ts` (new), `src/send.ts` (new), `src/storage.ts` | Store-only ZIP writer; Send dialog (Web Share files, per-platform guidance and import links, save to folder); CORS probe report; bulk export and delete; collections; full-library export |
| W4 | Routing intelligence | `src/roundtrip.ts` (new), `src/poi.ts` (new), `src/providers.ts` (routing part), `src/cues.ts` | Round-trip generation from a target distance; surface and road-type data with graceful fallback; street names in cue sheets; opt-in points of interest (water, toilets) |
| W5 | Maps, search, offline | `src/map.ts`, `src/places.ts` (new), `src/offline.ts`, `src/sw.ts`, `public/sw.js`, `searchPlaces` in `src/providers.ts` | Place search with opt-in suggestions that respect each provider's policy; locate-me; topo, cycling and hiking overlays and satellite with licence notes; saved places and offline search; offline download manager (list, size, delete, progress) |
| W6 | Release hygiene | `.github/**`, `vercel.json`, `package.json`, `public/privacy.html`, `CHANGELOG.md`, `.editorconfig` | CI on pull requests with coverage; Dependabot; lint config; security headers and CSP; privacy page; changelog and versioning policy |
| W7 | UX polish | `public/index.html`, `public/app.css`, `src/main.ts` | First-run empty state, shortcut help overlay, autosave and storage indicator, settings reorganisation, mobile touch editing, consistent failure messages |
| W8 | Accessibility and i18n | all UI files | axe audit and fixes, contrast, keyboard-only and screen-reader pass; string extraction, locale-aware formatting, RTL-safe CSS, a pseudo-locale for tests |
| W9 | Verification and performance | `tests/browser.py`, `scripts/**`, `docs/ACCEPTANCE.md`, `docs/VERIFICATION.md` | Cross-browser run, live-provider smoke test, acceptance checklist results, Lighthouse, simulation in a Web Worker for large routes, bundle size |

## Sequencing

1. **Wave 1 (parallel):** W1, W2, W3, W4. Mostly new modules; they share `types.ts`, `main.ts`, `index.html` and `app.css`, so shared-file edits stay additive and localised.
2. **Wave 2:** W5 and W6.
3. **Wave 3:** W7, then W8 (both rewrite shared UI), then W9 against the merged app.
4. **Close-out:** docs refresh (README, VERIFICATION, plans README), full test run, final diff review.

## Rules for implementers

- Work only in your assigned git worktree and branch; commit there; never push.
- Put new logic in new pure modules with Node tests (`tests/<name>.test.mjs`); keep edits to `main.ts`, `index.html`, `app.css`, `types.ts` and `storage.ts` small, additive and in clearly separate regions.
- Do not edit `README.md`, `docs/**` or `package.json` (except W6/W9); report documentation notes in your final message instead.
- No comments, TODO or FIXME in code. Strict TypeScript, no `any`.
- `npm test` must pass before you finish. Run the browser harness only if it is available; say so when it is not.
- Final report: what was built, files touched, tests added, what was verified and how, what is unverified, README and docs notes, and any decision the owner must make.

## Needs the owner (cannot be done in code)

- Hosting self-hosted Valhalla or choosing a hosted routing and tile provider.
- Deciding whether `simrun.vercel.app` stays public.
- Registering any Strava, Garmin or COROS developer application.
- Verifying uploads in real third-party accounts.
- Approving translated strings beyond English.
