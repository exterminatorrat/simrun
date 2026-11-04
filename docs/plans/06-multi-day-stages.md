# Plan 06 — Multi-day and stage routes

Design plan for splitting one planned route into per-day activities. Baseline: `npm test`
is green, `npm run typecheck` is clean, and `Activity.version` is `1`. This plan follows the
constraints in `docs/plans/README.md`: strict TypeScript, native DOM, ES modules, no new
runtime dependencies, deterministic simulation, and simulated/estimated labeling on every
derived number.

## 1. Problem

SimRun plans one activity per route. A long tour — a three-day hike, a week on the bike —
has to be trimmed by hand into separate files, and each trimmed copy loses the connection
to the others. The planner gap is not "draw a longer line"; it is:

1. Break a resolved route into ordered days at chosen distances.
2. Give each day its own timing, stats, and export file.
3. Keep the days recognizable as one tour, so they can be reopened, re-exported, or
   compared later.

Exporting one multi-track GPX is the wrong default: many devices and upload services
flatten a multi-segment track into a single activity, so the day boundary silently
disappears. One file per day, plus a ZIP for bulk handling, preserves the split.

## 2. Approach: derive stages as ordinary activities

There is no persisted `Tour` entity and no second simulation path. A stage is a normal
`Activity` that carries an optional back-reference:

```ts
export interface StageRef { tourId: string; index: number; total: number }
```

`Activity` gains `stage?: StageRef`. Everything downstream already works: `simulate()`,
`computeSplits()`, `analysis.ts`, GPX/TCX/FIT export, `createActivityFiles()`,
`zipActivities()`, local history, backups, compare, and share links operate on `Activity`.
Stages are saved like any other activity, so a tour survives a reload without new storage
or an IndexedDB version bump.

The alternative — a `Tour` record holding N activities — was rejected for this increment.
It would require every consumer (export, backup, history, compare, ZIP) to learn a second
shape, and it buys only re-editing convenience. Re-editing is a later plan; `stage.tourId`
already groups the outputs when that becomes necessary.

## 3. Module boundaries

- **`src/tour.ts` (new, pure).** Boundary math and the activity materialization. Imports
  `plannedPath`/`startTime` from `model.js`, `cumulative` from `geometry.js`,
  `trimRouteByDistance`/`waypointsInRange` from `routeops.js`, and `t` for two
  parameterized messages. No DOM, no storage, no simulation.
- **`src/analysis.ts`.** Exports the existing per-activity statistics function as
  `activityStats(entry, heartRates)`; `compareActivities` calls the same function. Nothing
  else changes, so the preview table and the comparison dialog cannot disagree.
- **`src/model.ts`.** One validation delta: `validateActivity` round-trips `stage`
  explicitly, in the same style as `loop`, `splits`, `workout`, `pauses`, and `tags`.
- **`src/main.ts`.** Owns the planner section, the preview table, and save/export wiring.
  Uses the existing `validRoute()`, `simulateInWorker()`, `zipActivities()`, and
  `downloadFiles()` paths rather than new export code.
- **`public/index.html`, `public/app.css`.** One collapsed `settings-section` after batch
  generation, reusing `.segmented`, `.inline-field`, `.text-button`, and `.split-row`.

`tour.ts` must not import `main.ts`, `storage.ts`, or `charts.ts`.

## 4. Boundary algorithms

All boundaries are interior distances in metres from the start of the planned path, which
is `plannedPath(base)` — the loop plan, when present, is materialized first so a stage is a
slice of the route the user will actually export.

**Even days.** `evenStageBoundaries(total, days)` returns `total/days * i` for
`i = 1…days-1`. `days` is an integer in `2…31`. A day shorter than one metre is rejected
because `trimRouteByDistance` already refuses a range shorter than one metre.

**Daily distance.** `dailyStageBoundaries(total, perDay)` returns `perDay * i` for
`i = 1…ceil(total/perDay)-1`. The final day carries the remainder and may be shorter. Fewer
than two days means the route already fits in one day, which is reported rather than
silently accepted; more than 31 days is rejected.

**Why 31.** It matches the validation ceiling and keeps preview cost and the ZIP entry
count bounded. It is a product limit, not a technical one.

## 5. Materializing a stage

For boundaries `b₁…bₙ₋₁` and a route total `T`, day `i` covers `[bᵢ₋₁, bᵢ]` with
`b₀ = 0` and `bₙ = T`:

| Field | Rule |
|-------|------|
| `path` | `trimRouteByDistance(path, from, to)`, interpolated ends included |
| `waypoints` | `waypointsInRange(path, base.waypoints, from, to)` |
| `settings.start` | base start plus `i` × 24 h, formatted back through `utcOffset` |
| `stage` | `{ tourId, index: i+1, total: n }` |
| `id` | `${tourId}-d${i+1}` |
| `name` | `${base.name} · Day ${i+1}`, truncated to 160 characters |
| `loop` | removed — already applied to `path` |
| `workout` | removed, with a notice |
| `splits` | removed, with a notice |
| `pauses` | rests kept when `from ≤ distance < to`, shifted by `-from` |
| `routeData` | clipped to the stage range (below) |

Start-time arithmetic mirrors `batch.ts`: `startTime(settings)` yields an epoch value,
`index × 86_400_000` is added, and the wall clock is rebuilt as
`new Date(epoch + utcOffset * 60_000).toISOString().slice(0, 16)`. A fixed offset is
preserved, so no hidden DST shift is introduced.

**Why workouts and splits are dropped.** Both are measured from the start of the full
route. `workout.steps` have no day anchor and `splits.markers` would need re-basing plus a
decision about auto-split intervals. Dropping them with an explicit notice is honest;
silently re-interpreting them would produce plausible but wrong pacing. A later plan can
add per-day workout targets.

**Rest stops** are distance-anchored single points, so re-basing is unambiguous. Rests
outside a day are dropped, and the result reports that some were dropped.

**Route data** is base-relative in two different ways:

- `streetNames` spans carry `start`/`end` positions. Keep spans overlapping the day and
  clip their ends: `start' = max(start, from) - from`, `end' = min(end, to) - from`.
- `surfaceEdges` carry only a length, classified by position through cumulative sums. Walk
  the edges, track the cursor, and emit `min(end, to) - max(start, from)` for each edge
  longer than 1 cm. Unclassified and out-of-range edges disappear naturally.

Cue sheets, the surface breakdown, and the analysis panel therefore describe the day, not
the parent route.

## 6. UI

New collapsed section "Multi-day plan" in the inspector, after batch generation:

- Segmented control: **Even days** / **Daily distance**.
- One input per mode: days (2–31) or daily distance in the current unit.
- **Preview days** renders `# · Distance · Climb · Time` from `activityStats()` over a
  local `simulate()` of each day.
- **Save days** writes every day to the local activity library.
- **Export days** builds the per-day GPX/TCX/FIT set through `zipActivities()` with
  worker-simulated samples and downloads one ZIP.

Save and export recompute the day set from current inputs instead of reusing preview
state, so a settings change between preview and save cannot save stale numbers. The
section summary shows `Day i of n` when the open activity is itself a stage.

## 7. Verification

- `tests/tour.test.mjs`: boundary counts and distance conservation, start-time advance
  across the fixed offset, unique ids and names, pause re-basing and dropping, route-data
  clipping, workout/split removal notices, validation round-trip and rejection.
- `npm test` (TypeScript build, Node tests including the i18n key-set check), `npm run
  lint`, `npm run typecheck`.
- Browser check of the new section and one save/export round trip in the running app.

## 8. Milestones

1. `src/tour.ts` + `tests/tour.test.mjs` + `stage` validation. Verify with `npm test`.
2. `activityStats` export and the preview table. Verify in the running app.
3. Save and ZIP export wiring. Verify by exporting three days and inspecting the file set.
4. Documentation (`docs/plans/README.md`, README feature list, CHANGELOG).

## 9. Non-goals

- Manual map-click or waypoint boundary markers. Boundaries are distance-based only.
- Per-day pace, weather, or workout targets.
- Re-editing a saved tour as a unit, or merging days back together.
- A `Tour` record, a new IndexedDB store, or a version bump.
- Mulit-track single-file GPX export.
