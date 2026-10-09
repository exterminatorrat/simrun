# SimRun feature roadmap — design and implementation plans

This directory holds the design and implementation plans for the next wave of SimRun
features. It is a planning artifact: no product code changed to produce it. Each cluster
plan is self-contained, cites real files/functions from this repository, and ends in
ordered milestones that each have a concrete verification step.

Baseline for everything below: `npm ci && npm test` on this checkout is green at
**52/52 Node tests** (Node 24.21.0; the only installed dependency is `typescript@5.8.3`).

## Feature inventory

| # | Plan | Features | Effort |
|---|------|----------|--------|
| 01 | [Workouts, pauses, FIT & TCX](01-workouts-and-timing.md) | Structured interval workouts; pause/auto-pause/rest stops; FIT + TCX export/import | 12–18 dev-days |
| 02 | [Simulation depth](02-simulation-depth.md) | Power/cadence/HR drift/fatigue; offline weather presets; stronger grade model, gradient shading, elevation scrubber | ~5.5 dev-days |
| 03 | [Analysis and library](03-analysis-and-library.md) | HR zones, pace histogram, per-km split chart, activity comparison; tags, search, sort, drag-and-drop import, storage quota | ~6 dev-days |
| 04 | [Sharing, offline, mobile, providers](04-sharing-offline-mobile-providers.md) | Route-in-URL + QR + printable cue sheet; corridor tile download, opt-in offline routing cache, PWA install, touch targets; walk/hike/MTB profiles, avoid options, alternatives, public-cap handling | 13–17 dev-days |

Rollup: roughly **37–47 dev-days**. Features are independently shippable; the sequencing
below is a recommendation, not a hard block.

## Consolidated data-model impact

Every addition is an **optional field**, so `Activity.version` stays `1` and existing
saved activities, imports and backups keep validating. New fields are selected explicitly
inside `validateActivity()` (`src/model.ts:43`).

| Location | Additions | Source plan |
|----------|-----------|-------------|
| `Activity` | `workout?: Workout`; `pauses?: Pauses`; `tags?: string[]` | 01, 03 |
| `Settings` | `power?/cadence?/fatigue?`; `weather?: WeatherSim`; `profile?: RouteProfile` | 02, 04 |
| `Sample` | `power?: number`; `cad?: number` | 02 |
| `Preferences` | `hrMax`; `offlineRouting`; `corridorZoom` | 03, 04 |
| `Split` | `stopped?: boolean` | 01 |

New pure modules: `src/workout.ts` (01), `src/analysis.ts` (03), `src/share.ts` and
`src/offline.ts` (04). Charts stay hand-rolled SVG in `src/charts.ts`; no runtime
dependency is added anywhere.

## Cross-cutting themes

- **Determinism.** Simulation stays a pure function of settings, route and `Settings.seed`.
  Plan 02 keeps new models closed-form (no new PRNG streams) and adds a pinned golden file
  (`tests/golden/depth-seed-12345.json`) with a documented regeneration step. Its only
  deliberate breaking change is the natural-mode grade term — that re-pins the golden.
- **Honesty labeling.** All new outputs remain labeled simulated/estimated, not measured:
  UI copy uses "estimated"/"simulated", and GPX extensions stay opt-in
  (`gpxtpx:hr`, `gpxtpx:cad`, `gpxtpx:atemp`, `gpxpx:Watts`). Shared links carry geometry
  only and re-simulate timing; cached routing results are labeled cached.
- **No new dependencies, no new network.** The only vendored addition is a single-file QR
  encoder added through `scripts/vendor.mjs` (04). New network behavior is user-initiated,
  capped, abortable, and reuses the existing provider queue, spacing and single-retry path.
  Community endpoints are never load-tested.
- **Testing.** Pure logic goes into modules testable under `node --test tests/*.test.mjs`;
  DOM/cache/provider behavior is covered by the mocked-provider `tests/browser.py` harness.
  Each plan names its new test files and keeps `npm test` green per milestone.

## Dependencies and shared touch points

Several plans modify the same hot files, so land the additive type fields early and
serialize changes to `simulate()`:

- `src/types.ts` — all four plans add optional fields; land together first.
- `src/model.ts` `simulate()` (`:81`) — plans 01 (workout timing) and 02 (grade, power,
  weather) both change it; sequence them and re-pin the golden after both.
- `src/model.ts` `splitBoundaries()` (`:151`) / `computeSplits()` (`:160`) — plans 01 and 03.
- `src/gpx.ts` `exportGPX()` (`:6`) — plans 01 (FIT/TCX siblings) and 02 (extensions).
- `src/charts.ts` — plans 02 (scrubber) and 03 (analysis charts).
- `src/providers.ts` `route()` (`:3`) — plan 04 adds a profile parameter and alternates.

## Recommended sequencing

1. **Foundations.** Additive `types.ts` fields + validation scaffolding; plan 04 Feature 3
   milestones 1–2 (routing profiles and the actionable public-cap message). Low risk,
   unblocks the rest.
2. **Library and quick wins.** Plan 03 Cluster B (tags, search/sort, drag-and-drop,
   quota) and plan 02 weather presets — independent of `simulate()` internals.
3. **Simulation core.** Plan 01 Feature B (pauses) → Feature A (workouts); plan 02 grade
   model → power/cadence/HR drift/fatigue → shading/scrubber. Re-pin the golden once here.
4. **Analysis.** Plan 03 Cluster A, built on the settled simulation output.
5. **Formats.** Plan 01 Feature C — TCX first, then FIT (heavier binary format).
6. **Sharing, offline, mobile.** Plan 04 Feature 1 (URL/QR/print) → Feature 2 (corridor
   download, offline routing cache, PWA install, touch targets).

Each cluster plan keeps its own internal order; this roadmap only orders the clusters.

## Open decisions to confirm before implementation

- **Weather semantics** (02): scale total duration (proposed) vs redistribute within it.
- **Breaking grade change** (02): accept re-pinning the seed-12345 golden for natural mode.
- **QR sourcing** (04): confirm vendoring a single-file encoder rather than an npm package.
- **FIT scope** (01): activity-only vs course files; FIT is the heaviest deliverable.
- **URL sharing privacy** (04): coordinates appear in the URL fragment and browser history.
- **Corridor download bounds** (04): confirm zoom levels and tile caps per route.
- **Comparison bound** (03): side-by-side re-simulation capped by the 50k-point limit.

## How to verify a plan is implemented

Run `npm test` (build + Node suite) per milestone, add the named cases, and for
DOM/provider/cache behavior run `python tests/browser.py --url <preview>` against a
managed preview. Provider traffic must stay mocked in tests. Follow the honesty and
provider-etiquette notes in each plan.
