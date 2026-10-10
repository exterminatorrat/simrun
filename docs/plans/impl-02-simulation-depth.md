# Simulation depth — file-and-function implementation plan

Companion to `docs/plans/02-simulation-depth.md`. That document defines the design; this one specifies file-and-function-level changes. All line anchors refer to the current checkout on branch `hoplite/medma-2f5935b9`. No code is implemented by this document.

## 1. Goal

Deepen the seeded simulation and its analysis surfaces without breaking any existing contract:

1. **Power, cadence, HR drift, fatigue** — optional per-sample power (W) and cadence (rpm/spm) outputs; cycling watts from speed/weight/grade and running power from speed/weight/grade; cadence from the existing seeded wave with sport defaults; duration-dependent HR drift intensified by heat while preserving the HR-average contract; fatigue 0–30 % that reshapes timing while the exact target duration is unchanged; chart tabs; opt-in GPX watts/cad extensions.
2. **Offline weather presets** — fixed presets `ideal`/`cool`/`mild`/`warm`/`hot`/`humid`/`windy` with temperature, humidity and a uniform headwind; deterministically scales total duration, capped at 2×; deepens HR drift; never changes geometry or power estimates; GPX `atemp` and a simulated-weather description.
3. **Grade modeling, gradient shading, elevation scrubber** — replace the raw ~10 m grade with a centered 30 m smoothed grade clamped to ±15 %; asymmetric uphill ×2.0 and downhill ×1.1 inside the existing clamps and exact-duration normalization; gradient-colored route segments capped at 400 with legend and plain-line fallback; an interactive elevation-chart scrubber with map marker, grade/pace tooltip, keyboard controls and Escape-to-clear; presentation state must not affect simulation.

## 2. Scope and non-goals

**In scope:** `src/types.ts`, `src/model.ts` (`defaults`, `validateSettings`, `validateActivity`, `simulate`), `src/geometry.ts` (two new pure helpers), `src/gpx.ts` (`exportGPX`), `src/charts.ts`, `src/map.ts`, `src/main.ts`, `public/index.html`, `public/app.css`, new `tests/depth.test.mjs`, new `scripts/regen-golden.mjs`, new `tests/golden/depth-seed-12345.json`, and doc updates (`docs/VERIFICATION.md`, `docs/ACCEPTANCE.md` items 7 and 16, `README.md`).

**Non-goals:** no FTP/zone/threshold/TSS modeling and no power→timing feedback (power is derived only); no sensor ingestion or calibration profiles; no live weather APIs, geolocation, network calls, precipitation, gusts, or wind-direction geometry (zero new `fetch(` under `src/`); no new elevation sources and no changes to `elevationStats` or its deadband (`src/geometry.ts:82`); no shading of the dashed draft line; no separate grade chart mode; no per-split power metrics (`computeSplits` stays untouched); no new PRNG streams; no new runtime dependencies; `Activity.version` stays `1`; the ~40,000-interval / ~50,000-sample caps in `simulate()` are untouched.

## 3. Architecture and determinism rules

- **No new PRNG streams.** Every effect is a closed-form function of `(settings, route, seed)`: cadence reuses the seed-derived `phase`/wave signal (`src/model.ts:90–93`); HR drift is a closed-form function of `(t, duration, weather)`; fatigue and the weather penalty are closed-form functions of settings and route; power is a pure function of `(speed, grade, weight)`. The existing seeded streams (HR walk `seed^0x27d4eb2f`, GPS noise `0x9e3779b9`, dropout `0x85ebca6b`) are consumed exactly as today, bit-for-bit.
- **Presentation never feeds back.** `simulate()` reads only `Activity`. Scrub position, chart tab, legend visibility and shading state live in `Charts`/`RouteMap`/`main.ts` instances and are never inputs to the model. A scrubbed export must be byte-identical to an unscrubbed one.
- **Optional settings, absent = off.** New `Settings` fields are optional; `validateActivity` cleans them with the same explicit field-selection pattern it uses for `gps` (model.ts:69–73), never merging untrusted objects. Old activities and JSON backups load unchanged; `Activity.version` stays `1`.
- **Determinism is per app version.** Changing formulas changes outputs for the same seed. Exactly one milestone alters timing (the grade term); it re-pins the seed-12345 golden with a documented regeneration step (§8) and is logged in `docs/VERIFICATION.md`.
- **Honesty labeling.** Exports keep `creator="SimRun"` and the existing "not a recorded workout or device measurement." sentence (`src/gpx.ts:18`); each feature extends that `desc` rather than replacing it. UI copy says "estimated"/"simulated" everywhere.

## 4. Data model deltas (`src/types.ts`)

```ts
export type WeatherPreset = 'ideal'|'cool'|'mild'|'warm'|'hot'|'humid'|'windy';
export interface WeatherSim { preset:WeatherPreset; tempC:number; humidity:number; headwindKph:number }
export interface PowerSim { enabled:boolean; weightKg:number }
export interface CadenceSim { enabled:boolean; average:number; variation:number }
export interface Settings {
  sport:Sport; profile?:RouteProfile; start:string; utcOffset:number; pace:number; speed:number;
  mode:'constant'|'natural'; variation:number; sample:1|2|5;
  hrEnabled:boolean; hrAverage:number; hrVariation:number; seed:number;
  gps?:GpsSim;
  power?:PowerSim;      // absent = no power estimate
  cadence?:CadenceSim;  // absent = no cadence estimate
  fatigue?:number;      // 0..0.3, absent = 0
  weather?:WeatherSim;  // absent = neutral conditions, penalty 1
}
export interface Sample extends Point { time:number; distance:number; speed:number; power?:number; cad?:number }
export const WEATHER_PRESETS:Record<WeatherPreset,Omit<WeatherSim,'preset'>> = {
  ideal:{tempC:12,humidity:40,headwindKph:0}, cool:{tempC:5, humidity:60,headwindKph:0},
  mild:{tempC:18,humidity:45,headwindKph:0}, warm:{tempC:26,humidity:45,headwindKph:0},
  hot:{tempC:33,humidity:55,headwindKph:0},  humid:{tempC:24,humidity:85,headwindKph:0},
  windy:{tempC:15,humidity:50,headwindKph:25},
};
```

`Activity` (`version` stays `1`), `Simulation`, `Split`, and `ElevationStats` are unchanged. Power and cadence are simulation outputs on `Sample`, never route data — exactly how `hr` behaves today (`validateActivity`'s `clean()` keeps imported route `hr`; `simulate()` deletes it at model.ts:108 before assigning modeled values). `computeSplits` (model.ts:171) and `splitBoundaries` (model.ts:162) are untouched.

## 5. Algorithms (formulas and constants)

### 5.1 Power (Feature 1)

Per sample, `v` = sample speed (m/s), `grade` = smoothed 30 m grade at the sample distance (§5.3), `g = 9.81`, `ρ = 1.226`:

- **Cycling:** `P = v·(m·g·(Crr + max(grade, −0.06))) + 0.5·ρ·CdA·v³` with `m = weightKg + 10`, `Crr = 0.005`, `CdA = 0.40`. Anchor: 70 kg rider at 24 km/h flat ⇒ rolling `80·9.81·0.005·6.67 ≈ 26 W`, aero `0.5·1.226·0.40·6.67³ ≈ 146 W` ⇒ ≈ **172 W**.
- **Running:** `P = m·v·g·(1.04 + max(grade, −0.06)) + 0.5·ρ·0.24·v³` with `m = weightKg`. Anchor: 70 kg at 12 km/h flat ≈ **243 W**. The 1.04 form factor reproduces metered running power; the grade term is the exact mechanical climb cost.
- Both clamped 0–2500 W and rounded. Computed after the sample loop from stored speeds/grades; power never feeds back into timing. Test tolerance: ±5 % on anchors.

### 5.2 Cadence (Feature 1)

`cad = round(clamp(average·(1 + variation·wave), 30, 230))`, where `wave` is the same seeded wave already computed in the weights loop (model.ts:91, `phase` from model.ts:90). Natural mode only — constant mode yields flat `average`, mirroring how the pace wave is mode-gated. Sport defaults: run 172 spm, ride 88 rpm; `variation` 0–0.3. No new entropy; the same wave feeds pace weight and cadence.

### 5.3 Grade model (Feature 3, simulator part — the one deliberate timing change)

- **Smoothing window:** the current grade uses one ~10 m interval, `clamp((q.ele−p.ele)/ds, −.15, .15)` (model.ts:96). Replace with a **centered 30 m window** per interval: `grade = (ele(d+15) − ele(d−15)) / 30` via two `atDistance(route, c, ·)` calls at `d±15`, clamped to ±0.15; missing elevation ⇒ 0 as today. Interval count `n` and all memory caps (model.ts:87) unchanged.
- **Asymmetric response:** replace `grade*.7` (model.ts:97) with `gradeTerm = grade ≥ 0 ? grade·2.0 : grade·1.1` — a 10 % climb costs +20 % time, a 10 % descent saves ≈ 11 %. Still a single linear term inside the existing clamp `(0.65, 1.4)`.
- **Exact-duration normalization preserved:** the renormalization at model.ts:100 (`times[i] = times[i]/raw*durationMs`) is untouched, so total duration stays exact and the 'smooth natural simulation normalizes exact duration…' invariant holds; only the distribution of time across splits changes. This is the deliberate breaking timing change, handled by the golden re-pin (§8).
- The per-interval smoothed grades are stored once and reused by power (§5.1) and by `gradeSegments` — one grade implementation, three consumers.

### 5.4 HR drift deepened by heat (Feature 1 + Feature 2 coupling)

The existing drift term (model.ts:116) `min(hrVariation·3, hrVariation·0.03·max(0, t−600)/60)` gains a heat factor on the slope: `driftSlope = hrVariation·0.03·(1 + 0.5·max(0, tempC−12)/21)`. The `hot` preset (33 °C) deepens late-run drift by 50 %, still capped at `hrVariation·3`. Because the HR block mean-centers on the target (model.ts:123–125), the time-weighted mean stays exactly `hrAverage`: the drift deepens the **shape**, never the mean — the HR-average contract and existing tests hold by construction.

### 5.5 Offline weather penalty (Feature 2)

`WEATHER_PRESETS` fixes `tempC`/`humidity`/`headwindKph` per preset (§4); `windy` carries 25 kph headwind. One deterministic scalar, zero entropy:

- `heat (run) = 1 + 0.0055·max(0, tempC−12) + 0.002·max(0, humidity−60)`; rides use **half** of both coefficients.
- `cold (run only) = 1 + 0.0025·max(0, 5 − tempC)`.
- `wind: run = 1 + 0.006·headwindKph`; `ride = 1 + 0.5·headwindKph / max(5, speed)` (configured target speed in km/h).
- `penalty = clamp(heat·cold·wind, 1, 2)` — total duration is capped at 2×.

`simulate()` line 86 becomes `const duration=durationFor(total,s.sport,s.pace,s.speed)*(s.weather?weatherPenalty(s):1);` — computed **before** the existing duration validation, so splits, the duration input, charts, cues and GPX inherit the slowdown through the existing normalization path (the same pipeline natural-mode variation already flows through). Anchor: hot (33 °C, 55 %) ⇒ run factor `1 + 0.0055·21 = 1.1155` → 25 min ≈ 27.9 min.

**Semantic decision (explicit):** weather scales the resulting duration rather than redistributing time inside a fixed duration. The configured pace/speed is the athlete's neutral-condition target; heat, humidity and headwind honestly lengthen the activity. The shape-only alternative was rejected because its effect would be invisible in the duration the app advertises and exports. **Wind is a uniform headwind with no route-direction awareness** — a stated limitation that keeps the model deterministic.

**HR coupling:** only the §5.4 drift factor reads `tempC`. Weather does not change geometry or the power formulas (watts follow the simulated speed, which already embeds the weather-scaled timing; the formulas themselves are untouched, and the desc says so).

### 5.6 Fatigue (Feature 1)

Optional `settings.fatigue` (0–0.3, UI 0–30 %, default 0). Applied to the timing weights after the existing clamp (model.ts:97): `w ← w·(1 + fatigue·(i/n)²)` for interval `i` of `n`. Because `simulate()` renormalizes to the exact target duration (model.ts:100), fatigue reshapes pace (final splits slower) while the total duration stays exact — the same contract as natural-mode variation today.

### 5.7 Gradient shading and scrubber (Feature 3, presentation)

- **`gradeSegments(path, maxSegments=400)`** (new pure export in `src/geometry.ts`, beside `elevationStats`): splits the path into ≤ 400 roughly equal pieces; per piece `{a:Point, b:Point, grade:number}` from the centered 30 m window, clamped ±0.15; empty array when elevations are missing — nothing is interpolated into existence.
- **`gradeColor(grade)`** (same module) color stops: `−0.08 → '#2f6fb2'` (blue), `0 → '#7d8b96'` (neutral), `+0.04 → '#c07a2a'` (amber), `+0.12 → '#a8322e'` (red).
- **Scrubber state isolation:** the pinned row index, marker and tooltip live only in `Charts`/`RouteMap` instances; `simulate()` never reads UI state, asserted by a byte-identical export test (§9).

## 6. Exact changes to `src/model.ts` `simulate()`, `src/charts.ts`, `src/gpx.ts`, `src/map.ts`

### `src/model.ts`

- **`defaults()` (line 12):** settings gain `power:{enabled:false,weightKg:70}`, `cadence:{enabled:false,average:172,variation:5}`, `fatigue:0`; no `weather` key (absent = neutral).
- **`validateSettings()` (line 37):** add `weightKg 30–200`, `cadence.average 30–230`, `cadence.variation 0–30`, `fatigue 0–0.3` to the existing range loop (line 38); boolean checks for `power.enabled`/`cadence.enabled` like `hrEnabled` (line 43); weather validation when present: preset in the seven-value union, `tempC −30…50`, `humidity 0–100`, `headwindKph 0–80`.
- **`validateActivity()` (line 44):** extend the explicit clean-settings return (line 69–73) to select the new fields exactly like `gps` — conditional spreads, never merging untrusted objects.
- **`simulate()` (lines 82–127):**
  1. Line 86: `const duration=durationFor(total,s.sport,s.pace,s.speed)*(s.weather?weatherPenalty(s):1);` where `weatherPenalty` is a new exported pure function implementing §5.5.
  2. Weights loop (lines 91–99): replace the raw interval grade (line 96) with the centered 30 m smoothed grade (two `atDistance(route,c,·)` calls at `d±15`); replace `grade*.7` (line 97) with the asymmetric term; multiply by the fatigue factor `(1+s.fatigue*(i/n)**2)`; store the smoothed grade per interval (one array, three consumers).
  3. After the sample loop (after line 113, before the HR block): if `s.power?.enabled`, compute per-sample watts from sample speed + stored grade (sport-specific constants from §5.1); if `s.cadence?.enabled`, compute per-sample cadence from the stored wave (§5.2). Pure post-passes; timing, distance and speed untouched.
  4. HR block (lines 110–127): only the drift term (line 116) gains the weather heat factor (§5.4); mean-centering (lines 123–125) untouched.
  5. `gpsRandom` (line 129), `applyGpsNoise` (line 131) and `applyDropout` (line 141) are untouched bit-for-bit.

### `src/charts.ts`

- **`ChartMode` (line 4):** `'elevation'|'pace'|'hr'|'power'|'cadence'`.
- **`render()` row building (lines 10–13):** power rows read `p.power ?? NaN`; cadence rows read `p.cad ?? NaN`; when the mode's feature is disabled, show the existing `chart-empty` pattern (lines 14–15) with copy naming the enabling toggle ("Enable estimated power in Activity settings.").
- **`format()` (line 26):** power renders `Math.round(v)+' W'`; cadence `Math.round(v)+' rpm'` (ride) or `+' spm'` (run).
- **Scrubber:** `pointerdown` starts a scrub with `setPointerCapture`; moves update the pin; release **keeps** the pin (stickiness distinguishes it from the transient hover at line 27); Escape or click on empty chart area clears; Left/Right arrows move the pin one data row; the host becomes focusable. The tooltip (lines 29–30) gains the local grade (elevation difference over ±15 m of planned-path distance) rendered as `▲ +4.2 %`, and pace readouts gain a "(simulated)" suffix. Existing `hover()` → `map.hover` wiring (main.ts:33) is unchanged.

### `src/gpx.ts`

- **`trkpt` (line 11):** inside the existing per-point `<extensions>`, add `<gpxtpx:cad>` (integer) and `<gpxtpx:atemp>` (rounded °C) to the `gpxtpx:TrackPointExtension` when cadence/weather are set; when power is enabled, append a second `<extensions><gpxpx:PowerExtension><gpxpx:Watts>N</gpxpx:Watts></gpxpx:PowerExtension></extensions>`. Extensions appear only when enabled; the existing `hr` behavior is unchanged.
- **Root `<gpx>` (line 18):** add `xmlns:gpxpx="http://www.garmin.com/xmlschemas/PowerExtension/v1"`.
- **`desc` (line 18):** keep the existing sentences; append conditionally "Power and cadence are estimates derived from the simulated timing and route grade, not device measurements." and "Weather is a simulated offline preset (33 °C, 55 % humidity, 0 kph headwind) applied to pace." Absent features append nothing, so their exports stay byte-identical.

### `src/map.ts`

- **`installLayers()` (line 74):** add a `route-grade` line layer above `route-line` on the same `route` source, with data-driven paint `line-color: ['interpolate',['linear'],['get','grade'],-0.08,'#2f6fb2',0,'#7d8b96',0.04,'#c07a2a',0.12,'#a8322e']`.
- **`render()` (line 82):** when the path carries elevations, set the `route` source data to a FeatureCollection of ≤ 400 graded segments (from `gradeSegments`) and hide `route-line` via `setLayoutProperty('route-line','visibility','none')`; when elevations are missing, restore the single-color line — plain-line fallback for elevation-less routes.
- **`drawFallback()` (line 118):** stroke each graded piece with `gradeColor` when elevations exist; the fallback already redraws on every state change, so this is contained.
- **Scrub marker:** new `scrub(p:Point|null)` beside `hover()` (line 114): a distinct persistent `scrub-marker` (MapLibre marker, or a ring in `drawFallback()` beside the `chart-map-marker` hover circle at line 124), preserved across re-renders until cleared. It never touches `hoverMarker`, plan markers, or the drawing flow.

## 7. UI/settings changes in `src/main.ts`

- **Settings markup (`public/index.html` line 21, after the GPS fields):** a "Power" group (`#power-enabled` checkbox, `#weight` number 30–200 kg), a "Cadence" group (`#cadence-enabled`, `#cadence-average`, `#cadence-variation`), a `#fatigue` numeric input (0–30) beside `#variation`, and a "Conditions" group (`#weather-preset` select defaulting to `ideal`, `#weather-temp` number, plus a static resolved-effect line such as "≈ +11 % duration"). Styles follow the existing `#hr-fields` fieldset in `public/app.css`. Helper text says "estimated power", "estimated cadence", "simulated offline weather"; the existing fine-print sentence stays.
- **Bindings (`src/main.ts`):** `change('power-enabled'|'weight'|'cadence-enabled'|'cadence-average'|'cadence-variation'|'fatigue'|'weather-preset'|'weather-temp', …)` beside `change('hr-…')` (main.ts:89), all routed through `updateSettings` (main.ts:31) so `validateSettings`, the guarded change handler and the debounced save run unchanged.
- **`render()` (main.ts:32):** reflect the new fields beside the existing `hr-*`/`gps-*` `setInput`/`mark` block (lines 47–49) and the resolved-weather effect line; `updateSettings` resets `cadence.average` to the sport default on run/ride switch, mirroring the activity-name suffix switch (main.ts:31).
- **Chart tabs (`public/index.html` line 29 + `main.ts:102`):** add `#chart-power` and `#chart-cadence` buttons; extend the loop at main.ts:102 to `['elevation','pace','hr','power','cadence']` for both the click wiring and the active-class toggling; empty-state copy names the enabling toggle.
- **Gradient legend + scrubber wiring:** a `.gradient-legend` element in the chart panel near `#chart-note` (visible only when elevation exists); the chart gains a scrub callback calling `map.scrub(p)` alongside the existing `hover` callback (main.ts:33); `Charts` owns the focusable host and Left/Right/Escape handling.
- Nothing here feeds `simulate()`: all new UI state (scrub pin, active tab, legend visibility, effect line) is presentation-only, so a scrubbed or tab-switched session simulates identically.

## 8. Golden-test impact

**Current state:** there is no pinned golden today; tests/core.test.mjs enforces behavior invariants only. This plan introduces one.

- **What is pinned:** `tests/golden/depth-seed-12345.json` — the full `JSON.stringify` of `simulate()` output for a fixed workspace: run + ride variants, natural mode, `fatigue:0.15`, power/cadence/HR enabled, weather `mild`, `seed:12345`. Loaded and `assert.deepEqual`ed by `tests/depth.test.mjs`, so any formula change that silently alters seeded exports fails CI.
- **The deliberate re-pin:** Milestone 3 (grade model) intentionally changes natural-mode timings — the smoothed 30 m grade and the asymmetric `×2.0/×1.1` term replace `grade*.7`. That shifts seeded split shapes (not totals) and therefore the pinned golden. This is the plan's only intentional breaking simulation change. The re-pin is a **deliberate, documented act**, never a side effect:
  1. Implement the grade model; run `npm test` and observe only the golden case fail.
  2. Regenerate with the explicit documented command `node scripts/regen-golden.mjs` (new script: rebuilds `dist/`, re-runs the fixed-workspace simulation, writes `tests/golden/depth-seed-12345.json`).
  3. Re-run `npm test` to green.
  4. Record the re-pin in `docs/VERIFICATION.md` with: the date, the seed, the formula change ("grade smoothing window 10 m → 30 m centered; uphill ×2.0 / downhill ×1.1 replacing grade×0.7"), the diff summary of what moved (split durations, not totals), and the regeneration command. Every future re-pin gets the same entry — this is what keeps "determinism per app version" honest.
- **What must never need a re-pin silently:** the weather penalty and power/cadence/HR-drift/fatigue formulas are pinned by the same golden; changing any of them requires the same regenerate-and-document step.

## 9. Test plan (new `tests/depth.test.mjs`, mirroring `tests/core.test.mjs` style)

1. **`power and cadence output is deterministic`** — `assert.deepEqual(simulate(a), simulate(a))` with `seed:12345`, power/cadence/HR enabled, natural mode; run and ride variants.
2. **`power anchors and grade response`** — run anchor ≈ 243 W @ 70 kg / 12 km/h flat, ride anchor ≈ 172 W @ 70 kg / 24 km/h flat (±5 %); uphill interval > flat > downhill at equal speed.
3. **`cadence stays in bounds and follows the wave`** — all samples within 30–230; constant mode yields exactly `average`; `variation:0` flattens it; off ⇒ no `gpxtpx:cad` in the export.
4. **`HR mean survives drift and heat`** — weighted mean within 0.6 bpm of `hrAverage` (existing invariant, `hot` weather on); drift still rises after 10 min; existing tests 'HR mean matches target…' and 'HR drifts upward…' stay green.
5. **`fatigue shapes pace inside the exact target duration`** — final split slower than first under `fatigue:0.2`; `s.duration` and all timestamps identical to `fatigue:0`; `deepEqual` repeatability with `seed:42424`.
6. **`weather penalty anchors`** — run `hot` factor exactly 1.1155 (1e-9); ride half-heat; `windy` adds 0.006·25; penalty capped at 2; ride < run for `hot`.
7. **`weather changes timing, not geometry`** — distance and route coordinates unchanged with weather on; coordinates equal a weatherless run except timestamps; `deepEqual` repeatability.
8. **`absent features leave simulate byte-identical`** — with `power`/`cadence`/`weather`/`fatigue` all absent, output `deepEqual`s the pre-change behavior for constant mode and (post-re-pin) the pinned natural-mode golden.
9. **`gradeSegments and gradeColor`** — constant-slope path ⇒ grade ≈ tan within tolerance; mirrored profiles (climb-first vs climb-last) give different split durations with equal totals; 400-segment cap respected; missing elevation ⇒ empty array and plain-line behavior.
10. **`GPX extensions and description are opt-in and honest`** — `<gpxpx:Watts>`, `<gpxtpx:cad>`, `<gpxtpx:atemp>` present only when enabled; desc sentences present when enabled; `creator="SimRun"` and the not-a-recording sentence always present; scrubbed export byte-identical to unscrubbed.
11. **`power/cadence/fatigue/weather settings validate and round-trip`** — reject weight 25/220 kg, cadence 20/250, fatigue −0.1/0.4, tempC 60, humidity 140, wind −1; accept and round-trip valid values through `validateActivity` (pattern of 'GPS and split settings validate and round-trip', tests/core.test.mjs:81).
12. **`scrubber state never affects simulation`** — Node-level guard that scrub state lives only in chart/map instances, plus the byte-identical export check.

**Browser additions (`tests/browser.py`, after the natural/HR block):** select "Hot", assert the duration stat grows vs "Ideal"; export and assert `atemp` + weather desc in the blob; toggle power and assert `<gpxpx:Watts>` in the blob; power/cadence chart tabs render; pointer-down/drag on `#chart` moves the map scrub marker and Escape clears it; arrow keys move the pin; fallback canvas shows ≥ 2 stroke colors on an elevated route and a single color without elevation; screenshots via the existing `screenshot()` helper (tests/browser.py:35).

## 10. Verification commands

```
npm test                            # build + typecheck + all Node suites incl. tests/depth.test.mjs and the golden
python tests/browser.py --isolated  # DOM-only acceptance incl. new weather/scrubber/shading checks (python3 if needed)
```

Supporting checks: `npm run typecheck` after each milestone; `grep -rn "fetch(" src/` must show no new call sites (weather presets are source constants); final export with every feature enabled opened in an external GPX reader to confirm `hr`/`cad`/`atemp`/`Watts` appear only when enabled and the desc names simulated timing, estimated power/cadence and offline weather.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Natural-mode timing shift breaks consumers of seeded output | The one deliberate change; golden re-pin with documented regeneration (§8) and a `docs/VERIFICATION.md` entry |
| Power formulas are first-order approximations | Every surface says "estimated"; GPX desc says "not device measurements"; anchors tested at ±5 % |
| HR drift interacts with the existing warm-up/walk term (model.ts:110–125) | The block already mean-centers; combined baseline stays mean-centered, so the HR-mean tests stay green by construction |
| Weather semantics misread as "same duration, different shape" | Resolved: duration scales; documented in README, the inspector helper text, and `docs/ACCEPTANCE.md`; effect line in the UI shows the percentage |
| Long-weather-penalty activities push past the 7-day cap | Existing duration validation error covers it; the penalty cap (2×) bounds it |
| Render cost on 100k-point imported routes | Shading capped at 400 segments; charts already sample ≤ 1000 rows (charts.ts:21) |
| MapLibre data-driven paint failure | Single-color `route-line` layer remains as a working fallback path |
| Sparse imported elevations | `gradeSegments` returns fewer/empty segments; nothing is interpolated into existence |

## 12. Ordered milestones (each with an explicit verification step)

1. **Settings foundation** — types (`Settings.power/cadence/fatigue/weather`, `Sample.power/cad`, `WEATHER_PRESETS`), `defaults()`, `validateSettings`, `validateActivity` cleaning, UI inputs.
   Verify: `npm test` green with existing suites untouched; new validation round-trip tests pass (mirror the GPS pattern).
2. **Weather presets (Feature 2)** — smallest end-to-end loop through the duration pipeline; `weatherPenalty` exported and unit-tested; desc + `atemp` export.
   Verify: exact penalty anchors in Node; absent weather leaves `simulate()` byte-identical for a fixed seed; browser test: "Hot" raises the duration stat vs "Ideal"; repeat export with the same seed is byte-identical.
3. **Grade model (Feature 3 part 1)** — 30 m centered smoothing + asymmetric term in the `simulate()` weights loop; re-pin the seed-12345 golden and record it in `docs/VERIFICATION.md`.
   Verify: mirrored-profile tests (climb-first vs climb-last give different split durations, totals exact); existing duration/HR invariants green; `deepEqual` repeatability.
4. **Power, cadence, HR drift, fatigue (Feature 1)** — consumes the smoothed grades; per-sample outputs; GPX `gpxpx:Watts`/`gpxtpx:cad`; chart tabs; UI groups.
   Verify: `assert.deepEqual(simulate(a), simulate(a))` with `seed:12345`; power anchors within ±5 %; cadence bounds; HR mean invariant green with heat on; fatigue changes split distribution while duration stays exact; golden pinned here.
5. **Gradient shading + scrubber (Feature 3 remainder)** — `gradeSegments`/`gradeColor`, `route-grade` layer + fallback strokes + legend, scrubber with marker/tooltip/keyboard/Escape.
   Verify: Node tests for `gradeSegments`/`gradeColor`; browser test: ≥ 2 stroke colors on an elevated route, single color without elevation, legend toggles, pointer drag moves the scrub marker, Escape clears, arrows move, scrubbed export byte-identical.
6. **Docs and honesty pass** — `README.md`, `docs/IMPLEMENTATION.md`, `docs/ACCEPTANCE.md` items 7 and 16, `docs/VERIFICATION.md` (golden re-pin record), final full test pass.
   Verify: `npm test` green including the golden; `python tests/browser.py --isolated` green; no new `fetch(` under `src/`; UI copy reads "estimated"/"simulated" throughout; GPX desc names simulated timing, estimated power/cadence and offline weather.

## Effort summary

Settings foundation 0.5 d · weather 1 d · grade model 0.5 d · power/cadence/HR drift/fatigue 1.5 d · shading 0.75 d · scrubber 0.75 d ≈ **5.5 dev-days**. The only deliberately breaking change is the natural-mode grade term, handled by the documented golden re-pin.

