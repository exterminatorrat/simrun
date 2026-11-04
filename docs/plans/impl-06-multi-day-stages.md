# Implementation Plan 06 — Multi-day and stage routes

Concrete implementation of `docs/plans/06-multi-day-stages.md`. Constraints: strict
TypeScript, native DOM, ES modules, no new runtime dependencies, `Activity.version` stays
`1`, and every number stays labeled simulated. Changes are limited to `src/`, `tests/`,
`public/`, and documentation.

## 1. Success criteria

1. A resolved route can be split into 2–31 days, evenly or by daily distance.
2. Each day is a valid `Activity` with its own path, start time, and `stage` reference.
3. Saving writes every day to the local library; exporting produces one GPX, TCX, and FIT
   per day inside one ZIP.
4. Per-day metrics in the preview match what the saved activity simulates.
5. Workout steps, split plans, and out-of-range rest stops are removed with a visible
   notice, never silently reinterpreted.
6. `npm test`, `npm run lint`, and `npm run typecheck` pass.

## 2. Section 1 — data model and validation

**`src/types.ts`**

```ts
export interface StageRef { tourId:string; index:number; total:number }
export interface Activity {
  // existing fields…
  stage?:StageRef;
}
```

**`src/model.ts`** — inside `validateActivity`, next to `cleanSplits`:

```ts
const cleanStage=(v:StageRef|undefined):StageRef|undefined=>{
 if(v===undefined||v===null)return undefined;
 if(typeof v!=='object'||typeof v.tourId!=='string'||!v.tourId||v.tourId.length>80)throw Error('Invalid stage reference.');
 if(!Number.isInteger(v.index)||!Number.isInteger(v.total)||v.total<2||v.total>31||v.index<1||v.index>v.total)throw Error('Invalid stage reference.');
 return {tourId:v.tourId,index:v.index,total:v.total};
};
```

Add `stage` to the explicit return object in the same optional-spread style as `loop`:
`...(stage?{stage}:{})`. Stored records without a stage remain byte-identical.

Verification: `tests/tour.test.mjs` asserts a round trip and that `total: 1`,
`index: 0`, and `index > total` throw.

## 3. Section 2 — `src/tour.ts`

Exports: `MAX_STAGES`, `evenStageBoundaries`, `dailyStageBoundaries`, `StageResult`,
`stageActivities`.

```ts
export const MAX_STAGES=31;

export function evenStageBoundaries(total:number,days:number):number[]
export function dailyStageBoundaries(total:number,perDayMeters:number):number[]

export interface StageResult { stages:Activity[]; notices:string[] }
export function stageActivities(base:Activity,boundaries:number[],tourId:string):StageResult
```

Validation order inside `stageActivities`:

1. Resolve `plannedPath(base)`; require at least two points and two metres.
2. Require `1 ≤ boundaries.length < MAX_STAGES`.
3. Require strictly increasing boundaries with `0 < b < total - 1`.
4. Require a non-empty `tourId` of at most 80 characters.

Per-day construction follows the table in the design plan. Helpers stay module-private:

- `wallClock(epochMs, utcOffset)` — rebuilds the `YYYY-MM-DDTHH:mm` input string.
- `clipRouteData(data, from, to)` — clips `streetNames` spans and slices `surfaceEdges`
  through a cumulative cursor, dropping fragments of 1 cm or less.

Notices, each pushed once per call:

- `'Workout steps were removed because they are measured from the start of the full route.'`
- `'Split plans were removed because they are measured from the start of the full route.'`
- `'Rest stops outside a day were dropped.'` — only when some base rest was not carried.

The function returns `notices` rather than mutating the base activity. `base` is never
modified; every stage is a new object built from `{...base}` with `loop`, `splits`,
`workout`, `pauses`, and `routeData` explicitly reset.

Verification: `tests/tour.test.mjs` (below).

## 4. Section 3 — analysis export

**`src/analysis.ts`** — rename the private `statsFor` to `export function
activityStats(entry:{activity:Activity;sim:Simulation}, heartRates:TrimpHeartRates={})`
and update the `compareActivities` call sites. No behavior change; `compareActivities`
keeps its signature and output.

This is the only edit to an existing pure module, and it makes the preview table and the
comparison dialog share one definition of distance, duration, pace, and elevation gain.

## 5. Section 4 — UI wiring

**`public/index.html`** — append one section inside the inspector, after the batch
`</details>`:

```html
<details id="stages-details" class="settings-section">
  <summary><span data-i18n="Multi-day plan">Multi-day plan</span> <span id="stages-count">—</span></summary>
  <p class="fine-print" data-i18n="Split this route into days…">…</p>
  <div class="segmented" role="group" aria-label="Break down by">
    <button id="stages-mode-days" class="active" aria-pressed="true">Even days</button>
    <button id="stages-mode-distance" aria-pressed="false">Daily distance</button>
  </div>
  <div class="inline-field" id="stages-days-field">…days…</div>
  <div class="inline-field" id="stages-distance-field" hidden>…daily distance…</div>
  <div id="stages-table" class="splits-table"></div>
  <p id="stages-status" class="fine-print"></p>
  <div class="stage-actions">
    <button id="stages-preview" type="button" class="text-button">Preview days</button>
    <button id="stages-save" type="button" class="text-button">Save days</button>
    <button id="stages-export" type="button" class="text-button">Export days</button>
  </div>
</details>
```

Every added string needs a matching `en.ts` key, because `tests/i18n.test.mjs` compares the
used key set with the catalog in both directions.

**`public/app.css`** — two rules next to `.split-row`:

```css
.stage-row{grid-template-columns:20px minmax(0,1.3fr) .9fr .9fr}
.stage-actions{display:flex;gap:14px;flex-wrap:wrap}
```

**`src/main.ts`**

- Import `evenStageBoundaries`, `dailyStageBoundaries`, `stageActivities` and
  `activityStats`.
- Local state: `let stageMode:'days'|'distance'='days'`.
- `stageBoundaries()` reads the active input and converts the daily distance from the
  current unit.
- `buildStages()` calls `validRoute()` then `stageActivities(editor.activity,
  stageBoundaries(), newId())`.
- `previewStages()` renders `# · Distance · Climb · Time` per day from `activityStats`
  over `simulate(stage)`, then writes notices into `#stages-status`.
- `stages-save` maps `store.save` over the recomputed stages and toasts a fixed
  confirmation.
- `stages-export` simulates each day with `simulateInWorker`, calls
  `zipActivities(stages, undefined, [], simulations)`, and downloads one ZIP named
  `<date>-<name>-days.zip`.
- Mode buttons clear the preview table and call `render()`; `render()` marks the active
  mode, toggles the two input rows, and sets `#stages-count` to `Day i of n` when the open
  activity is a stage, otherwise an em dash.

Errors are plain English strings (they become their own catalog keys) so failures surface
through the existing `guarded()` toast path.

## 6. Section 5 — tests

`tests/tour.test.mjs`, using the `dist/` build like every other Node test:

1. `evenStageBoundaries` returns `days-1` cuts with conserved total distance.
2. `dailyStageBoundaries` uses `ceil(total/perDay)` days and a shorter last day.
3. Both reject too-short routes, out-of-range day counts, and a single-day request.
4. `stageActivities` produces unique ids, `Day n` names, `stage` references, and start
   times exactly one day apart across a fixed UTC offset.
5. Day distances sum to the parent route distance within 1 cm.
6. Rest stops re-base to the day and out-of-day rests are dropped with a notice.
7. `streetNames` and `surfaceEdges` clip to the day range.
8. Workout and split plans are removed with notices; a loop plan is materialized before
   splitting.
9. `validateActivity` round-trips `stage` and rejects invalid references.

Verification: `npm test` (build + all Node tests + i18n key audit), `npm run lint`,
`npm run typecheck`, then a browser check of the section and one export.

## 7. Section 6 — documentation

- `docs/plans/README.md`: inventory row 06.
- `README.md`: one bullet on multi-day planning.
- `CHANGELOG.md`: an `Unreleased → Added` entry.

## 8. Risks

- **Boundary float error.** Cuts are floats; `trimRouteByDistance` interpolates, so the
  sum of day distances can differ from the total by well under a centimetre. The test
  allows 0.01 m.
- **Cost.** 31 days over a 100,000-point route is 31 linear trims; preview also simulates
  each day. Preview is user-initiated; save iterates sequentially; export simulates in the
  worker so the UI stays responsive.
- **Dropped plans.** Workouts and split markers do not cross day boundaries. The notice is
  the contract; a later plan can add per-day targets.
