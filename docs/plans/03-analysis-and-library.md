# Plan 03 — Analysis charts and library ergonomics

Scope for this plan: two clusters of the SimRun roadmap — (A) post-simulation analysis
(HR-zone distribution, pace histogram, per-km split chart, side-by-side activity comparison)
and (B) library ergonomics (search, tags, sort, drag-and-drop import, storage-quota display).
Everything is computed locally from the existing `Simulation` samples (`src/model.ts`
`simulate()`, `computeSplits()`), rendered with the hand-rolled SVG approach already in
`src/charts.ts`, and persisted in the existing local stores. No new dependencies, no network,
no new persistence engine. Design only; no code is implemented in this document.

Grounding anchors used throughout (all read from the repo on branch `hoplite/lilaia-d62e62ed`):

- `src/types.ts` — `Activity` (line 13), `Sample extends Point` (line 17), `Simulation` (line 18), `Split` (line 19), `Preferences` (line 20).
- `src/model.ts` — `validateActivity` (line 46, explicitly reconstructs persisted fields at line 68), `simulate()` (line 85), `timeAtDistance` (private helper, line ~140), `splitBoundaries` (line 156), `computeSplits` (line 163), `defaultPreferences` (line 6), `clock()` (line 76).
- `src/charts.ts` — `ChartMode` (line 4), `class Charts` (line 6), `render(a,s,pref)` (line 11), the `make()` SVG helper inside `render`, `format()`/`cursor()` private methods (lines 30-32).
- `src/storage.ts` — `readPreferences`/`validatePreferences` (lines 4-8), `LocalStore.open()` (IndexedDB `simrun-local` v1, lines 13-18), `list()` (line 24), `parseBackup` (line 36).
- `src/main.ts` — `render()` (line 47), GPX file change handler (line 101), chart-tab wiring loop (line 102), `showHistory()` (lines 107-113), `on('backup')` (line 115), `on('settings')` + `refreshOfflineStatus()` (lines 118-123).
- `public/index.html` — chart tabs in `#chart-panel` (line 29), `#history-dialog` (line 32), `#settings-dialog` form (line 33), `.simulation-tag` honesty label (line 19).
- `public/app.css` — `.chart-panel` (line 6), `.splits-table` (line 27), dialog styles (line 13).
- Tests: `tests/core.test.mjs` imports compiled modules from `../dist/src/*.js`; `tests/browser.py` drives the built app with mocked providers via `page.add_init_script(mock)` and `window.testDownloads`.

---

# Cluster A — Analysis

New pure module `src/analysis.ts` holds all numeric analysis; `src/charts.ts` and `src/main.ts`
only render its output. This keeps every new algorithm unit-testable in Node without DOM,
matching the existing split of `geometry.ts` / `model.ts` (pure) vs `charts.ts` / `main.ts` (DOM).

## A1. HR-zone distribution

**Goals**

- Show time spent in five standard HR zones for the currently simulated activity when
  simulated heart rate is enabled (`settings.hrEnabled`).
- Zones are percentages of a max-HR value the user can set; defaults keep today's behavior.

**Non-goals**

- No editable per-zone boundaries (a fixed 5-zone table; editable zones would need a
  preferences sub-editor for little value in v1).
- No zone-target planning, no training-load scores, no comparison of HR to "real" measurements.

**Data model additions (exact TS types, added to `src/types.ts`)**

```ts
export interface HrZone { name:string; lowPct:number; highPct:number; seconds:number; share:number }
```

`Preferences` gains one field (validated in `validatePreferences`, `src/storage.ts` line 5, with
the default added to `defaultPreferences` in `src/model.ts` line 6 so no IndexedDB record changes):

```ts
// Preferences (src/types.ts line 20) gains:
hrMax:number;   // 100..240, default 190
```

**Algorithm (in `src/analysis.ts`)**

- `zonesFor(maxHr:number):{name:string;lowPct:number;highPct:number}[]` — fixed table:
  Z1 50–60%, Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 90–100% of `maxHr`.
- `hrZoneDistribution(points:Sample[], maxHr:number):HrZone[]` — time-weighted: each sample's
  weight is the gap to the previous sample (`points[i].time - points[i-1].time`, ms), first
  sample uses `interval*1000` from the `Simulation`. Samples are grouped by
  `p.hr!` falling in `[lowPct*maxHr/100, highPct*maxHr/100)`. Samples without `hr` are ignored
  (HR generation in `src/model.ts` line ~131 only sets `hr` when `settings.hrEnabled`, so the
  function is naturally honest when HR is off). `share = seconds / totalSeconds`.
  Deterministic and pure — no DOM, no randomness.

**UI / workflow and DOM placement**

- New collapsible section `#analysis-details` (`<details class="settings-section">`) inserted
  after `#splits-details` in `public/index.html` (after line 26), following the same markup
  pattern as `#splits-details`. Contains:
  - `#hr-zones` — horizontal SVG bars (one per zone) with bpm-range labels and a caption
    `Time in zone · % of estimated max HR 190 bpm`. Shown only when `settings.hrEnabled`;
    otherwise the existing empty-state copy style used by `Charts` ("Enable simulated heart
    rate in Activity settings." — reuse the empty-state wording convention from `charts.ts`
    line 15).
  - `#pace-histogram` — see A2.
- `maxHr` input: a number input `#hr-max` in the Workspace settings dialog next to the
  other preference fields, wired into `#preferences-form` (index.html line 33, submit handler
  main.ts line 125) and validated by `validatePreferences` — max HR is a preference, not
  per-activity settings, so no `Settings` change and no re-validation of stored activities.

**Files / functions to touch**

- `src/types.ts`: add `HrZone`; extend `Preferences`.
- `src/analysis.ts` (new): `zonesFor`, `hrZoneDistribution`.
- `src/model.ts`: `defaultPreferences` gains `hrMax:190`; `validateActivity` unchanged.
- `src/storage.ts`: `validatePreferences` clamps `hrMax` (100–240, default 190).
- `src/main.ts`: render HR-zone bars inside `render()` next to the splits rendering (lines 49-64);
  read `#hr-max` in the preferences submit handler (main.ts line 125).
- `public/index.html`: `#analysis-details` section; `#hr-max` input in the settings dialog.
- `public/app.css`: `.zone-row` bars reusing the palette variables used by `.splits-table` (line 27).

**Implementation milestones (ordered, each with verification)**

1. `src/analysis.ts` with `zonesFor` + `hrZoneDistribution`; extend `Preferences`/`defaultPreferences`/`validatePreferences`.
   *Verify:* new `tests/analysis.test.mjs` cases pass (`npm run build && node --test tests/analysis.test.mjs`); existing suite still green (`npm test`).
2. UI: `#analysis-details` in `index.html`, render wiring in `main.ts`, CSS rows.
   *Verify:* `npm run build`; browser check — with `#hr-enabled` checked, `#hr-zones` shows 5 rows whose bpm ranges bracket `#hr-average`; hidden when HR is off.
3. Zone seconds sum to simulated duration within tolerance.
   *Verify:* unit test asserts `sum(seconds) ≈ sim.duration` for a natural-mode 5 km activity.

**Testing strategy**

- New `tests/analysis.test.mjs` (Node test runner, importing `../dist/src/analysis.js` and
  `../dist/src/model.js` like `tests/core.test.mjs` does):
  - `hrZoneDistribution puts every sample in exactly one zone` — synthetic `Sample[]` with known bpm values; assert counts and bracketing.
  - `zone time weights follow sample gaps` — irregular time gaps; assert per-zone seconds match expected weighted sums and `share` sums to 1.
  - `HR disabled means zero distribution` — `simulate()` with `hrEnabled:false` yields all-zero seconds.
  - `hrMax is validated and defaulted` — `validatePreferences({hrMax:50})` clamps/defaults.
- `tests/browser.py` addition (non-isolated mode, after the HR GPX check): enable HR, open the
  new Analysis section, assert five `.zone-row` elements and the "estimated max HR" caption.

**Risks / limitations**

- Zone boundaries are population-standard percentage bands of a self-reported max HR — an
  estimate. Copy must say so.
- If `gps.dropout` removed fixes, gaps between samples widen; weighting by actual time gaps
  (not assuming uniform) keeps the distribution honest.
- `Preferences` is stored as one JSON blob in localStorage; adding a field is backward-safe
  because `validatePreferences` already normalizes partial objects (line 4-9).

**Effort:** ~1 developer-day (analysis module 0.5 d, UI + CSS 0.5 d).

**Honesty labeling:** the section header carries the existing `.simulation-tag` copy pattern and
the caption explicitly says the distribution is computed from *simulated* heart rate against an
*estimated* max HR — never "measured".

## A2. Pace histogram

**Goals**

- Histogram of time spent at each pace (run) or speed (ride) for the current simulation,
  unit-aware, in the same Analysis section.

**Non-goals**

- No distribution comparison between activities (that belongs to A4), no percentile tables,
  no smoothing configuration.

**Data model / algorithm (in `src/analysis.ts`)**

```ts
export interface PaceBucket { from:number; to:number; seconds:number }
export function paceHistogram(s:Simulation, sport:Sport, bucketSec:number):PaceBucket[]
```

- Time weights exactly as in A1 (gap-to-previous, first sample uses `s.interval*1000`).
- Run: convert each sample's `speed` (m/s) to seconds/km = `1000/speed`; bucket width is
  `bucketSec` (default 10 s/km), covering only the occupied range. Ride: bucket `speed*3.6`
  km/h in 1 km/h buckets. Empty out-of-range samples (e.g. speed 0 at dropout-adjacent points)
  are skipped, mirroring how `Charts.render` filters `NaN` rows (line 15).
- No resampling of `s.points` beyond one linear pass — samples are capped at ~50k by
  `simulate()` already (line 104), so one pass is fine.

**UI / DOM**

- `#pace-histogram` inside `#analysis-details`: a horizontal bar SVG (same 1000-wide viewBox
  trick as `Charts.render`, line 14) with the fastest bucket on the left; axis labels reuse
  `clock()` (run) or `toFixed(1)` km/h (ride) exactly as `Charts.format` does (line 30).
- Caption: `Distribution of simulated pace · <units>`.

**Files / functions to touch**

- `src/analysis.ts`: `paceHistogram`.
- `src/main.ts`: inside `render()`, after the splits table block, call a new local
  `renderAnalysis(a,sim)` that fills `#hr-zones` and `#pace-histogram`; skipped entirely when
  `sim` is null, showing the same empty-state copy style as `splits-summary` (line 60).
- `public/app.css`: `.pace-histogram` bars.

**Milestones**

1. `paceHistogram` + unit tests. *Verify:* new test cases pass; `npm test` green.
2. Rendering in `renderAnalysis()` + empty state. *Verify:* browser check toggles
   Constant/Natural and asserts the tallest bucket shifts toward the target pace.

**Testing strategy**

- `tests/analysis.test.mjs`:
  - `constant pace concentrates the histogram` — constant-mode simulation: ≥90% of weighted time in the bucket containing the target pace.
  - `histogram buckets are contiguous and cover occupied paces` — bounds arithmetic and total seconds ≈ duration.
  - `ride mode buckets by speed` — a ride activity at 24 km/h lands in the 24 km/h bucket.
- `browser.py`: with the imported fixture, assert `#pace-histogram` contains ≥1 `rect` and the
  caption mentions "simulated".

**Risks / limitations**

- Bimodal patterns (walk breaks) are visible but not annotated; the histogram is informational.
- For ride mode the y-axis unit differs from run; label switching follows the existing
  `chart-pace` tab convention (`setText('chart-pace', …)` in `main.ts` line 49).

**Effort:** ~0.5 developer-day.

**Honesty labeling:** the histogram caption reads "Simulated pace distribution — not a measured
workout", matching the `.fine-print` pattern of the Simulation section (index.html line 23).

## A3. Per-km split chart

**Goals**

- A per-kilometre (or per-mile) pace bar chart as a fourth chart tab in the existing profile
  panel, independent of the user's split configuration (which `#splits-details` already covers).

**Non-goals**

- No custom bucket size (fixed at 1 km / 1 mi); no best/worst-km leaderboard; no changes to
  `computeSplits` semantics.

**Data model / algorithm**

```ts
export interface SplitBar { from:number; to:number; duration:number; pace:number } // meters, seconds, s/km (run) or km/h (ride)
export function splitBars(s:Simulation, sport:Sport, unitMeters:number):SplitBar[]
```

- `unitMeters` is 1000 or 1609.344 following the `Charts` imperial convention (charts.ts line 13).
- Requires time-at-distance interpolation. `timeAtDistance` is currently a private helper in
  `src/model.ts` (line ~140) used by `computeSplits`; the smallest change is to export it and
  reuse it here rather than duplicating interpolation. Boundary cases (`d<=first.distance`,
  `d>=last.distance`) are already handled there.
- The final partial bar is plotted but its `pace` is flagged `NaN` when `duration` is below one
  sample interval, so the bar renders at reduced opacity via the same invalid-value break
  logic `Charts` uses for missing data.

**UI / DOM placement**

- `ChartMode` (charts.ts line 4) becomes `'elevation'|'pace'|'hr'|'splits'`.
- `public/index.html` line 29: add `<button id="chart-splits" role="tab" aria-selected="false">Per km</button>`
  (label switches to "Per mile" with imperial units via the existing `setText` pattern).
- `Charts.render` gains a branch: when `mode==='splits'`, build rows from `splitBars(...)`,
  render one `<rect>` per bar (SVG bars, not a path), with the y-axis formatted by `clock()`
  for runners exactly like the pace mode. The `make()` helper inside `render` (charts.ts line 16)
  already exists for this.
- `src/main.ts` line 102: add `'splits'` to the chart-mode loop array and the tab wiring.

**Files / functions to touch**

- `src/model.ts`: export `timeAtDistance`.
- `src/analysis.ts`: `splitBars`.
- `src/charts.ts`: extend `ChartMode`, add the `splits` branch in `render` (bars instead of a
  single path), extend the mode-specific empty-state copy at line 15.
- `public/index.html` / `public/app.css`: tab button; `.chart-bar` styles.

**Milestones**

1. Export `timeAtDistance` from model.ts; add `splitBars` + tests. *Verify:* new tests pass
   (bar durations sum to `sim.duration` within 0.5 s, mirroring the existing splits-sum check
   in `tests/core.test.mjs` line 78).
2. Chart branch + tab. *Verify:* `npm run build`; `browser.py` clicks `#chart-splits` and
   asserts `rect` count equals `ceil(distance/1000)` for the ~5 km fixture.

**Testing strategy**

- `tests/analysis.test.mjs`:
  - `splitBars yields one bar per kilometre with summed durations matching the simulation`.
  - `partial final bar is flagged, not padded` — last bar's duration < full unit for a
    non-integer distance.
  - `imperial units produce mile boundaries`.
- `browser.py`: add a check after the existing HR chart step — click `#chart-splits`, assert
  bars render and the tooltip-free static view shows the unit label.

**Risks / limitations**

- Charts uses `preserveAspectRatio='none'` with a 125-unit-tall viewBox (charts.ts line 14);
  bars must respect the same coordinate space so hover/cursor code stays consistent. Cursor
  tracking (private `cursor`) indexes `this.rows`; for the splits mode rows will be the bar
  centers so hover still works without new machinery.
- Loop activities (via `plannedPath`) are fine — bars follow the planned path distance.

**Effort:** ~1 developer-day.

**Honesty labeling:** the chart aria-label follows the existing `${this.mode} profile along
route` pattern (charts.ts line 14) → "per-km simulated pace chart"; `#chart-note` keeps the
"Simulated activity" framing.

## A4. Side-by-side activity comparison

**Goals**

- Pick any two saved activities and compare headline stats and pace/speed profiles side by
  side, computed locally by re-running `simulate()` on each (exactly what `showHistory()`
  already does per row to display duration — main.ts line 110).

**Non-goals**

- No overlay of more than two activities; no overlaying of GPX traces on the map; no
  persistence of comparison state (it is ephemeral UI state, not activity data); no diffing of
  waypoints or settings beyond the stats row.

**Design**

- New `<dialog id="compare-dialog">` after `#history-dialog` in `public/index.html`, with:
  - two `<select>`s (`#compare-a`, `#compare-b`) populated from `store.list()`,
  - a stats grid `#compare-stats` (distance, duration, avg pace/speed, elevation gain, per-unit
    deltas in the accent color),
  - two profile SVGs stacked (`#compare-chart-a`, `#compare-chart-b`) with a shared
    distance axis and identical y-scale per sport so the shapes are visually comparable,
  - an honest caption `Both activities are simulated by SimRun; differences reflect simulation
    settings, not measured performances.`
- Entry point: a "Compare" text button in the `#history-dialog` footer next to `#backup`/
  `#restore` (index.html line 32), plus per-row affordance is **not** added (keeps the row
  DOM unchanged).

**Data model / algorithm (in `src/analysis.ts`)**

```ts
export interface ComparisonRow { label:string; a:string; b:string }
export function compareStats(a:Activity,b:Activity,units:'metric'|'imperial'):ComparisonRow[]
```

- Duration via `simulate(a).duration` inside try/catch, exactly like `showHistory()` (an
  activity whose settings fail validation shows `—` rather than throwing).
- Distance/gain from `plannedPath` + `cumulative` + `elevationStats` (the helpers
  `showHistory` already uses at main.ts line 111).
- Profile rendering: a new exported function in `charts.ts`,
  `renderPaceProfile(host:HTMLElement, a:Activity, s:Simulation, pref:Preferences, width:number):void`
  — a static (no pointer events) variant of the existing pace branch of `Charts.render`,
  reusing the same axis/label code path by extracting the shared drawing block into a private
  static method so `Charts` and the comparison share one implementation instead of duplicating
  SVG math.

**Files / functions to touch**

- `src/analysis.ts`: `compareStats`.
- `src/charts.ts`: extract the shared axis/profile drawing from `Charts.render` into an
  internal helper; add `renderPaceProfile`.
- `public/index.html`: `#compare-dialog` markup after line 32; "Compare" button in the
  history dialog footer.
- `src/main.ts`: `on('compare', showCompare)` near `on('history',showHistory)` (line 114);
  `showCompare()` populates selects, renders both profiles, wires the same `[data-close]`
  close pattern (line 104) and the existing click-outside-to-close list (line 106 — add
  `'compare-dialog'` to that array).
- `public/app.css`: reuse `dialog` styles (line 13); add `.compare-grid` + `.compare-caption`.

**Milestones**

1. `compareStats` + tests. *Verify:* `node --test tests/analysis.test.mjs`.
2. Static profile renderer refactor in `charts.ts` with no behavior change.
   *Verify:* existing `browser.py` chart checks still pass unchanged (`python tests/browser.py --isolated` needs only `--isolated` mode for charts) plus `npm test`.
3. Compare dialog wiring. *Verify:* `browser.py` — duplicate the fixture, open Compare, assert
   two `.profile-line` paths render and the honesty caption is present; assert stats differ for
   differing target paces and that a saved activity that fails simulation shows `—` without a
   page error.

**Testing strategy**

- `tests/analysis.test.mjs`:
  - `compareStats formats both sides with current units` — two synthetic activities (5:00/km and 4:30/km pace, 10 km); assert label set and formatted strings.
  - `comparison tolerates invalid activity` — an activity with an empty path yields `—` cells, no throw.
  - `comparison is deterministic`.
- `browser.py`: one new check block "Compare two simulated activities side by side" as above.

**Risks / limitations**

- Re-simulating two activities costs two `simulate()` calls (up to ~50k points each, capped in
  `simulate()` line 105). Acceptable for two selections; guard with the existing
  `path.length<2` throw path and a try/catch per activity.
- Profiles only make sense when both activities share a sport; the selects are labeled
  "Run vs ride comparisons are approximate" in the caption when sports differ.

**Effort:** ~1 developer-day.

**Honesty labeling:** the dialog's standing caption states both sides are simulations; the
dialog subtitle reuses the "Saved here. Not in the cloud." voice with "Simulated on this device.
Not measured."

---

# Cluster B — Library ergonomics

All library changes live in the `#history-dialog` (index.html line 32) and its renderer
`showHistory()` in `src/main.ts` (lines 107-113), plus small storage/validation changes in
`src/storage.ts` and `src/types.ts`.

## B1. Tags on activities

**Goals**

- Optional free-form tags per activity, persisted with the activity, shown in the library and
  usable for filtering.

**Non-goals**

- No tag colors, no nested tags, no tag autocomplete, no cross-activity tag manager.

**Data model (exact TS change in `src/types.ts`)**

```ts
export interface Activity {
  // existing fields (line 13-16) ...
  tags?:string[];
}
```

**Design**

- Validation in `validateActivity` (`src/model.ts` line 46): sanitize to at most 8 tags, each
  1–24 chars after trimming, stripped of control characters, case-preserved, de-duplicated
  (first occurrence wins). Because `validateActivity` explicitly reconstructs the record
  (line 68: `return {id:a.id, …}`), tags must be added to that literal:
  `...(a.tags?{tags:cleanTags(a.tags)}:{})`.
- **No IndexedDB migration is needed.** `LocalStore` uses `keyPath:'id'` object stores; stored
  records simply gain an optional field when next saved, and `validateActivity` tolerates its
  absence on old records. The IDB version stays `1` (`indexedDB.open('simrun-local',1)`,
  storage.ts line 12).
- Editing UI: a tags input `#activity-tags` in the inspector next to the activity-name field,
  wired with the same `change(id, fn)` helper used for `splits-markers` (main.ts line 94):
  comma-separated input → `editor.activity.tags` (via a small `editor.setTags(list)` or direct
  assignment + `notify`, mirroring `change('activity-name', …)` at line 90 which assigns and
  re-renders).
- Library rows render tags as `.history-tags` chips (text-only, using `el()` which assigns
  `textContent` — ui.ts line 3) after the summary line in `showHistory()`.
- Backups gain tags automatically through `store.list()` → `JSON.stringify` in `on('backup')`
  (main.ts line 115); old backups restore fine because `tags` is optional and
  `parseBackup`→`validateActivity` drops unknown fields by reconstruction.

**Files / functions to touch**

- `src/types.ts` (Activity), `src/model.ts` (`validateActivity` + exported `validateTags` or
  inline sanitizer).
- `src/main.ts`: name-field block of `render()` for the input wiring; `showHistory()` for chips.
- `public/index.html`: input after the name field; `public/app.css`: `.tag-chip`.

**Milestones**

1. Validation + round-trip tests. *Verify:* `npm test` with new cases below.
2. Input UI + library chips. *Verify:* `npm run build`; `browser.py` — type tags into
   `#activity-tags`, save, reopen history, assert chips text and that a tag survives
   duplicate + reload (non-isolated mode).

**Testing strategy (`tests/analysis.test.mjs` or a new `tests/library.test.mjs`)**

- `tags round-trip through validateActivity` — mixed-case/duplicate/overlong tags normalize to
  8 unique trimmed tags; assert `deepEqual` on the cleaned activity (same style as the
  splits round-trip test in core.test.mjs).
- `old records without tags stay valid` — `validateActivity` on a fixture without `tags`.
- `too many tags are rejected` — assert throws above the cap.

**Risks / limitations**

- A backup created after this change and restored into an older build silently drops tags
  (old `validateActivity` rebuilds without the field). Acceptable; note in the backup footer.
- Backup size grows trivially; the 50 MB cap is unaffected.

**Effort:** ~0.5 developer-day.

**Honesty labeling:** tags are user metadata only; no simulation semantics. No labeling risk.

## B2. Library search and sort

**Goals**

- Filter the library by free text (name + tags) and sort by Updated / Name / Distance /
  Duration without loading anything beyond what `store.list()` already returns.

**Non-goals**

- No server-side or IndexedDB-index search (dataset cap is 500 activities per backup; in-memory
  filtering of `store.list()` is instant at this scale); no fuzzy matching; no saved filters.

**Design**

- Pure helpers in `src/library.ts` (new small module, or added to `src/analysis.ts` to avoid a
  new file — prefer `src/analysis.ts` to keep the diff small):

```ts
export type LibrarySort='updated'|'name'|'distance'|'duration';
export function matchesQuery(a:Activity,query:string):boolean  // case-insensitive substring against name and tags; whitespace tokens AND-ed
export function sortForLibrary(rows:{a:Activity;distance:number;duration:number}[],sort:LibrarySort):{a:Activity;distance:number;duration:number}[]
```

- `showHistory()` currently sorts by `updatedAt` inside `LocalStore.list()` (storage.ts line 24)
  and computes distance/duration per row; those computed values feed the new comparator
  directly. Sorting happens after `list()` in the UI, so `LocalStore` is untouched.
- DOM: a header row inside `#history-dialog` above `#history-list`: text input
  `#library-search` (with `input` listener re-running `showHistory()` — it is idempotent and
  re-renders the list) and `<select id="library-sort">` with the four options. The dialog
  keeps the existing backup/restore footer untouched.
- Empty-filter state reuses the existing `.history-empty` paragraph with filter-aware copy.

**Files / functions to touch**

- `src/main.ts`: `showHistory()` — read the two controls, filter/sort the `rows` array before
  the render loop; `on('history', …)` unchanged.
- `src/analysis.ts`: `matchesQuery`, `sortForLibrary`.
- `public/index.html` history-dialog header; `public/app.css` one ruleset.

**Milestones**

1. Helpers + unit tests. *Verify:* `node --test tests/library.test.mjs`.
2. Controls + wiring. *Verify:* `browser.py` — save two activities with different names/tags,
   type a tag into `#library-search`, assert row count drops to 1 and the name filter matches
   case-insensitively; switch sort to "Name" and assert the first `.history-main strong` text
   is the alphabetically smaller name.

**Testing strategy**

- `tests/library.test.mjs` (new): token AND-ing, case-insensitivity, tag matching, each sort
  key's ordering and tie-break by `updatedAt`, and that filtering never mutates the input array.
- `browser.py`: one combined search+sort check as in milestone 2.

**Risks / limitations**

- `store.list()` re-validates every activity on each open (`validateActivity` per row) — fine
  at ≤500 activities, unchanged from today.
- Sorting by duration needs `simulate()` per row, which `showHistory` already performs in a
  try/catch; failed simulations sort last with `—`.

**Effort:** ~0.5 developer-day.

**Honesty labeling:** none affected; the dialog keeps "Saved here. Not in the cloud."

## B3. Drag-and-drop import

**Goals**

- Dropping a `.gpx`/`.kml`/`.geojson` file anywhere on the page imports it through the exact
  same validation path as the `#gpx-file` input; dropping `.json` offers the existing backup
  restore flow.

**Non-goals**

- No multi-file drop, no folder drop, no drop-onto-dialog handling, no paste support.

**Design**

- Extract the body of the existing `$('gpx-file').addEventListener('change', …)` handler
  (main.ts line 101) into `async function importDroppedFile(file:File):Promise<void>` (same
  15 MB guard, `importRouteFile` call, save-current-then-load flow) and call it from both the
  change listener and the drop handler — one code path, no duplicated validation.
- `window.addEventListener('dragover', e=>{e.preventDefault();})` (required to allow drop) and
  `window.addEventListener('drop', guarded(async e=>{…}))`, reading
  `e.dataTransfer.files[0]`. `.json` files route to the backup handler's logic by extracting
  the restore body of the `backup-file` change listener (main.ts line 117) into
  `restoreBackupFile(file:File)` and calling it after the same `confirm()`.
- Visual affordance: a fixed full-viewport `#drop-hint` overlay (`hidden` by default) toggled
  on `dragenter`/`dragleave`, with copy "Drop a GPX, KML or GeoJSON route". CSS-only; uses the
  existing toast/dialog styling variables.
- Imported routes land in the current editor exactly as the file-picker path does, including
  the "Imported geometry is preserved" behavior.

**Files / functions to touch**

- `src/main.ts`: extract + share handlers; two window listeners; reusing `importRouteFile`
  from `src/import.ts` unchanged.
- `public/index.html`: `#drop-hint` div before `#toast` (line 34); `public/app.css` overlay.

**Milestones**

1. Refactor change-handler into shared function; behavior unchanged.
   *Verify:* `npm test` + existing `browser.py` import checks pass untouched.
2. Drop handlers + hint overlay. *Verify:* `browser.py` builds a `DataTransfer` in page
   context, dispatches a synthetic `drop` on `document.body` with the existing GPX fixture,
   and asserts the same post-conditions as the file-input import (name, distance).

**Testing strategy**

- `browser.py` new check "Dropping a GPX file imports it like the file picker": use
  `page.evaluate` to construct a `DataTransfer`, add a `File` from the fixture string, and
  dispatch `drop`; assert `#activity-name` value. Also assert a dropped `.json` backup triggers
  the restore confirm (intercept `confirm` via `page.on('dialog')`).
- Pure logic stays in `importRouteFile` (already unit-tested in `tests/import.test.mjs`), so no
  new Node-side tests beyond a guard-function test if the file-type gate becomes pure.

**Risks / limitations**

- Playwright cannot deliver a real OS drag; the synthetic `DataTransfer` `drop` is the closest
  faithful check, and `dragover` preventDefault is verified implicitly by no navigation.
- Dropping onto an open `<dialog>` must be ignored — the handler checks
  `document.querySelector('dialog[open]')` first (same guard the keyboard handler at line 130
  already uses), preventing accidental replaces mid-history-browsing.

**Effort:** ~0.5 developer-day.

**Honesty labeling:** imports already announce "Geometry retained. Exports are explicitly
resimulated…" via `importedActivity()` notices; drag-drop reuses that same toast, so no new
copy surface is introduced.

## B4. Storage-quota display

**Goals**

- In Workspace settings, show estimated local-storage usage and quota from
  `navigator.storage.estimate()`, plus the activity count, so users can decide when to back up.

**Non-goals**

- No `navigator.storage.persist()` request, no quota warnings/thresholds, no per-record size
  accounting (IndexedDB does not expose per-record sizes).

**Design**

- New fieldset "Local data" in `#preferences-form` (after the offline-cache fieldset,
  index.html line 33) containing one `<p id="storage-usage" class="fine-print">` filled by an
  async `refreshStorageEstimate()` modeled directly on the existing `refreshOfflineStatus()`
  (main.ts lines 119-123): called from the `on('settings')` opener (line 118) and after
  saves/deletes if the dialog is open.
- Helper `formatBytes(n:number):string` (KB/MB/GB, binary units to match browser conventions)
  in `src/ui.ts` next to the existing formatting helpers.
- Copy states exactly what is counted: `Activities stored: N · ≈X of Y used by this site`.
- When `navigator.storage?.estimate` is missing or rejects, or when the store is in the
  in-memory fallback (`store.available === false`, storage.ts line 11), render the honest
  fallback: `Usage estimate is unavailable in this browser. History is session-only; export a
  backup.` — the same honesty pattern as the "Session only" storage-state label.

**Files / functions to touch**

- `src/main.ts`: `refreshStorageEstimate()`, call sites in `on('settings', …)` and after
  `store.save`/`store.remove` flows (`on('save', …)` line 96, `showHistory()` delete handler).
- `public/index.html` fieldset; `public/app.css` minor.

**Milestones**

1. `formatBytes` + fallback logic with unit tests (no DOM needed).
   *Verify:* `node --test tests/library.test.mjs`.
2. Fieldset + wiring. *Verify:* `browser.py` — open settings, assert `#storage-usage` matches
   `/Activities stored: \d+ · ≈[\d.]+ \w+B of/` in normal mode; in `--isolated` mode assert the
   honest "unavailable / session-only" fallback text instead (mirroring the existing
   `Session only` check at browser.py line ~152).

**Testing strategy**

- Unit: `formatBytes` boundaries (0, 1023, 1024², ≥1 GB) and fallback message selection via a
  pure `describeStorage(estimate:{usage?:number;quota?:number}|null, available:boolean):string`
  helper so the decision logic is DOM-free.
- `browser.py`: two checks as above (present-and-formatted in normal mode; honest fallback in
  isolated mode where the harness DOM lacks the API path).

**Risks / limitations**

- `estimate()` availability varies (Safari private mode, the isolated harness) — the fallback
  text is a first-class state, not an error path. Quota values can be enormous (e.g. 200+ GB on
  large disks); the message shows the raw numbers without promising accuracy, and MDN marks
  the API non-standard in some engines — the code must feature-detect (`'estimate' in
  navigator.storage`), never assume.
- Estimates are per-origin and asynchronous; values may change between dialog openings, so the
  text is refreshed on every dialog open rather than cached.

**Effort:** ~0.5 developer-day.

**Honesty labeling:** the fallback message follows the app's existing rule of reporting
storage honestly ("Blocked storage is reported honestly…" in tests/browser.py) and never
implies cloud backup.

---

# Cross-cluster notes

**Simulated-not-measured labeling, preserved everywhere**

- Every new chart/section caption reuses the existing `.simulation-tag` / `.fine-print` voice:
  analysis surfaces say "simulated" in their headings and captions; the comparison dialog has
  a standing honesty line; nothing labels zones/pace values as measured HR or GPS data.
- All numbers derive from `simulate()` output (`Sample.time/speed/hr`), so no new data source
  can silently introduce measured data.

**Shared verification loop**

1. Every milestone above ends in `npm run build` + targeted `node --test` (new files:
   `tests/analysis.test.mjs`, `tests/library.test.mjs`; pure functions import from
   `../dist/src/analysis.js` exactly as `tests/core.test.mjs` imports `../dist/src/model.js`).
2. `npm test` (build + all Node tests) must stay green after each milestone.
3. Browser checks extend `tests/browser.py` in both modes where relevant; isolated mode
   exercises the DOM-only paths, normal mode exercises IndexedDB and the service worker.
4. `npm run typecheck` (strict TS) after each milestone; new code matches the existing
   no-comment, dense-single-line style of `src/model.ts` / `src/charts.ts`.

**Top risks, ranked**

1. `navigator.storage.estimate()` availability — handled by feature-detect + honest fallback (B4).
2. IndexedDB migration risk is deliberately near-zero: tags are an optional validated field;
   no store schema/version change (B1).
3. Chart hover/cursor coupling: A3 reuses `Charts` internals rather than adding a parallel
   chart system, keeping the single `cursor()` code path (charts.ts line 31).
4. Comparison re-simulation cost is bounded by the existing 50k-point cap in `simulate()`.

**Combined effort estimate:** Cluster A ≈ 3–4 developer-days; Cluster B ≈ 2–2.5 developer-days;
≈ 6 developer-days including tests and browser checks.
