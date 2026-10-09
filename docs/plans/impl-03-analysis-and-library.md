# Implementation Plan 03 — Analysis charts and library ergonomics

Concrete implementation plan for the scope in `docs/plans/03-analysis-and-library.md`. Baseline: `npm test` passes 52/52 Node tests on Node 24.21.0 with TypeScript 5.8.3; `npm run typecheck` is clean. Constraints inherited from `docs/plans/README.md`: strict TypeScript, native DOM, ES modules, zero new runtime dependencies, deterministic seeded simulation, `Activity.version` stays 1, and all derived numbers keep the simulated/estimated labeling. This round changes only `src/`, `tests/`, `public/`, and this plan document.

## 1. Goal

Two clusters, both computed locally from already-simulated data:

1. **Analysis.** From the samples `simulate()` already produces (and re-simulates for saved activities), derive: a time-weighted heart-rate-zone distribution across five fixed zones (50–60% through 90–100% of an estimated max HR), a time-weighted pace histogram (run pace or ride speed, unit-aware), a per-km/per-mile split chart as a fourth chart tab, and a comparison dialog for two saved activities that re-simulates both locally.
2. **Library ergonomics.** Optional activity tags, in-memory search and sort over the existing library, drag-and-drop file import reusing the existing import/restore flows, and an honest storage-quota display.

Everything numeric lives in a new pure module `src/analysis.ts`; everything that touches DOM, IndexedDB, or `localStorage` lands in the existing `src/charts.ts`, `src/storage.ts`, and `src/main.ts`.

## 2. Scope and non-goals

**In scope:** `src/analysis.ts` (new), extensions to `src/types.ts`, `src/model.ts` (one export + validation), `src/charts.ts`, `src/storage.ts`, `src/main.ts`, `public/index.html`, `public/app.css`, `tests/analysis.test.mjs` (new), `tests/library.test.mjs` (new), and additions to `tests/browser.py`.

**Non-goals:** no new `npm` dependencies, no service worker changes (`src/sw.ts` untouched), no IndexedDB schema/version change, no changes to `simulate()` output (golden values stay pinned), no GPX export changes, no measured-data ingestion, no per-split elevation profile chart beyond the pace bars, no activity editing beyond tags, no cross-origin or cloud anything.

## 3. Architecture

- **`src/analysis.ts` (new, pure).** Imported by `src/charts.ts` and `src/main.ts`; imports types from `src/types.js`, `clock`/`cumulative`-style helpers from existing modules only. No DOM, no storage, no imports: every export is a pure function of its arguments, matching the precedent of `src/geometry.ts` and the pure split helpers in `src/model.ts` (`splitBoundaries`, `computeSplits`, `timeAtDistance`).
- **`src/charts.ts` owns rendering.** The `Charts` class gains a fourth `ChartMode` and renders bars for it; it also gains a small exported, stateless bar-render helper reused by the comparison dialog. No analysis math moves into `charts.ts`.
- **`src/storage.ts` owns persistence-adjacent helpers:** preference validation for `hrMax`, pure search/sort/filter helpers, and the feature-detected quota helper. `LocalStore` itself is untouched except that `validateActivity` (in `src/model.ts`) now round-trips tags.
- **`src/model.ts` owns validation deltas:** `validateActivity` gains tag sanitization; `timeAtDistance` changes from module-private to `export` (its signature `timeAtDistance(points: Sample[], d: number): number` is unchanged); `validatePreferences` lives in `src/storage.ts` and gains the `hrMax` clamp.
- **`src/main.ts` owns wiring:** the Analysis section render, inspector/library tag editing, search/sort controls inside `showHistory()` (line ~107), the compare dialog wiring, window drag-and-drop, and the quota line in the settings dialog.

Dependency direction stays one-way: `analysis.ts` → `types.js`/`geometry.js`/`model.js`; `charts.ts`/`main.ts` → `analysis.js`. `analysis.ts` must never import `charts.ts`, `storage.ts`, or `main.ts`.

## 4. Data model deltas

All in `src/types.ts`; both additions optional, both validated, `Activity.version` stays `1`:

```ts
export interface Activity {
  id: string; version: 1; name: string; createdAt: number; updatedAt: number;
  waypoints: Point[]; path: Point[]; source: RouteSource; settings: Settings;
  loop?: LoopPlan; splits?: Splits;
  tags?: string[];                    // new, optional, sanitized on validate
}

export interface Preferences {
  units: 'metric' | 'imperial'; theme: 'light' | 'dark';
  mapStyle: string; mapStyleDark: string; routingUrl: string;
  elevationUrl: string; geocodingUrl: string; geocodingEnabled: boolean;
  hrMax?: number;                     // new, optional, clamped 100–240, default 190
}
```

Result types live in `src/analysis.ts` (not `types.ts`) so the core module stays untouched:

```ts
export interface HrZone { low: number; high: number; seconds: number }
export interface PaceBucket { low: number; high: number; seconds: number }
export interface PaceBin { from: number; to: number; seconds: number; samples: number }
```

Sanitization rules:

- **Tags** (`validateActivity`, `src/model.ts` line ~44): accept only `string[]`; trim each tag; strip Unicode control characters (`/\p{C}/gu`); keep tags of 1–24 characters after trimming; deduplicate case-insensitively (first spelling wins); keep at most 8; drop everything else silently. Emit `tags` only when at least one tag survives, so stored records without tags are byte-identical to today and no IndexedDB migration is needed. Add a private `cleanTags(value: unknown): string[] | undefined` used by the explicit field-selection return object in `validateActivity`.
- **`hrMax`** (`validatePreferences`, `src/storage.ts`): `Number.isFinite(p.hrMax) ? clamp(Number(p.hrMax), 100, 240) : undefined`. Missing/invalid means "use the default 190 at read sites", never stored. `defaultPreferences` in `src/model.ts` gains `hrMax: 190` so new preference writes persist a concrete value; old stored preferences remain valid because the field is optional and `readPreferences` already falls back through `validatePreferences`.

## 5. Algorithms with formulas

### 5.1 HR-zone distribution

Input: `samples: Sample[]` (from `Simulation.points`), `hrMax: number`. Zone *i* (i = 0…4) covers `[hrMax*(0.5+0.1i), hrMax*(0.6+0.1i)]` bpm, i.e. 50–60%…90–100%.

For each sample *k* with `hr` defined, its weight is the time until the next sample; the last sample uses the previous gap. Formally, for k < n−1: `w_k = t_{k+1} − t_k`; for k = n−1: `w_k = t_{n−1} − t_{n−2}` (0 when n = 1). With GPS dropouts the sample times already carry true elapsed time, so gaps across gaps weight correctly. A sample's full weight is assigned to the zone containing its rounded bpm; `hr ≤ 50%·hrMax` falls below zone 0 and is counted in `belowSeconds`, `hr > 100%·hrMax` clamps into zone 4. Output: `{zones: HrZone[5], belowSeconds: number, totalSeconds: number}` where `totalSeconds` is the sum of all weights. Only samples with finite `hr` contribute; when `hrEnabled` is false every sample lacks `hr` and the result is empty.

UI percentages are `zone.seconds / totalSeconds`, rendered as "share of simulated activity time"; the header reads "Estimated max HR: N bpm · simulated heart rate, not measured".

### 5.2 Pace histogram

Input: `samples: Sample[]`, `sport`, `units`. Convert each sample to the display-native quantity first:

- **Run, metric:** pace `p = 1000 / speed` s/km. **Run, imperial:** `p = 1609.344 / speed` s/mi. Bin width: 10 s/km in metric; 15 s/mi in imperial (≈ 9.3 s/km, keeps roughly the same resolution).
- **Ride, metric:** speed `v = speed·3.6` km/h, bin width 1 km/h. **Ride, imperial:** `v = speed·2.23694` mph, bin width 1 mph.

Weight per sample is the same gap rule as 5.1 (time-weighted). Skip samples where `speed` is missing or `≤ 0`. Compute `lo = floor(min/bin)·bin`, `hi = ceil(max/bin)·bin`; if the resulting bin count exceeds 40, widen the bin to the smallest multiple of the base width that yields ≤ 40 bins (`ceil(count/40)` × base width). Output `PaceBin[]` with `from`/`to` in the display unit, seconds, and sample counts. Units shown on the axis: `min/km`, `min/mi`, `km/h`, `mph`; run pace bins display via the existing `clock()` formatting, matching `Charts.format` for pace mode.

### 5.3 Per-km/per-mile split chart

Reuse the existing interpolation helper `timeAtDistance(points, d)` from `src/model.ts` (currently module-private, line ~153 — this plan exports it). New pure helper:

```
uniformSplits(sim: Simulation, unitMeters: number): Split[]
```

Boundaries are `d_i = min(i·unitMeters, sim.distance)` for i = 1…; the final bar is the partial remainder (`distance < unitMeters`) and is plotted without padding to a full unit. Each split's `duration = (timeAtDistance(points, end) − timeAtDistance(points, start)) / 1000`, `speed = distance / duration` when `duration > 0`, exactly mirroring `computeSplits` (line ~171). `unitMeters` is 1000 (metric) or 1609.344 (imperial). Reusing `computeSplits` directly is rejected because it derives boundaries from `Activity.splits` (auto interval + custom markers); the split tab needs clean fixed-distance boundaries regardless of split settings.

### 5.4 Comparison stat deltas

For each of the two chosen activities the dialog re-runs `simulate(activity)` inside try/catch (same pattern as `showHistory()` line 109). Headline rows, each `A → B → Δ`:

| Stat | A/B | Δ |
|---|---|---|
| Distance | `distanceValue(plannedPath → cumulative)` | `±distanceValue(b−a)` |
| Duration | `clock(simulate().duration)` | `±clock(b−a)` seconds |
| Pace (run) / speed (ride) | unit-aware from split-averaged speed | `±` seconds/km or s/mi; rides `±x.x km/h`/mph |
| Elevation gain | `elevationStats(plannedPath).gain` | `±heightValue` |
| Avg simulated HR | mean of sample `hr` when `hrEnabled` | `±` bpm; `—` when HR disabled |

Δ is computed from raw numeric values then formatted; when either side's simulation throws, that side's stat and the Δ render as `—` and a one-line note explains the activity can no longer be simulated. Both sides carry the caption "Re-simulated locally · simulated, not measured." Pace profiles render as two small `Charts` instances (mode `'pace'`, hover no-op), each fed `simulate()` output.

### 5.5 Search, sort, tags, quota (library)

- **Filter** (`src/storage.ts`, pure): tokenize the query on `/\s+/`; lowercase each token; an activity matches when **every** token is a substring of `name.toLowerCase()` **or** of any `tag.toLowerCase()` (empty query matches all; >100 chars or >20 tokens → no match, defensive).
- **Sort** (`sortActivities(activities, key)`): non-mutating (copy, then sort). `updated` → `b.updatedAt − a.updatedAt`; `name` → `localeCompare` case-insensitive; `distance`/`duration` → precomputed stats via a new `activityStats(a)` helper in `src/main.ts` (`distance = cumulative(plannedPath(a)).at(-1)`, `duration = simulate(a).duration` in try/catch, `null` on failure). Nulls sort last deterministically; ties fall back to `updatedAt` descending so order is stable across re-renders.
- **Quota** (`storageUsage()` in `src/storage.ts`): feature-detect `navigator.storage?.estimate` with `typeof`; on success return `{usage, quota, activities}` (bytes, `Math.round`), otherwise `{usage: null, quota: null, activities}`. The UI never shows a fabricated number: it renders "Usage estimate unavailable in this browser." and always shows the activity count from `store.list().length`. Text states the estimate covers all origin data, not only SimRun.

## 6. New file `src/analysis.ts` — exported pure function signatures

```ts
import type {Sample, Simulation, Sport, Units} from './types.js'; // Units = Preferences['units']

export interface HrZoneResult { zones: HrZone[]; belowSeconds: number; totalSeconds: number }
export interface PaceBin { from: number; to: number; seconds: number; samples: number }

export const HR_ZONE_COUNT = 5;
export function zoneBounds(hrMax: number, units?: Preferences): [number, number][]  // bpm boundaries; optional unit passthrough unused—bpm only
export function hrZoneDistribution(samples: Sample[], hrMax: number): HrZoneResult
export function paceHistogram(samples: Sample[], sport: Sport, units: Units): PaceBin[]
export function uniformSplits(sim: Simulation, unitMeters: number): Split[]
export function sanitizeTags(value: unknown): string[] | undefined
export function filterActivities(activities: Activity[], query: string): Activity[]
export type LibrarySortKey = 'updated' | 'name' | 'distance' | 'duration';
export function sortActivities(activities: Activity[], key: LibrarySortKey,
  stats: Map<string, {distance: number; duration: number | null}>): Activity[]
```

Notes: `hrMax` inputs are pre-clamped by `validatePreferences`; `hrZoneDistribution` defensively re-clamps to 100–240 so a direct call cannot divide by a bogus max. `sortActivities` takes precomputed stats so the pure module never imports `simulate()` (keeps `analysis.ts` free of simulation coupling and makes it trivially testable with fixture maps). `filterActivities` and `sortActivities` never mutate their inputs. All functions are deterministic; there is no randomness anywhere in this plan.

## 7. Exact changes to existing files

### `src/types.ts`

Add `tags?: string[]` to `Activity` and `hrMax?: number` to `Preferences` (exact shapes in §4). Nothing else in the file changes; `version: 1` stays literal.

### `src/model.ts`

- Change `function timeAtDistance(...)` (line ~153) to `export function timeAtDistance(...)`. No body change.
- `validateActivity`: add the `cleanTags` step (§4) and include `...(tags ? {tags} : {})` in the explicitly-selected return object (line ~69). Everything else untouched.
- `defaultPreferences` (line 7): add `hrMax: 190`.

### `src/storage.ts`

- `validatePreferences`: add `hrMax: Number.isFinite(p.hrMax) ? Math.max(100, Math.min(240, Number(p.hrMax))) : undefined` and only include the key when defined (keeps old stored JSON shape intact apart from the new optional key).
- `defaultPreferences` comes from `model.ts`, so the default flows through here automatically.
- Add `storageUsage(activities: number, estimate?: () => Promise<{usage?: number; quota?: number}>): Promise<{usage: number | null; quota: number | null; activities: number}>` — feature-detects `navigator.storage.estimate`, optional parameter so `tests/library.test.mjs` can inject a fake without touching `navigator`.
- Re-export nothing new otherwise; `filterActivities`/`sortActivities`/`sanitizeTags` live in `src/analysis.ts` and are imported by `main.ts` directly.

### `src/charts.ts`

- `export type ChartMode = 'elevation' | 'pace' | 'hr' | 'splits';`
- `render()`: add a `'splits'` branch. When mode is `'splits'`, compute `uniformSplits(s, imperial ? 1609.344 : 1000)` (require `s`; otherwise reuse the existing empty-state `<div class="chart-empty">` with message "A completed simulation is needed for splits."), map to `rows` as `{p: synthetic Point at split midpoint, d: midpoint distance, v: seconds-per-km pace}`, then draw **rectangles** instead of the profile polyline: one `<rect>` per split, `x = px(start)`, `width = px(end) − px(start)`, `y = py(v)`, `height = 98 − py(v)`, `class="split-bar"`; the final partial bar uses its true width with no padding. Y-axis label via `format()` in clock form for runs (reuse `this.mode==='pace'` formatting branch by treating pace identically), speed form for rides. The empty/valid filtering, `step` downsampling, and gap-break logic apply only to line modes; bars iterate splits directly (typically ≤ a few hundred).
- `cursor()` and `format()` need no structural change: the cursor's nearest-`d` lookup and tooltip already work off `rows`, and `hover(best.p)` receives the synthetic midpoint point, which the map can safely ignore (no matching real point). This is the one coupling risk — see §11.
- Extract the SVG-building inner loop minimally: add a `renderBars(rows, opts)` private method used by the `'splits'` branch so the compare dialog can render a standalone pace profile by instantiating `new Charts(host, () => {})` and setting `mode='pace'` — no second code path needed for comparison charts.

### `src/main.ts`

1. **Chart tab wiring** (line 102): extend the mode loop `['elevation','pace','hr']` → `['elevation','pace','hr','splits']` and add the `chart-splits` button to the toggle list. No other change; `Charts.render` already re-renders on mode switch.
2. **Analysis section** (new function `renderAnalysis(sim, preferences)` called from `render()` after the splits table update): renders into a new `<section id="analysis-section">` in the inspector (see §8). HR bars only when `sim` exists and `a.settings.hrEnabled`; pace histogram whenever `sim` exists. All values pass through `distanceValue`/`heightValue`/`clock` for unit awareness.
3. **Library**: extend `showHistory()` rows to render tag chips after the activity summary line, add a search input (`history-search`) and sort select (`history-sort`) in the `history-dialog` header; the existing in-memory list from `store.list()` is filtered with `filterActivities` and sorted with `sortActivities` before rendering. Re-render on `input` events only; no store change.
4. **Tags editor**: new input row in the inspector near `activity-name`; on change (debounced alongside draft save), run `sanitizeTags` and `store.save(editor.activity)` when the activity is saved, otherwise stage tags on the draft activity object. Library rows get no tag editor (edit happens on the open activity, keeping the dialog simple).
5. **Comparison dialog**: new `compare-dialog` with two `<select>` lists populated from `store.list()`, a Compare button, and a results container. On confirm: `simulate()` each inside guarded try/catch, fill the headline table (§5.4), render two pace mini-charts, insert the simulated-not-measured caption. Opening the dialog populates selects with `store.list()`; invalid selections disable the Compare button.
6. **Drag-and-drop**: `document.addEventListener('dragover', e => e.preventDefault())` and a `drop` listener that (a) returns early if `document.querySelector('dialog[open]')` (matches the existing guard at line 128), (b) `preventDefault`s, (c) reads `e.dataTransfer.files`, dispatches `.json`/`.json`-sized files to the same code path as the `backup-file` change handler (refactor that handler's body into `restoreBackupFile(file: File)`), everything else to the same path as the `gpx-file` change handler (refactor into `importRouteFiles(files: FileList)`), and (d) toasts the resulting notice/error via the existing `guarded`/`toast` path. Also `dragleave`/`drop` always clear any drop-highlight class.
7. **Quota display**: in the `settings-dialog` "Offline map data" fieldset (or an adjacent "Local data" block), add `<p id="storage-usage">` filled on dialog open from `storageUsage(...)`; fallback text per §5.5.

## 7b. `public/index.html` and `public/app.css`

- `index.html`: add the fourth tab button `<button id="chart-splits" role="tab" aria-selected="false">Splits</button>` inside the existing `role="tablist"` (line 29); add `<section id="analysis-section" aria-label="Analysis">` to the inspector after the splits details; add `<dialog id="compare-dialog" aria-labelledby="compare-title">` with two selects, a Compare button, a stats table, and two chart host divs; add `history-search` input and `history-sort` select to the `history-dialog` header; add the `storage-usage` paragraph to `settings-dialog`.
- `app.css`: `.zone-bar` rows (label, track, value), `.pace-hist` flex bars, tag `.chip` styles reusing existing button-like tokens, `.compare-grid` two-column stat table, drop-target outline (`body.dragging` class) — light neutral surfaces, orange accent, matching the existing palette; no new fonts or icons beyond existing `data-icon` set.

## 8. UI/UX details

- **HR zones:** five labeled rows (Z1 50–60% … Z5 90–100%) with absolute bpm ranges shown in the row label ("Z4 · 152–171 bpm" for hrMax 190). Bars are horizontal, width = time share, with the percentage right-aligned. Empty state when `hrEnabled` is false: one line "Enable simulated heart rate to see zone distribution." Caption: "Simulated heart rate against an estimated maximum of N bpm."
- **Pace histogram:** bars with an x-axis of 4–6 tick labels in the active unit (`min/km`, `min/mi`, `km/h`, `mph`); tooltip on hover showing the bin range and minutes; empty state reuses the chart-empty pattern. Header notes "time-weighted, simulated".
- **Splits tab:** bars only; the axis under the chart shows cumulative distance in the active unit; the last (partial) bar's width is proportional to its real distance. Hover reuses the existing cursor/tooltip (`x.xx km · 4:58 /km`).
- **Comparison:** selects labeled "Activity A" / "Activity B"; while either `simulate()` throws, that column shows `—` and the note "This activity can no longer be simulated locally." The Compare button is disabled until both selects hold distinct valid IDs. Dialog closes with `data-close` like the existing dialogs; Escape works natively via `<dialog>`.
- **Library:** search input filters as you type (debounced ~150 ms); sort select options "Recently updated", "Name", "Distance", "Duration". Empty search result shows "No activities match this search." Tag chips are plain text with subtle borders, not buttons, in list rows.
- **Accessibility:** the new tab keeps `role="tab"` and the existing `aria-selected` toggle pattern; the compare dialog gets `aria-labelledby`; the drop affordance is keyboard-independent (file pickers remain the primary path); zone bars get a `role="img"` + `aria-label` summarizing "Simulated heart-rate distribution: 34% Z1 …"; live updates flow through the existing `#toast` `role="status"`.
- **Units:** every distance/duration/pace string routes through the existing `distanceValue`, `heightValue`, `clock`, and unit-suffix helpers already used in `render()`; imperial switches bin widths per §5.2 and split boundaries per §5.3.

## 9. Test plan

### `tests/analysis.test.mjs` (new, Node, imports from `../dist/src/analysis.js` and `../dist/src/model.js`)

1. `zoneBounds` for hrMax 190 yields the five expected bp boundaries; clamping hrMax 300/50 → 240/100.
2. `hrZoneDistribution` with a constant-hr fixture places 100% of weighted time in one zone; a two-zone fixture with uneven gaps weights by time gap, not sample count.
3. Samples below 50% land in `belowSeconds`; `hr > 100%·hrMax` counts into zone 5; disabled/absent `hr` yields zeroed zones.
4. `uniformSplits` on a known constant-pace simulation: N full km splits each ≈ pace seconds; the partial final split's distance ≈ remainder; durations sum to `simulate().duration` within 1 s; consistency with `computeSplits` totals on the same fixture.
5. `paceHistogram` run/metric: 10 s/km bins, zero- and NaN-speed samples skipped, weighted seconds sum to activity duration; imperial run uses ~15 s/mi bins; ride km/h and mph 1-unit bins.
6. `sanitizeTags`: trims, strips control characters, dedupes case-insensitively keeping the first, caps at 8, drops tags outside 1–24 chars, returns `undefined` for empty/non-array input; round-trips through `validateActivity` and `JSON.parse(JSON.stringify(...))`.
7. `filterActivities`: case-insensitive name match, tag match, multi-token AND semantics, whitespace-only query matches everything.
8. `sortActivities`: each key's ordering; non-mutation of the input array; null-duration sorting last under `'duration'`; deterministic tie-break.
9. `storageUsage`: with no `estimate` support (or a rejecting one) returns `{usage: null, quota: null}`; with an injected estimator returns rounded values (pass the optional parameter — no `navigator` stubbing needed).
10. Backup round-trip: `parseBackup` on a JSON containing `tags` preserves them; tags absent → field absent, not `[]`.

### `tests/library.test.mjs` (new)

Focused on the storage-facing helpers `validatePreferences` (`hrMax` clamps, defaults) and end-to-end tag persistence through `validateActivity` + a `parseBackup` round-trip, plus the pure sort/filter matrix shared with analysis tests where the fixture differs (larger synthetic library of 10 activities).

### Browser checks (extend `tests/browser.py`)

After the existing loop fixture is simulated and saved twice with different paces: open `history-dialog`, assert two rows; type in `history-search`, assert row count changes; select both activities in `compare-dialog`, click Compare, assert the Δ column contains a distance value and the "Re-simulated locally" caption is present; click `chart-splits`, assert at least one `.split-bar` rect and the tab's `aria-selected`; enable simulated HR, assert five `.zone-bar` rows render; open `settings-dialog`, assert `storage-usage` shows either an estimate or the unavailable sentence; dispatch a synthetic `drop` event with a `DataTransfer` carrying the existing GPX fixture text and assert a new library row appears; assert a drop is ignored while `compare-dialog` is open.

## 10. Verification commands

```
npm run typecheck          # strict tsc --noEmit, must stay clean
npm test                   # npm run build && node --test tests/*.test.mjs, all green incl. new files
npm run build              # already covered by npm test, re-run after chart/index changes
python tests/browser.py --url http://127.0.0.1:5173   # after `npm run dev` (or `npm start`)
python tests/browser.py --isolated    # restricted fallback harness
```

Node 20+ (repo runs 24.21.0); `engines` stays `>=20`; no dependency changes so no lockfile churn.

## 11. Risks and mitigations

- **`navigator.storage.estimate()` availability** (Firefox private mode, Safari, all non-secure contexts): feature-detect + optional injected estimator for tests; UI fallback text is explicit that only the session activity count is known. Never show a fabricated quota.
- **Chart cursor coupling:** the pointer cursor assumes rows of `{p, d, v}` on a shared x-scale. Splits bars reuse that scale, so hover works, but bar tooltips read pace in clock format via `format()` — verified by a dedicated browser check; if nearest-`d` lookup misbehaves on wide bars, snap to the bar whose `[start, end]` contains the pointer instead of nearest-midpoint (small local fallback inside the `'splits'` branch only).
- **`timeAtDistance` export churn:** making a private function exported cannot break existing callers; `computeSplits`/tests already import from `dist/src/model.js`, and `tests/core.test.mjs` already exercises it indirectly. No golden-output change is expected because `simulate()` is untouched.
- **Validation drift:** tags/hrMax touch `validateActivity`/`validatePreferences`, which every read path funnels through; a malformed stored tag list must not throw the whole activity away — `sanitizeTags` drops rather than rejects, keeping `store.list()` resilient (mirrors how `validateActivity` already cleans, not rejects, optional `loop`/`splits`).
- **Performance:** histograms and zone counts are single O(n) passes over ≤ 40,000 samples; `uniformSplits` is O(splits·log(samples)); comparison re-simulates two activities once per open, matching the cost `showHistory()` already pays per row.
- **Drag-drop surprises** (folders, huge files, non-files): filter `e.dataTransfer.items` by `kind === 'file'`, reuse the existing 15 MB / 50 MB size guards inside the refactored import/restore helpers, and never `preventDefault`-swallow errors — they surface through the existing toast path.

## 12. Ordered milestones

1. **Type + validation deltas.** `types.ts` fields, `validateActivity` tags, `validatePreferences` hrMax, `defaultPreferences`. *Verify:* `npm run typecheck && npm test` (existing 52 must stay green).
2. **`src/analysis.ts` pure module + unit tests.** All of §6 with `tests/analysis.test.mjs` cases 1–10 passing. *Verify:* `npm test`; new file green.
3. **Splits chart tab.** Fourth tab, `renderBars`, cursor check. *Verify:* `python tests/browser.py` chart-tab case; screenshots via `--screenshots`.
4. **Analysis section (HR zones + histogram).** `renderAnalysis` wiring, inspector section, unit switching re-render. *Verify:* browser check with HR enabled/disabled; metric↔imperial toggle changes labels and bin widths.
5. **Library: tags, search, sort.** Inspector tag editor, chips in `showHistory`, `history-search`/`history-sort`, non-mutating helpers. *Verify:* browser search/sort/tag assertions; `tests/library.test.mjs` green.
6. **Comparison dialog.** Dialog markup, wiring, dual re-simulation, graceful `—` path (deliberately save an activity, then corrupt it in a test-only fixture to hit the invalid branch). *Verify:* browser compare assertions.
7. **Drag-and-drop + storage quota.** Window-level listeners with dialog guard, `storage-usage` paragraph. *Verify:* browser drop assertions; manual `npm start` + DevTools check that estimate renders in Chromium and the fallback sentence renders when the API is absent.

Each milestone ends with `npm test` green; milestones 3–7 additionally run `python tests/browser.py` (normal mode when a server can run, `--isolated` otherwise).

## Open decisions for confirmation

1. **Sub-50% HR time:** counted in `belowSeconds` and excluded from the five zones (reported in the caption) rather than forced into Z1 — confirm this labeling is acceptable.
2. **Imperial run-histogram bin width** fixed at 15 s/mi (vs. converting 10 s/km exactly) — chosen for stable axis ticks; confirm.
3. **Tag deduplication is case-insensitive** (first spelling wins) — confirm.
4. **Comparison dialog allows draft activities** to be picked (they re-simulate fine if valid); alternatively drafts could be hidden. Default chosen: show all saved activities including drafts.
