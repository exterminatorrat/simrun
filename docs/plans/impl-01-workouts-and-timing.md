# Implementation plan — 01: Workouts, pauses/rest stops, TCX & FIT

Planning artifact for the SimRun repository (`/tmp/hoplite/workspace`). This
document plans implementation only; no file under `src/`, `tests/`, or
`public/` is changed this round. Baseline: `npm ci && npm test` passes 52/52
Node tests.

## 1. Goal

Extend SimRun's deterministic route simulator with three related capabilities:

- **A. Structured interval workouts** — authored work/rest steps with per-step
  distance, pace/speed, and optional HR targets, expanded along the planned
  route, matched to the route within ±0.5% (with an explicit scale-to-route
  repair), and surfaced in splits and exports.
- **B. Pauses and rest stops** — distance-anchored rest stops that add elapsed
  time without adding moving time, co-located bracketing samples with zero
  speed and strictly increasing timestamps, stopped time tracked per split
  without adding split boundaries, and import-time auto-pause detection
  (≥30 s below a 0.7 m/s default threshold).
- **C. TCX and FIT formats** — TCX activity export with laps, TCX course
  export with cue/workout course points, TCX import, and a minimal
  standard-profile FIT activity writer (records, laps, rest timer events,
  course points, CRC/header checks) plus a scoped binary importer.

## 2. Scope and non-goals

**In scope**

- New pure modules `src/workout.ts`, `src/tcx.ts`, `src/fit.ts`.
- Additive optional fields on `Activity` and `Split`; `Activity.version` stays
  `1`; `validateActivity()` keeps explicitly selecting fields.
- Changes to `simulate()`, `splitBoundaries()`, `computeSplits()` in
  `src/model.ts`, GPX metadata/segments in `src/gpx.ts`, import dispatch in
  `src/import.ts`, UI in `src/main.ts`/`src/editor.ts`, and tests.
- One-time golden-output re-pin after pauses change simulation timing.

**Non-goals**

- FIT course files, multi-session FIT files, developer fields, TCX workout
  plans; power/cadence/grade simulation (plan 02); analysis features (plan 03).
- Auto-pause on export: detection is import-only; authored rests stay authored.
- No new runtime dependencies, no network paths, no FIT SDK dependency — the
  FIT writer is hand-rolled and its profile constants are verified against the
  official Garmin profile before implementation.

## 3. Architecture

### New modules

| Module | Responsibility |
|---|---|
| `src/workout.ts` | Pure workout semantics: validation caps, block expansion into ordered steps, duration math, cumulative step boundaries, per-distance step lookup, distance matching/repair, GPX course-point derivation. DOM-free so Node tests exercise it directly. |
| `src/tcx.ts` | TCX v2 serialization (activity laps + course mode) and DOM-based import of the largest track, reusing `escapeXML`/`safeFilename` from `src/gpx.ts` and `importedActivity` from `src/model.ts`. |
| `src/fit.ts` | Minimal standard-profile FIT activity encoder (FileId, Session, Lap, Record, Event timer events, CoursePoint) with header/data CRC16, plus a scoped decoder for those messages. |

### Existing hot files touched (and ordering to avoid conflicts)

| File | Change |
|---|---|
| `src/types.ts` | Add `Workout`/`WorkoutBlock`/`WorkoutStep`, `RestStop`, `Pauses`, optional `Split.stopped`. |
| `src/model.ts` | `validateActivity()` extension; `simulate()` gains pause/workout timing; `splitBoundaries()`/`computeSplits()` gain stopped-time accounting; export `timeAtDistance` for TCX slicing. |
| `src/gpx.ts` | `exportGPX()` gains workout step segments, step course-point waypoints, and rest-stop metadata note. Import path unchanged. |
| `src/import.ts` | `importRouteFile()` dispatch gains `.tcx` and FIT branches; stall detection runs after `importedActivity()`. |
| `src/main.ts` | Moving-time display, split stopped column, TCX/FIT export actions, file-input dispatch. |
| `src/editor.ts` | Workout/pause editing methods and undo snapshot extension. |

`src/model.ts` and `src/gpx.ts` are shared with plans 02–04, so milestones land
serially (pauses → detection → workouts → TCX → FIT) with the full suite green
between each; the golden simulation output is re-pinned exactly once (after the
pauses engine lands) per the sequencing note in `docs/plans/README.md`.

## 4. Data model deltas (exact TypeScript)

All new fields are optional and validated explicitly, so existing stored
activities and backups parse unchanged; nothing merges untrusted objects.

```ts
// src/types.ts — additive
export interface WorkoutBlock { repeat: number; steps: WorkoutStep[] }
export interface WorkoutStep {
  kind: 'work' | 'rest';
  distance: number;        // meters along the planned route
  pace?: number;           // s/km target (work steps, run)
  speed?: number;          // km/h target (work steps, ride)
  hr?: number;             // optional average HR target, 30–240
}
export interface Workout { blocks: WorkoutBlock[] }
export interface RestStop { distance: number; duration: number } // m along route; s, 1–86400
export interface Pauses {
  stops: RestStop[];        // sorted by distance, authored or import-detected
  auto?: { threshold: number }; // m/s detection threshold; default 0.7, import-only
}
export interface Activity {
  // …existing fields; version stays 1…
  workout?: Workout;
  pauses?: Pauses;
}
export interface Split {
  // …existing fields…
  stopped?: number;         // seconds stopped inside this split
}
export interface Simulation {
  // …existing fields…
  stopped: number;          // seconds of rest included in duration
}
```

Validation caps exported from `src/workout.ts` (mirroring the `MAX_LOOP_*`
constants in `src/model.ts`):

```ts
export const MAX_WORKOUT_REPEATS = 50;
export const MAX_WORKOUT_STEPS = 200;   // after block expansion
export const MAX_REST_STOPS = 200;
export const PAUSE_DEFAULT_SPEED = 0.7; // m/s
export const PAUSE_MIN_SECONDS = 30;
export const PAUSE_MAX_STOPS = 500;     // import detection caps
export const PAUSE_MAX_TOTAL = 7200;    // seconds
```

`validateActivity()` gains `cleanWorkout` and `cleanPauses` helpers alongside
the existing `cleanLoop`/`cleanSplits` closures, returning only explicit
fields; a work step without a usable target (missing `pace`/`speed`, or values
outside the ranges already enforced by `validateSettings()`) is rejected; a
`rest` step may omit targets (stationary) but may not carry a moving target
faster than the activity's own pace/speed.

## 5. Algorithms

### A. Workout expansion, distance matching, and repair

`expandWorkout(w)` repeats each block's `steps` list `repeat` times, in order,
producing at most `MAX_WORKOUT_STEPS` steps; beyond the cap it throws.

**Distance matching.** Let `R` be the planned route length (last value of
`cumulative(plannedPath(a))`) and `W = Σ step.distance`. Tolerance
`tol = 0.005 · R` (±0.5%).

- If `|W − R| ≤ tol`: accept; absorb the residue into the **last work step**
  (`d_last += R − W`) so step boundaries sum exactly to the route. Emit a
  notice when the adjustment exceeds 1 m.
- If `|W − R| > tol`: `simulate()` throws:
  `Workout totals X m but the route is Y m (limit ±0.5%). Scale the workout to
  the route or edit the route.` The only repair path is the explicit
  **scale-to-route** editor action: multiply every step distance by
  `f = R / W`, then re-run the absorb step on the scaled total (guarding
  against per-step float drift by accumulating boundaries from a running
  scaled sum, never per-step rounding).

**Per-step timing.** Target speed per step:
`v_i = sport==='run' ? 1000/pace_i : speed_i/3.6` (m/s); a stationary rest
step has `v_i = 0` and its time is the authored dwell (see B). Step duration
`t_i = d_i / v_i`. In `natural` mode the existing deterministic wave inside
`simulate()` (the same `.62 sin(d/430+phase) + .27 sin(d/180+phase·.7) +
.11 sin(d/70)` blend, phase from `s.seed%997/997·2π`, clamped
`.65–1.4` via `variation`) modulates the **step's** target instead of the
global pace; the per-step normalized totals are then rescaled so the whole
activity satisfies the existing duration cap/limits. Determinism is preserved:
same seed, route, and settings give identical samples.

**Workout + rests.** Rest stops insert into the elapsed timeline
independently of steps; a stationary rest step is implemented as a stop at its
anchor distance, so both authored rests and rest steps flow through one
mechanism.

**HR targets.** In `simulate()`'s heart-rate pass, samples inside a step with
an `hr` target blend toward that target (the same OU walk, but the centering
term uses the step target instead of `s.hrAverage`, interpolated across the
boundary sample to avoid a step discontinuity). Mean-preserving normalization
(subtracting the timeline-weighted mean, as the current code does) is kept.

### B. Pause/rest timing model

Stops are distance-anchored: stop `j` sits at `d_j` with duration `s_j`,
sorted by distance. With the pause-free moving timeline `T_move(d)` (exactly
what `simulate()` builds today), elapsed time becomes:

```
elapsed(d) = T_move(d) + Σ_j s_j · [ T_move(d) > T_move(d_j) ]
```

so `Simulation.duration = T_move(total) + Σ s_j` while sample `speed` stays a
**moving** quantity. `Simulation.stopped = Σ s_j` (plus zero for none).

**Stop-bracketing sample emission.** For each stop, two co-located samples are
inserted at `d = d_j`: `point = atDistance(route, c, d_j)`, `speed = 0`,
`time = start + elapsed_start(j)` and `time = start + elapsed_start(j) +
s_j·1000`. Timestamps stay strictly increasing because each closing sample is
at least 1 ms after its opening sample and the surrounding moving samples
bracket them in time; the two bracket samples share coordinates and distance,
so `timeAtDistance()` interpolation across the stop yields elapsed time without
special cases. Brackets are inserted after the main sample sweep (merging by
`time`), then `applyGpsNoise`/`applyDropout` run as today; a dropout may remove
interior bracket samples, which is acceptable because the stop's elapsed time
is carried by the regular timeline. `exportGPX`'s strictly increasing timestamp
validation is satisfied by construction; a unit test pins the invariant for
stops at distance 0, mid-route, and at the finish.

**Splits.** `computeSplits()` attributes each stop's full duration to the split
whose `[start, end)` interval contains `d_j` (boundary ties go to the earlier
split): `stopped` accumulates elapsed time where `speed === 0` between bracket
pairs; the split's reported `duration` becomes elapsed minus stopped so
`speed` remains moving pace. Invariant tested: `Σ split.duration ==
simulation.duration − simulation.stopped` and `Σ split.stopped ==
simulation.stopped`.

### Import pause detection

When `importedActivity()` kept original timestamps (`timed === true`), a
detection pass runs over the points: extend a candidate stall while the run's
cumulative `displacement(first, current) / (t_current − t_first) ≤ threshold`
(default 0.7 m/s); close the run when the running average exceeds the
threshold; keep runs with duration ≥ 30 s as stops anchored at the run's start
distance. Using the running average (not per-sample speed) prevents chattering
at the threshold. If detection would exceed 500 stops or 2 h total, it is
skipped entirely with a notice ("N possible stops exceeded the supported
limit; no rests were marked"). Runs merge adjacent slow samples, so a brief
dip below 0.7 m/s inside a moving period does not split a stall. Detection
results populate `activity.pauses.stops` and are reported in the import
notice; `pauses.auto` is never persisted from an import.

### TCX lap and course-point mapping

- **Activity export:** `<Activities><Activity Sport="Running|Biking">`, `<Id>`
  = ISO start time, then one `<Lap StartTime>` per workout step (or a single
  lap when no workout). Each lap: `<TotalTimeSeconds>` = step moving time +
  any stop dwell inside it, `<DistanceMeters>` = step distance,
  `<Intensity>Rest|Active</Intensity>` (rest steps/stops → `Rest`),
  `<TriggerMethod>Manual</TriggerMethod>`, `<Track>` with that step's
  `<Trackpoint>`s (`<Time>`, `<Position>`, `<AltitudeMeters>`,
  `<HeartRateBpm><Value>`, `<TPX><Speed>` in m/s). `<TotalTimeSeconds>` per lap
  is the moving-or-dwelling total; no values are invented for sensors not
  simulated.
- **Course export:** `<Courses><Course>` with `<Track>`, `<Lap>` absent, and
  `<CoursePoint>` entries: one per workout step start (`Name` =
  `Step n · 1 km · 5:00 /km`, `PointType=Generic`) plus one per rest stop
  (`Rest 2 min`, `PointType=Generic`); cue-sheet turns from `cues()` may be
  appended when the activity has no workout, reusing `src/cues.ts` output.
- **Import:** reject >15 MB and DOCTYPE/entities (same guard as
  `importGPX`), parse with `DOMParser`, reject a non-`TrainingCenterDatabase`
  root, collect all `<Trackpoint>`s grouped by `<Track>`, keep the largest,
  clean lat/lon/ele/time/hr exactly as `importGPX` does, and hand off to
  `importedActivity()` with the `<Activity>`'s `<Id>`/`<Notes>` as name/type
  text; notices mention that timing is resimulated unless timestamps are
  strictly increasing.

### FIT encoding and CRC

Standard-profile **activity** file only. Message order: `file_id` (type 0,
`file_type=4` activity, `time_created`), `session` (18), one `lap` (19) per
workout step (or one finish lap), `record` (160) per sample, `course_point`
(32) per workout/cue point, and `event` (21) timer events: before each stop,
`event=0 (timer), event_type=1 (stop)`; after, `event=0, event_type=0 (start)`
— giving devices explicit rest-timer boundaries matching the bracket samples.

- Little-endian (`architecture=1`); one definition message per message type
  (local types 0–4); plain (uncompressed) data records.
- Record fields: `timestamp` (s since 1989-12-31), `position_lat/long`
  (semicircles: `deg · 2³¹ / 180`), `altitude` (scale 5, offset 500),
  `distance` (scale 100, m), `speed` (scale 1000, m/s), `heart_rate`, plus
  `speed`/`distance` per the sample stream (zero speed inside stops).
- Lap fields: `total_elapsed_time` (moving + stops, scale 1000),
  `total_timer_time` (moving only), `total_distance` (scale 100),
  `avg_speed`, `total_ascent`, `sport`, `intensity`.
- **CRC:** standard FIT CRC-16: poly `0x8408` (reflected 0x1021), init `0`,
  no final xor — per byte: `crc = (crc >> 8) ^ table[(crc ^ byte) & 0xFF]`
  over a precomputed 256-entry table. The data-section CRC follows all
  messages; the 14-byte header (`header_size=14, profile_version, data_size,
  ".FIT"`) ends with the CRC over its first 12 bytes. Both are tested against
  a hand-computed vector (the canonical CRC-16/BUYPASS-family check used by
  the FIT spec: CRC of bytes `01 02` = `0xC442`… the exact vector is captured
  from the SDK example during milestone 4 and pinned in the test).
- **Import (scoped):** `decodeFIT(bytes)` verifies header magic/size/CRC,
  walks definition/data records with a local-type table, and extracts only
  `file_id`, `record`, `lap`, `session`, `event(timer)`, and `course_point`;
  unknown message numbers are skipped, malformed records throw with a byte
  offset, and any unsupported construct (developer fields, courses) produces a
  notice rather than a failure. Extracted geometry feeds `importedActivity()`;
  timer stop/start pairs feed import pause detection.

## 6. Exact changes to `src/model.ts` and `src/gpx.ts`

### `src/model.ts`

1. **`validateActivity()`** — add `cleanWorkout`/`cleanPauses` closures; append
   `...(workout ? {workout} : {}), ...(pauses ? {pauses} : {})` to the
   explicitly built return object (same pattern as `loop`/`splits`).
2. **`simulate()`** — after the existing duration computation:
   - call `resolveWorkout(a)` (from `src/workout.ts`), which either throws the
     ±0.5% mismatch error or returns expanded steps whose distances sum exactly
     to `total`;
   - replace the flat weight loop with a per-interval weight that divides by
     the enclosing step's target (so each step's moving time converges to
     `d_i / v_i`), keeping the identical wave/phase inputs so non-workout
     activities are unchanged; then normalize per-step totals to step targets
     before the global rescale to `durationMs`;
   - add stationary rests as stops (authored `pauses.stops` plus rest steps)
     and run the bracketing pass from §5-B, producing `duration` including
     stops and `stopped` seconds;
   - the returned `Simulation` gains `stopped:number`.
3. **`splitBoundaries(a, total)`** — unchanged logic; deliberately **not**
   extended with stop anchors (stops must not create split boundaries).
4. **`computeSplits(a, s)`** — compute per-split elapsed duration as today,
   then subtract stopped time attributed to the containing split (from the
   bracket pairs / stop list) to get moving `duration`, set
   `stopped`, and derive `speed = distance / duration` (guarding `duration > 0`,
   as the current code does). Fully stopped splits report `speed 0`.
5. Export `timeAtDistance` (currently module-private) for `src/tcx.ts` lap
   slicing.

### `src/gpx.ts`

- `exportGPX(a, s)`:
  - When `a.workout` exists, split the emitted `<trkseg>`s at **workout step
    boundaries** in addition to the existing dropout-gap segmentation, and add
    a `<desc>` sentence noting intervals are represented as track segments and
    that lap precision requires TCX/FIT.
  - When `s.stopped > 0`, append to `<desc>`: `Includes N simulated rest
    stop(s) totalling m:ss.` (stops are authored or detected, never measured).
  - When `a.workout` exists, emit `<wpt lat/lon><name>Step n · 1 km · 5:00</name>
    <sym>Flag, Blue</sym></wpt>` course points at step starts (escaped via the
    existing `escapeXML`).
  - No change to the existing validation or segment-gap logic; bracketing
    samples satisfy it by construction.
- `importGPX` is unchanged (detection lives in `src/import.ts` so every format
  benefits).

## 7. New files: exported signatures

```ts
// src/workout.ts (pure, DOM-free)
export interface ExpandedStep {
  kind: 'work' | 'rest';
  distance: number;          // meters
  pace?: number; speed?: number; hr?: number;
  targetSeconds: number;     // moving time target (0 for stationary rest)
}
export function expandWorkout(w: Workout): ExpandedStep[];
export function workoutDistance(w: Workout): number;
export function stepBoundaries(steps: ExpandedStep[]): number[];
export function stepIndexAt(steps: ExpandedStep[], d: number): number;
export function scaleWorkout(w: Workout, routeMeters: number): Workout;
export function resolveWorkout(a: Activity): { steps: ExpandedStep[]; notices: string[] };
export function workoutCoursePoints(a: Activity): { distance: number; name: string }[];
```

`resolveWorkout` is the single entry `simulate()` calls; it validates caps,
expands, absorbs/throws on distance mismatch, and returns deterministic step
times. `workoutDistance`, `stepBoundaries`, and `scaleWorkout` are exported for
the editor UI and `cleanWorkout` validation.

```ts
// src/tcx.ts
export type TCXMode = 'activity' | 'course';
export function exportTCX(a: Activity, s: Simulation, mode: TCXMode): string;
export function importTCX(xml: string): ImportResult;   // reused ImportResult from src/import.ts
export function downloadTCX(a: Activity, mode: TCXMode): void;
```

```ts
// src/fit.ts (binary; Node-testable; no DOM)
export function exportFIT(a: Activity, s: Simulation): ArrayBuffer;
export function decodeFIT(bytes: ArrayBuffer): ImportResult;   // scoped activity import
export function fitCRC16(data: Uint8Array, init?: number): number;  // test hook
export function downloadFIT(a: Activity): void;                // Blob 'application/octet-stream'
```

## 8. UI/UX changes (`src/main.ts`, `src/editor.ts`, `public/index.html`)

- **`src/editor.ts`:** extend the undo `Snapshot` to
  `{path, waypoints, source, workout?, pauses?}` and add `setWorkout()`,
  `addRestStop()`, `removeRestStop()`, and threshold editing following the
  existing `setLoop`/`setSplits` pattern (checkpoint → validate → notify).
  Route mutations keep pauses but invalidate stops that fall beyond the new
  route length (notice via `onMessage`).
- **`public/index.html`:** a Workout section in the inspector styled like the
  loop planner (`#loop-*`): step rows, add/remove, repeat input, total vs
  route distance with a `Scale to route` button shown only on mismatch, and a
  Rests list with add-at-distance and remove controls.
- **`src/main.ts`:**
  - render: moving/stopped time line under `duration-stat` when
    `sim.stopped > 0`; split-table gains a "Stopped" column populated from
    `Split.stopped`; a workout summary line (steps count, total distance,
    match status) with a repair affordance when mismatched;
  - export: new buttons beside `#export` wired with the existing `on()`/
    `guarded()` helpers, calling `downloadTCX`/`downloadFIT` after `validRoute()`;
  - import: `importRouteFile()` still handles dispatch; `main.ts` reads
    `.fit` files as `ArrayBuffer` (`file.size` cap 15 MB preserved) and passes
    an `ArrayBuffer` for FIT vs `text` for XML/JSON formats.

## 9. Export and honesty-labeling implications

- Every new export identifies simulated output: GPX `<desc>` already says
  "not a recorded workout or device measurement"; TCX `<Notes>` and the FIT
  session `name`/`notes` carry the same sentence, extended with "Interval
  structure, rest stops, and targets are simulated" when workouts/pauses are
  present. Nothing implies measured data: rest durations are labeled authored
  or detected, HR targets are targets, and unsupported metrics are omitted
  rather than invented.
- GPX remains an approximation of workouts (segments + course points); TCX/FIT
  carry true laps. FIT import skips unsupported features with explicit notices.
- Import notices from `importedActivity()` already state exports are
  resimulated; TCX/FIT imports reuse it so the notice stays truthful.

## 10. Test plan

Node tests import built output from `dist/src/*.js` (as `tests/core.test.mjs`
does). New files:

- **`tests/workout.test.mjs`**
  - validation: >200 expanded steps, >50 repeats, missing work target, bad HR
    → thrown; clean round-trip through `validateActivity`.
  - expansion math: 3 × (1 km @ 5:00 + 500 m rest) on a 4.5 km route —
    per-step durations, boundaries, and `simulate()` totals.
  - distance matching: +0.4% absorbed with notice; +1.2% throws from
    `simulate()`; `scaleWorkout` repair produces the notice and matches.
  - splits carry step boundaries; split pace matches step targets.
  - determinism: two `simulate()` runs byte-identical; non-workout activity
    output unchanged (existing golden preserved until milestone 1 re-pin).
- **`tests/pauses.test.mjs`**
  - dwell timing: 60 s stop extends `duration` by 60 s; bracket samples
    co-located, zero speed, strictly increasing times (cases at distance 0,
    mid-route, and at the finish).
  - splits: stopped attributed to the right split; elapsed reconciles
    (`Σ duration + Σ stopped == sim.duration`); no boundary added at stops.
  - import detection: 45 s stall detected; 29 s not; 600 stalls skipped with
    notice; >2 h total skipped; no timestamps → no detection, notice present;
    threshold validation bounds (0.1–5 m/s).
  - `importedActivity()` notices list detected stops and total stopped time.
- **`tests/formats.test.mjs`**
  - TCX activity: laps equal workout steps; rest laps; escaping of names via
    `escapeXML`; import returns geometry + notices.
  - TCX course: `<CoursePoint>` count/names/positions; import path.
  - FIT: header magic and CRC, data-section CRC, known-vector CRC test,
    record decode round-trip (lat/lon within 1 m, speed/distance scales),
    timer stop/start pairs per stop, lap count equals step count; decode of
    unknown message types skips with notice; corrupted header CRC throws.
  - Browser-level (in `tests/browser.py`): author a workout, export TCX and
    FIT through the existing `window.testDownloads` capture, parse and assert
    laps/course points/magic bytes; check the moving/stopped UI line and the
    split stopped column.

## 11. Verification commands

```sh
npm test                 # build + all Node tests (52 existing + new suites)
npx tsc --noEmit         # strict TypeScript gate (part of npm test, listed for isolation)
python tests/browser.py --isolated                # DOM-only harness
python tests/browser.py --url http://127.0.0.1:5173  # full Playwright pass (after `npm run dev`)
```

Every milestone requires the full suite green, not only its new test file.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `simulate()`/`computeSplits()` are shared with later plans; behavior drift | Pauses land first with a single announced golden re-pin; workouts build on that baseline; each milestone runs the full suite, and non-workout/non-pause outputs must be unchanged except where the golden was re-pinned. |
| FIT profile constants (field numbers, scales, CRC) are easy to get subtly wrong | Milestone 5 starts by pinning the SDK-verified constant table; CRC has its own known-vector test; the importer is scoped to activity files and skips unknown messages with notices. |
| Unit drift between formats (m/s vs km/h, semicircles vs degrees) | One conversion helper per format with hand-computed unit tests. |
| Bracketing samples violating strictly increasing timestamps | Enforced by construction (≥1 ms separation) and pinned by dedicated tests. |
| Import auto-pause false positives | Conservative defaults (0.7 m/s, 30 s, caps 500/2 h), always reported via notices, editable/removable after import, never re-detected on re-export. |
| Binary import of untrusted data | Size caps before parse, bounded record counts, per-record try/catch skip-with-notice, no string decoding of unbounded length. |
| TCX/FIT import pulling untrusted XML | Reuse the GPX guards: DOCTYPE/entity rejection, 15 MB cap, `DOMParser` `parsererror` checks. |

## 13. Ordered milestones (each with its verification step)

1. **Pause engine** (types, `cleanPauses`, bracketing samples, elapsed vs
   moving time, `Split.stopped`, GPX rest metadata).
   *Verify:* `npm test` with `tests/pauses.test.mjs`; golden re-pin reviewed.
2. **Import pause detection** (stall detection in `src/import.ts` + notices +
   caps).
   *Verify:* `tests/pauses.test.mjs` detection cases; `python
   tests/browser.py --isolated`.
3. **Workouts** (`src/workout.ts`, `simulate()` step timing, split boundaries,
   editor/UI controls, GPX segments/course points).
   *Verify:* `npm test` with `tests/workout.test.mjs`.
4. **TCX export/import** (`src/tcx.ts`, export actions, dispatch, lap/course
   modes).
   *Verify:* `tests/formats.test.mjs` TCX cases green.
5. **FIT writer/importer** (SDK-verified constants, CRC vectors, scoped
   decoder, export action).
   *Verify:* `tests/formats.test.mjs` FIT cases; `python tests/browser.py
   --url http://127.0.0.1:5173` exercising the export path end-to-end.

