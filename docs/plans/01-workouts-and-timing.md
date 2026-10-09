# SimRun feature cluster plan — structured workouts, pauses/rests, FIT & TCX formats

Repo: `/tmp/hoplite/workspace`, branch `hoplite/lilaia-d62e62ed`. Scope: one feature cluster covering (1) structured interval workouts, (2) pause/auto-pause and rest stops, (3) FIT and TCX export/import alongside GPX. This document is design + implementation planning only; no code is implemented here.

Stack constraints honored throughout: strict TypeScript, native DOM, ES modules, no new runtime dependencies (only `typescript` 5.8.3), Node 20+, `npm test` = `npm run build && node --test tests/*.mjs`. Simulation stays deterministic and seeded; all exports keep the existing "simulated, not measured" honesty labeling.

---

## 0. Grounding — existing code this plan builds on

Anchors cited below were read on this branch:

| Anchor | Where | Relevance |
|---|---|---|
| `Point`, `Sample`, `Split`, `Activity`, `Settings` | `src/types.ts` | Data model all three features extend |
| `MAX_LOOP_LAPS/MAX_LOOP_DISTANCE/MAX_LOOP_POINTS` | `src/model.ts` (top) | Caps reused by workout/pause validation |
| `defaults()`, `importedActivity()` | `src/model.ts` | Defaults and notice/honesty-label conventions |
| `validateActivity()`, `cleanLoop()`, `cleanSplits()` | `src/model.ts` | Pattern for validating new activity metadata |
| `simulate()`, `durationFor()`, `startTime()` | `src/model.ts` | The timing pipeline workouts and pauses integrate with |
| `splitBoundaries()`, `computeSplits()`, `timeAtDistance()`, `applyGpsNoise()`, `applyDropout()` | `src/model.ts` | Split math and segment-gap semantics pauses must respect |
| `loopPlan()`, `plannedPath()`, `LoopResult` | `src/model.ts` | The loop/distance planner workouts layer onto |
| `exportGPX()`, `downloadActivity()`, `importGPX()`, `escapeXML()`, `safeFilename()` | `src/gpx.ts` | GPX conventions: honest metadata, trkseg-per-gap rule |
| `cues()`, `cueSheetCSV()`, `elapsed()` | `src/cues.ts` | Cue derivation reused for course points |
| `importRouteFile()`, `largest()`, `merge()`, `parseKmlCoordinates()` | `src/import.ts` | Import dispatch and largest-segment conventions |
| `Editor.changeSettings()`, `Editor.setSplits()`, `checkpoint()` | `src/editor.ts` | Patterns for new editor state and undo |
| `render()`, `updateSettings()`, `validRoute()` | `src/main.ts` | UI wiring and pre-export validation |
| `.export-actions` footer (`#save #cues #export`), loop/splits controls | `public/index.html` | UI mount points |
| `LocalStore`, `parseBackup()` | `src/storage.ts` | Persistence constraints (additive fields) |
| `Charts` | `src/charts.ts` | Pace/elevation/HR rendering impact |
| `testDownloads` Blob capture | `tests/browser.py` | Existing browser export-verification hook |

Conventions reused throughout:

- **Determinism:** all timing is a pure function of route + settings + `settings.seed` (the seeded wave/grade pipeline in `simulate()` and `gpsRandom()`-based jitter/dropout). New features add deterministic terms only.
- **Honesty labeling:** GPX `<metadata><desc>` already declares simulated output, including a dedicated string when noise/dropout is enabled (`src/gpx.ts`); `cueSheetCSV` labels simulated elapsed time; `importedActivity` appends "Exports are explicitly resimulated, not original recordings." New formats and features must emit equivalent labels.
- **Validation:** new activity fields follow the `cleanLoop()`/`cleanSplits()` pattern in `validateActivity` — explicit field selection, no merging of untrusted objects, ranges aligned with `validateSettings`.

---

## 1. Feature A — structured interval workouts

### Goals

- Author work/rest sequences (e.g. 8 × 1 km @ 4:00/km with 400 m jog rest, warmup/cooldown blocks) layered on the existing loop/distance planner — the route is fixed; the workout supplies per-segment timing targets.
- Targets per work step: pace (run) or speed (ride), optional HR target; rest steps are an easy pace or fully stationary.
- Store as activity metadata; validate with the existing activity-validation machinery.
- Export as GPX lap boundaries (`<trkseg>` per step) and per-step course-point-style `<wpt>` markers; full fidelity lands via TCX/FIT (Feature C). Reuse the deterministic simulation engine — interval timing is a deterministic function of route + workout + seed.

### Non-goals

- No reusable workout templates/library, no workout sync to training platforms, no cloud anything.
- No structured-workout file import (Garmin `.wko`-style); workouts are authored in-app.
- No per-step routing or step-anchored waypoints; steps are distance ranges over the existing planned route.
- No power/cadence targets, no open-ended steps ("until lap press").
- No workout-specific GPX extensions beyond course-point-style waypoints and per-step segments (GPX 1.1 has no native workout concept; TCX in Feature C carries laps natively).

### Design

**Data model additions (exact TS, `src/types.ts`):**

```ts
export interface WorkoutStep { kind:'work'|'rest'; distance:number; pace:number; speed:number; hr?:number }
export interface WorkoutBlock { repeat:number; steps:WorkoutStep[] }
export interface Workout { blocks:WorkoutBlock[] }
// Activity gains an optional field: workout?:Workout
```

Semantics:

- Distances are meters along `plannedPath(a)` (post-loop resolution), consistent with how `loopPlan()` and `splitBoundaries()` are meter-anchored.
- `pace` (s/km) / `speed` (km/h) mirror `Settings`; the active field follows `settings.sport`.
- Rest steps use a jog pace/speed; **stationary** rest (standing) is expressed with `pace:0`/`speed:0` and is realized through the pause dwell engine (Feature B) rather than a pace. Validation distinguishes the two.
- Optional `hr` (30–240) is the work-step HR target consumed by the existing HR synthesis when `hrEnabled`.

**Algorithms (`src/workout.ts`, new pure module — no `model.js` imports, mirroring `geometry.ts`/`cues.ts` purity):**

- `expandWorkout(w:Workout):WorkoutStep[]` — flatten blocks by `repeat`; caps: expanded steps ≤ 200, per-step distance ≤ `MAX_LOOP_DISTANCE`, total distance ≤ `MAX_LOOP_DISTANCE` (reuse the existing caps rather than new constants).
- `workoutDurationFor(steps, sport):number` — Σ moving-step time via the same pace/speed math as `durationFor()`; stationary steps contribute 0.
- `cumulativeSteps(steps)` + `stepAtDistance(steps, meters)` — bisect with `lowerBound` from `src/geometry.ts`.
- `scaleWorkout(w:Workout, routeMeters:number):Workout` — proportionally rescale step distances; the UI offers this when route and workout disagree.

**Simulation integration (`src/model.ts` `simulate()`):**

- When `a.workout` is present (and route distance matches within ±0.5%), replace `durationFor(total,…)` with `workoutDurationFor(...)`. Mismatch throws with both values named (route vs workout distance) and a hint to scale.
- Per-interval base factor `k = targetPace/s.pace` (run) looked up via `stepAtDistance` on the interval midpoint; existing natural-mode behavior becomes `k` multiplied by the wave/grade term (clamped as today); constant mode uses exactly `k`. Per-step normalization: after the raw-time walk, each step's span is rescaled so the step's elapsed equals its target duration exactly — targets stay honest per step, variation stays relative.
- HR: baseline = containing step's `hr` (fallback `s.hrAverage`) + the existing seeded distance waves and warmup transient; bounds 30–240 as today.
- Duration/distance guard rails unchanged (1 m–5,000 km, 0.01 s–7 days, applied to the workout total).

**Splits interaction:** `computeSplits()` gains the expanded step boundaries as implicit markers via `splitBoundaries()` (they are distance-based, like custom markers), so the existing splits table shows per-step pace with no new rendering path.

**UI/workflow:**

- "Workout" fieldset in the inspector beside loop/splits: block with repeat count, steps list (kind toggle, distance, target via existing `parseClock`/`clock` pace input conventions, optional HR), add/remove, "Scale to route" repair action.
- New `Editor.setWorkout()` mirroring `setSplits()`; snapshots include `workout` so undo/redo covers it.
- Summary line styled like `#loop-summary`: "8 × 1 km @ 4:00/km · 26:00"; when a workout is active, the global pace/speed fields become display-only for the routed base and the workout drives timing.

### Files/functions to touch

- `src/types.ts` — add `Workout`, `WorkoutBlock`, `WorkoutStep`; `Activity.workout?`.
- `src/workout.ts` (new) — the pure helpers above.
- `src/model.ts` — `simulate()` (duration selection, per-step weighting/normalization), `splitBoundaries()` (step markers), `validateActivity()` (new `cleanWorkout()` beside `cleanSplits()`).
- `src/editor.ts` — `setWorkout()`; snapshot/restore (undo) includes workout.
- `src/main.ts` — render wiring mirroring the loop inputs (`setInput('loop-value')` pattern), handlers guarded by `guarded()`.
- `public/index.html` — workout fieldset near the loop/splits controls.
- `src/gpx.ts` `exportGPX()` — per-step `<trkseg>` + `<wpt>` course points (names like "Work 3 · 4:00/km"), inside the existing escaping/sanitizing helpers.

### Ordered implementation milestones (each with a concrete verification step)

1. **Types + validation.** Add types and `cleanWorkout()`; accept/reject stored activities correctly. *Verify:* new node tests in `tests/workout.test.mjs` for `validateActivity`: accepts a valid workout; rejects repeat > 50, > 200 expanded steps, pace outside [60,3600], step HR outside 30–240; existing suite still green (`npm test`).
2. **Workout engine.** `simulate()` honors steps with per-step normalization. *Verify:* deterministic node test: 5 × (1 km @ 4:00/km + 200 m rest @ 6:00/km) ⇒ total 26:00, each work step within ±1 sample-interval of 4:00/km, rest steps within target; same seed ⇒ identical `Simulation`.
3. **Splits integration.** Step boundaries appear in the splits table. *Verify:* node test that `computeSplits` produces boundaries at each step start and that durations still sum to total (pattern from the existing split tests in `tests/core.test.mjs`).
4. **GPX export.** Per-step segments + waypoints. *Verify:* node test asserting trkseg count = expanded step count, escaped waypoint names, and the unchanged simulated-activity `<desc>`; browser test inspects the Blob from `testDownloads`.
5. **UI + persistence.** *Verify:* `tests/browser.py` scenario — author a workout via the form, save/reopen from history, re-export, assert byte-identical GPX; responsive check at 390 px like existing layout tests.

### Testing strategy

- `tests/workout.test.mjs` (new): expansion/scale math, caps, validation accept/reject, per-step duration targets under `constant` and `natural` modes (seeded determinism mirrors existing HR/natural tests), GPX lap/waypoint structure, escaping.
- `tests/browser.py` additions: workout authoring flow, invalid-target toasts, export/import round-trip, course-point rendering in the exported XML.

### Risks & format/provider limitations

- GPX 1.1 has no laps concept; per-step `<trkseg>` + `<wpt>` is the portable approximation (GPX 1.1 creator metadata already carries the honesty note). Full fidelity lands in TCX/FIT.
- Route/workout mismatch is a user-error surface; the ±0.5% tolerance and `scaleWorkout` repair keep it explicit rather than silently rescaling.
- Very short steps (< sample interval) round like fractional final laps do today; document the effective-interval behavior already shown in the UI.

**Effort estimate:** 3–4 dev-days.

**Honesty labeling:** GPX output keeps the existing `<desc>` simulated-activity declaration verbatim; course points are annotations on a simulated track and the CSV cue sheet's "not a recorded workout" note is unchanged.

---

## 2. Feature B — pause, auto-pause, and rest stops

### Goals

- Model contiguous zero/near-zero-speed stretches so exports look like real stop-start activities (coffee stop, traffic light, aid station).
- Auto-pause applies at **import**: existing stalls in imported files become explicit rest stops; manual rests are authored on the route. Stationary rest steps from Feature A reuse this engine.
- Keep duration/splits/timing scaling coherent: elapsed duration includes rest; moving pace excludes it.

### Non-goals

- No runtime auto-pause simulation heuristics (the simulator has no external trigger to react to; stalls are authored or imported).
- No pause-segmented export formats in this feature (FIT timer events come with Feature C).
- No per-stop street context/labels; rests are positioned by distance, not geocoded places.

### Design

**Data model additions (exact TS):**

```ts
export interface RestStop { at:number; seconds:number }  // meters into planned path; stopped seconds
export interface Pauses { auto:boolean; threshold:number; stops:RestStop[] } // threshold m/s for import detection
// Activity gains: pauses?:Pauses
// Split gains: stopped?:number
```

**Interaction with duration/splits/timing (the core design):**

- Moving time stays the existing model: `durationFor(total, sport, pace, speed)` plus natural-mode waves. Rest time is *added*: `total = movingDuration + Σ stops.seconds`, subject to the same 7-day ceiling in `simulate()` (the error message names both budgets).
- Within the sampling loop, elapsed time at interval *i* becomes `movingTime(i) + dwell(i)` where `dwell(i)` = Σ seconds of stops with `at ≤ d(i)`. Speeds derive from actual time deltas, so the sample spanning a rest reports near-zero speed; two explicit co-located samples bracket each stop (same distance, `speed:0`, strictly increasing times) even when the rest is shorter than the sample interval.
- `timeAtDistance()` remains correct: time is strictly increasing even where distance plateaus, and the existing `seg>0` fallback already handles zero-distance spans.
- `splitBoundaries()`/`computeSplits()`: stop positions do **not** become split boundaries (matching device behavior); each `Split` gains `stopped` (overlap of the split with stop spans) while `duration` remains elapsed-based, so splits still sum to the activity total (acceptance item 16's invariant).
- Loop interaction: stops are meters into `plannedPath()` (after the loop plan); a rest at 6 km of a 5 km × 3-lap plan lands in lap 2. Documented in UI copy; no per-lap repetition semantics.

**Auto-pause at import (`src/model.ts` `importedActivity()`):**

- Only when original timestamps are strictly increasing (the existing `timed` check): detect contiguous stretches where displacement between stretch endpoints ÷ elapsed ≤ `threshold` (default 0.7 m/s) lasting ≥ 30 s; each becomes a `RestStop` at the stretch's start distance with the stretch's duration; duplicate co-located points inside the stretch are dropped from the retained geometry and replaced by the bracketing samples at export time.
- The derived pace/speed switches from total elapsed to moving time (subtracting detected stops), so derived targets aren't diluted by stalls.
- Notices: "Detected N stops totaling M min; exports will include matching rest periods." Caps: > 500 stops or total rest > 2 h → skip auto-detection with an explanatory notice (falls back to today's behavior).
- Validation caps mirror `cleanSplits`: `stops ≤ 500`, `0 < seconds ≤ 4 × 3600`, `at` within [0, route distance], `threshold` in [0.1, 5] m/s.

**UI/workflow:** "Rest stops" list beside Splits: pick-on-route (reusing the loop-start map-pick interaction), duration input in minutes, list with remove; auto-pause toggle + threshold live with import settings. Stats show "elapsed" (moving + rest) as today's duration, with moving time surfaced in the inspector line.

### Files/functions to touch

- `src/types.ts` — `RestStop`, `Pauses`, `Split.stopped?`, `Activity.pauses?`.
- `src/model.ts` — `simulate()` dwell integration and stop-bracket samples; `splitBoundaries()`/`computeSplits()` `stopped`; `validateActivity()` `cleanPauses()`; `importedActivity()` stall detection.
- `src/gpx.ts` — `exportGPX` metadata note "Includes simulated rest stops." when pauses exist; no structural change (samples already carry the stop).
- `src/cues.ts` — `elapsed()` already interpolates on monotone time and co-located samples; only needs a regression test.
- `src/editor.ts` — pause editing via map pick (`setPauses()` mirroring `setLoop({start})` handler path), undo integration.
- `src/main.ts` / `public/index.html` — rest-stop controls, stats line, history rendering.

### Ordered milestones (each with verification)

1. **Dwell engine in `simulate()`.** *Verify:* node test — 10 km at 6:00/km with one 300 s rest at 5 km ⇒ duration 1:05:00; co-located stop samples have equal distance, `speed 0`, strictly increasing `time`; determinism: same seed ⇒ identical output.
2. **Validation + splits.** *Verify:* `cleanPauses()` accept/reject tests; splits reconcile (Σ durations = total, Σ stopped = total stopped) in `tests/pause.test.mjs`.
3. **Import detection.** *Verify:* fixture GPX with a 10-min stall imports to one `RestStop`; moving pace excludes the stall; notice string asserted; `pauses.auto:false` skips detection.
4. **GPX note + UI.** *Verify:* browser test asserts the desc note, rest controls, and that a seeded re-export is byte-identical; cue CSV elapsed at the rest reflects the dwell (via `elapsed()`).

### Testing strategy

`tests/pause.test.mjs`: duration math incl. cap; monotone-time invariant across a stop; co-located sample pair; `computeSplits` stopped sums; determinism (same seed twice); import detection thresholds (29 s ignored, 31 s detected; drift just under threshold detected); export/import round trip keeps the stall; trkseg splitting is **not** triggered by rests (contrast with `applyDropout` gaps).

`tests/browser.py` additions: authored rest stop → Blob GPX contains the stationary stretch and honesty note; history round-trip preserves `pauses`.

### Risks & limitations

- Import detection is heuristic; jitter near stops can hide stalls — detection is announced, never silent, and the threshold is user-visible.
- Long stops inflate elapsed-time splits; the splits table gains a "stopped" column so the split remains readable (display-only change in `main.ts`).
- Memory: stop samples reuse the existing per-interval budget; the 40,000-interval cap already bounds the point count.

**Effort estimate:** 2–3 dev-days.

**Honesty labeling:** export metadata explicitly says rests are simulated ("Includes simulated rest stops"), keeping the not-a-measurement declaration accurate.

---

## 3. Feature C — FIT and TCX export/import alongside GPX

### Goals

- TCX export (activity with laps; course with navigable course points from cues + workout steps) and TCX import.
- FIT export (binary activity file with FileId/Activity/Session/Lap/Record + Event-based pauses + CoursePoint cues) and a scoped FIT import.
- Same determinism, honesty labels, and provider-independence as GPX today.

### Non-goals

- No FIT developer fields, no FIT courses files, no multi-session FIT.
- No TCX workout-plan authoring; the interval workout rides in course points/laps.
- No schema validation at runtime; XSD/FitCSVTool validation is a dev-time check (mirrors the repo's GPX practice and acceptance item 15).

### Format facts (with citations; see References)

**FIT (Garmin FIT SDK):**
- Activity files must contain: `FileId` message first (file type = activity), one or more `Session` messages, and an `Activity` message; `Lap`, `Record`, and `Event` messages carry laps, tracks, and timer state (Garmin "Activity File" article).
- Binary structure: header containing header size, protocol version, profile version, data size and the `".FIT"` magic; optional header CRC; body CRC (as implemented by reference decoders such as GPSBabel's/Viking's `fit.c`).
- Message numbers used by this feature: FileId = 0, Record = 20, Lap = 19, Session = 18, Activity = 34, Event = 21, CoursePoint = 32 (per the FIT profile; re-verify against the SDK `Profile.xlsx`/`Profile.csv` before implementation — flagged as a milestone verification, not assumed).
- Timestamps: seconds since 1989-12-31 UTC; positions in semicircles (deg × 2³¹/180); lat/lon endianness per-message architecture flag; activity file type in FileId = 4.

**TCX (TrainingCenterDatabase v2 XSD):**
- `TrainingCenterDatabase_t` children: Folders, Activities, Workouts, Courses, Author, Extensions.
- `CoursePoint_t` required child order: Name (CoursePointName_t), Time (dateTime), Position; optional AltitudeMeters (double); required PointType (`CoursePointType_t`); optional Notes, Extensions.
- `CoursePointEnum` values and their FIT codes: Generic(0), Summit(1), Valley(2), Water(3), Food(4), Danger(5), Left(6), Right(7), Straight(8), First Aid(9), 4th/3rd/2nd/1st Category(10–13), Hors Category(14), Sprint(15), Left/Right/Middle Fork(16–18), Slight Left(19), Sharp Left(20), Slight Right(21), Sharp Right(22), U Turn(23), Segment Start(24), Segment End(25).
- Activity `Trackpoint_t`: Time, optional Position, AltitudeMeters, DistanceMeters, `HeartRateBpm/Value`, cadence, extensions.

### Design

**TCX export (`src/tcx.ts`, new pure module):**

```ts
export type TcxMode = 'activity' | 'course';
export function exportTCX(a:Activity, s:Simulation, mode:TcxMode):string
export function importTCX(xml:string):{activity:Activity;notice:string}   // DOM-based, mirrors importGPX
```

- `activity` mode: `Activities/Activity` with `Id` = simulated start time, laps from `computeSplits` (TotalTimeSeconds, DistanceMeters, AverageSpeed via `MaximumSpeed?` omitted), one `Track` per gap-separated segment (reuse the exact segmentation rule from `exportGPX`), heart rate in `HeartRateBpm`, and an activity-level `Notes` carrying the simulated-activity label.
- `course` mode: `Courses/Course` with `Track`, `Lap`, and `CoursePoint`s from `cues(plannedPath(a))` plus workout steps. Type mapping: `Start`→`Segment Start`(24), `Finish`→`Segment End`(25), `Slight Left/Right`→`Slight Left`/`Slight Right`, `Sharp Left/Right`→`Sharp Left/Right`, `Left/Right`→`Left`/`Right`, `U-turn`→`U Turn`, straight→`Straight`; workout steps → `Generic` course points named "Work n"/"Rest n". Each `CoursePoint` carries simulated elapsed time (from `elapsed()` in `src/cues.ts`) and altitude when present; `Notes` on the Course carries the simulated-activity statement.
- XML escaping and filename sanitization reuse `escapeXML`/`safeFilename` from `src/gpx.ts`; drafts rejected like `downloadCues`.

**TCX import:** `importTCX()` picks the largest track across `Activities`/`Courses` (same "largest segment, notice for the rest" rule as `importGPX`), reads position/ele/time/HR with the same validity clamps, then hands off to `importedActivity()`. Registered in `importRouteFile()` (extension `.tcx`, plus content sniffing by root element) in `src/import.ts`.

**FIT export (`src/fit.ts`, new pure module):**

- `encodeFIT(a:Activity, s:Simulation):Uint8Array` — a minimal, standard-profile writer: 12-byte header + CRC16 table (CRC-16/CCITT-FALSE), FileId (manufacturer/`SimRun` product, activity type), Activity (local timestamp, session count 1), Session (sport `running`/`biking` from `settings.sport`, start time, total timer/distance/ascent from `Simulation` + `elevationStats`), one Lap per split boundary (`splitBoundaries`), Record messages from `Sample`s (semicircle positions, altitude, HR, distance), Event timer stop/start around rest stops (Feature B), and per-step CoursePoint messages for workouts. Messages are little-endian with the per-message architecture flag; no developer fields.
- Honesty: Session `name` prefixed "Simulated:"; FileId product string `SimRun`.

**FIT import:** `decodeFIT(bytes)` — header/CRc parse, definition-message table (per-message endianness, base-type sizes), compressed-timestamp expansion, then FileId/Session/Lap/Record extraction with the same validity rules as GPX import (coordinate, ele, hr bounds; 15 MB / 100,000-point caps; unknown/dev-field messages skipped with a notice). Because FIT is binary, `importRouteFile()` gains an ArrayBuffer branch and `".FIT"` magic sniffing (byte offset 8) before text-format dispatch.

**Cue/turn mapping (`src/cues.ts`):** export a pure `coursePointType(turn:string):string` mapping so TCX (now) and FIT CoursePoint (milestone 5) share one mapping; FIT codes mirror the TCX enum per the cross-reference table.

### Files/functions to touch

- New: `src/tcx.ts`, `src/fit.ts`.
- `src/import.ts` — `importRouteFile()` dispatch + sniffing; reuse `checkSize`/`largest`/`merge` helpers.
- `src/cues.ts` — shared course-point-type mapping export.
- `src/main.ts` + `public/index.html` — export actions beside `#export`/`#cues` in `.export-actions`; import accept attribute extended.
- `src/gpx.ts` — no changes (GPX stays as is).

### Ordered milestones (each with a concrete verification step)

1. **TCX course export + course points.** *Verify:* node test — child order per `CoursePoint_t`, legal enum values only, cue count matches `cues()`, simulated-activity Notes present; XML well-formedness via string checks in the Node suite (DOM-dependent checks in `tests/browser.py`).
2. **TCX activity export with laps.** *Verify:* node test — lap durations/distances equal `computeSplits` output; timestamp monotonicity reuses the existing monotonicity test pattern; HR in `HeartRateBpm` only when enabled.
3. **TCX import.** *Verify:* browser test imports a TCX fixture (mirror of the existing GPX import flow) asserting name/distance/elevation; malformed/oversized TCX rejected with messages in the existing toast style.
4. **FIT export.** *Verify:* node round-trip through the project's own `decodeFIT`: CRC passes, Session sport/laps/records match `computeSplits`, event pairs bracket rest stops; optional dev-time validation with `FitCSVTool`/`fitdecode` recorded in `docs/VERIFICATION.md`.
5. **FIT import.** *Verify:* encode→decode→`importedActivity`→re-export round trip preserves geometry and derived timing; unknown-message and developer-field files import with notices; corrupt header/CRC rejected with a useful error.
6. **Docs.** Update README format list, `docs/ACCEPTANCE.md` (new item: validate TCX against the Garmin XSD and import FIT into a third-party reader, mirroring existing item 15), `docs/VERIFICATION.md` records.

### Testing strategy

`tests/tcx.test.mjs` (structure, child order, enum mapping, lap math, honesty notes), `tests/fit.test.mjs` (encode/decode round-trip, CRC, semicircle/timestamp conversion, pause events, oversized/corrupt rejection), plus `tests/browser.py`: TCX/FIT import via the existing file-input hook, course-point count assertions against the mocked fixture route, and export capture through the existing `testDownloads` Blob interception.

### Risks & provider/format limitations

- FIT is version-sensitive: pin the exact profile-release facts (message numbers, base types) against the official SDK at implementation time; third-party decoder sources were used for this plan and are cited only as corroboration.
- FIT import deliberately supports a narrow profile (FileId/Activity/Session/Lap/Record/Event); anything exotic (developer fields, multisport) is skipped with an explicit notice, following the disjoint-segment notice convention.
- TCX `CoursePoint` requires Name+Time+Position — cues always provide all three (simulated elapsed time fills Time), so no partial course points are emitted.
- No new providers or network paths; provider limits (FOSSGIS Valhalla ~100 km pedestrian / 150 km bicycle) are untouched by this feature.

**Effort estimate:** 7–11 dev-days (TCX export 1–2, TCX import 1, FIT export 2–3, FIT import 3–4, docs 0.5).

**Honesty labeling:** TCX `Notes` and FIT Session naming carry the same "simulated, not a recorded workout" statement as the GPX `<desc>`; imports reuse the existing "exports are explicitly resimulated, not original recordings" notice.

---

## 4. Cross-cluster sequencing, risks, and rollup

Implementation order is dependency-driven:

1. **B — pauses** first: the dwell engine is the shared primitive (stationary rest steps in Feature A and FIT timer events in Feature C depend on it). *2–3 days.*
2. **A — workouts** next: consumes dwell for stationary rests; lands GPX course points and workout-aware splits. *3–4 days.*
3. **C — formats** last, TCX before FIT: TCX reuses the cues/XML infrastructure and gives laps/course points their proper home; FIT follows once lap/event semantics are stable. *7–11 days.*

Total: **12–18 dev-days**, each feature and milestone independently shippable behind its own verification.

Shared risks:

- `Activity.version` stays 1: every addition is optional and passes through explicit `clean*()` selection, so `validateActivity` (and therefore `LocalStore` and `parseBackup`) keeps accepting old data without a schema bump.
- All new logic lives in pure modules (`workout.ts`, `pause` handling in `model.ts`, `tcx.ts`, `fit.ts`) so the Node suite covers the logic; DOM-only behavior goes through `tests/browser.py` with the existing mocked-provider harness — no new dependencies, no live provider requests.
- Charts: pace dips to zero across rest stops; accepted as-is (documented), no chart changes in this cluster.

## References

- Garmin FIT SDK: <https://developer.garmin.com/fit/> — SDK, profile, and FitCSVTool.
- Garmin FIT activity-file requirements (FileId with activity file type, Session, Activity; laps/records/splits): <https://developer.garmin.com/fit/articles/file-types/activity.html>.
- FIT binary layout (12-byte header: header size, protocol version, profile version, data size, `".FIT"` magic; optional header CRC; data CRC): FIT protocol documentation as implemented in open-source decoders (GPSBabel/Viking `fit.c`).
- Garmin TrainingCenterDatabase v2 schema (CoursePoint child order; database element set): <https://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd>.
- Course-point type enumeration cross-reference (TCX enum ↔ FIT codes 0–25): GPSBabel FIT course-point mapping and the TCX `CoursePointEnum` restriction.
