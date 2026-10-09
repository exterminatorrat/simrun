# Simulation depth — design & implementation plan

Cluster 02 covers three related upgrades to SimRun's simulation engine and its analysis surfaces:

1. **Power, cadence, HR drift and fatigue** — seeded, deterministic estimates surfaced in samples, GPX, and charts.
2. **Offline weather/temperature presets** that degrade pace, duration, and HR.
3. **Stronger grade modeling in natural mode**, gradient shading on the map, and an interactive elevation scrubber.

Everything below is grounded in the current code on branch `hoplite/lilaia-d62e62ed`. No code is implemented by this document.

## Cross-cutting decisions

- **Determinism.** Every new effect is a pure function of `(settings, route, seed)`. No new PRNG streams: cadence and HR drift reuse the seed-derived `phase`/wave signal (src/model.ts:89). If a new random stream were ever needed it must follow the `gpsRandom(seed ^ const)` pattern (src/model.ts:118) with a fresh XOR constant, as `applyGpsNoise` (0x9e3779b9) and `applyDropout` (0x85ebca6b) do.
- **Determinism is per app version.** Changing formulas changes outputs for the same seed. Each milestone that alters timing re-pins the golden test file and records the change in `docs/VERIFICATION.md`.
- **Honesty labeling.** Exports keep `creator="SimRun"` and the existing "not a recorded workout or device measurement" sentence (src/gpx.ts:18); each feature extends that `desc` rather than replacing it, and UI copy says "estimated"/"simulated".
- **Storage compatibility.** All new `Settings` fields are optional; absent means the feature is off. Old activities and JSON backups load unchanged and `Activity.version` stays `1`. `validateActivity` keeps its explicit field-selection pattern (src/model.ts:61) — new settings are cleaned the same way `gps` is today.
- **Sample size caps unchanged.** The ~40,000-interval / ~50,000-sample bounds in `simulate()` are not touched by any feature.

---

# Feature 1 — Power, cadence, HR drift, and fatigue

## Goals

- Per-sample **running power (W)** and **cycling watts**, derived from simulated speed and smoothed grade.
- Per-sample **cadence** (run spm, ride rpm) driven by the same seed signal as pace.
- **HR drift over duration**, deepened by heat, without breaking the HR-average contract.
- An optional **fatigue** term that fades pace toward the finish inside the exact target duration.
- Surface all of it in samples, GPX extensions, and the chart panel.

## Non-goals

- No FTP/zone/threshold modeling, no training load, no TSS.
- No ingestion of real sensor data and no per-device calibration profiles.
- Power is derived only; it never feeds back into timing (no "target watts" mode).
- No new PRNG streams: any apparent randomness comes from the existing seeded wave.

## Design

### Data model additions (src/types.ts)

```ts
export interface PowerSim { enabled:boolean; weightKg:number }
export interface CadenceSim { enabled:boolean; average:number; variation:number }
export interface Settings {
  // ...existing fields...
  power?:PowerSim;      // absent = no power estimate
  cadence?:CadenceSim;  // absent = no cadence estimate
  fatigue?:number;      // 0..0.3, absent = 0
}
export interface Sample extends Point { time:number; distance:number; speed:number; power?:number; cad?:number }
```

`Simulation`, `Split`, and `ElevationStats` are unchanged. Like `hr`, power/cadence are simulation outputs on `Sample`, never route data. `computeSplits` (src/model.ts:160) is untouched — power is not a split metric in this cluster.

### Algorithms (all deterministic, no new seed consumption)

- **Cycling watts**, per sample: `m = weightKg + 10`, `g = 9.81`, `ρ = 1.226`, `Crr = 0.005`, `CdA = 0.40`, `v` = sample speed (m/s), `grade` = smoothed grade at the sample distance (Feature 3):
  `P = v·(m·g·(Crr + max(grade, −0.06))) + 0.5·ρ·CdA·v³`, clamped 0–2500 W, rounded.
  Anchor: 70 kg rider at 24 km/h flat ⇒ m = 80, P ≈ 26 + 146 ≈ 172 W.
- **Running power**, per sample: `cost = clamp(1.04 + 9.81·grade·(grade ≥ 0 ? 1 : 0.35), 0.6, 3.0)` J/kg/m; `P = round(weightKg · v · cost)`, clamped 0–1500 W.
  Anchor: 70 kg at 5:00/km (3 m/s) flat ⇒ ≈ 218 W; at +5 % grade ⇒ ≈ 320 W.
- **Cadence**: `cad = round(average · (1 + variation/100 · wave(d)))` where `wave(d)` is the existing natural-mode wave (`.62·sin(d/430+phase) + .27·sin(d/180+phase·.7) + .11·sin(d/70)`, src/model.ts:90) evaluated at the sample distance. In constant mode `wave` contributes 0, so cadence is flat at the average. Defaults: 172 spm run, 88 rpm ride (switched with sport like pace/speed); ranges: `average` 30–230, `variation` 0–30 (percent).
- **HR drift**: extend the HR baseline (src/model.ts:109–113) with `+ min(10, durationMin·0.07) · (t/T)^1.5 · heatSlope`, where `heatSlope = 1 + 0.6·max(0, tempC − 12)/20` (Feature 2; exactly 1 with weather off). The block already mean-centers the baseline, so the time-mean stays at `hrAverage` and only the shape changes — the existing tests 'HR mean approximately matches target' and 'changes smoothly' (tests/core.test.mjs) keep passing by design.
- **Fatigue**: new optional `settings.fatigue` (0–0.3, default 0, UI as 0–30 %). Applied to the timing weights after the existing clamp (src/model.ts:94): `w ← w · (1 + fatigue·(i/n)²)` for interval `i` of `n`. Because `simulate()` renormalizes weights to the exact target duration (model.ts:98), fatigue reshapes pace (final splits slower) while total duration stays exact — the same contract as natural-mode variation today.

### Determinism and the seed

Power and cadence are pure functions of already-deterministic speed/grade/wave values; HR drift and fatigue are closed-form functions of `(t, duration, weather)`. No new entropy and no new PRNG stream, so with a fixed `Settings.seed` the whole simulation remains `deepEqual`-reproducible, and the existing GPS noise/dropout streams are untouched bit-for-bit.

### UI/workflow

- Inspector, after the HR fieldset: a "Power" group (`#power-enabled` checkbox, `#weight` number 30–200 kg) and a "Cadence" group (`#cadence-enabled`, `#cadence-average`, `#cadence-variation`), plus a `#fatigue` numeric input (0–30) beside `#variation`. Styling follows the existing `#hr-fields` fieldset and `public/app.css` conventions.
- Chart tabs gain `#chart-power` and `#chart-cadence`; `ChartMode` (src/charts.ts:4) becomes `'elevation'|'pace'|'hr'|'power'|'cadence'`; rows read `p.power`/`p.cad`; empty states reuse the existing `chart-empty` pattern (src/charts.ts:15) with copy like "Enable estimated power in Activity settings."
- On sport switch, `updateSettings` (src/main.ts:31) resets `cadence.average` to the sport default, mirroring how the name suffix already switches.

### Exports (src/gpx.ts)

- `trkpt` (src/gpx.ts:11) emits, inside the existing per-point `<extensions>` block and only when enabled:
  `<gpxtpx:cad>` inside `TrackPointExtension`, and a `<gpxpx:PowerExtension><gpxpx:Watts>…</gpxpx:Watts></gpxpx:PowerExtension>` block with `xmlns:gpxpx="http://www.garmin.com/xmlschemas/PowerExtension/v1"` added to the root `<gpx>` (src/gpx.ts:18).
- `desc` (src/gpx.ts:17–18) gains: "Power and cadence are estimates derived from the simulated timing and route grade, not device measurements." The existing "not a recorded workout or device measurement." sentence stays.

### Files and functions to touch

- **src/types.ts** — `Settings.power/cadence/fatigue`, `Sample.power/cad`.
- **src/model.ts** — `defaults()` (line 11: add `power:{enabled:false,weightKg:70}`, `cadence:{enabled:false,average:172,variation:5}`, `fatigue:0`); `validateSettings()` (line 37: weightKg 30–200, cadence.average 30–230, cadence.variation 0–30, fatigue 0–0.3, boolean checks like `hrEnabled`); `validateActivity` clean-settings return (line 61: explicitly select the new fields, exactly like `gps`); `simulate()` (line 81: per-sample power/cadence after the sample loop using the stored interval grades; drift term in the HR block; fatigue multiplier in the weight loop).
- **src/gpx.ts** — `exportGPX` `trkpt` builder (line 11) and root element (line 18).
- **src/charts.ts** — `ChartMode` (line 4), `render()` row building (lines 10–13), `format()` (line 26).
- **src/main.ts** — `change()` bindings beside `change('hr-enabled',…)` (line 89); chart-mode list (line 103).
- **public/index.html** — fieldsets after `#gps-dropout`; chart tabs after `#chart-hr`. **public/app.css** — styles matching existing fieldsets.

### Milestones (each with verification)

1. **Settings foundation** — types, defaults, validation, UI inputs.
   Verify: `npm test` green with existing suites untouched; new validation round-trip tests pass (mirror the GPS test pattern in tests/core.test.mjs).
2. **Compute + export.** Verify: golden determinism (`assert.deepEqual(simulate(a), simulate(a))` with saved seed 12345); running-power anchors within ±5 %; GPX contains `Watts`/`cad` only when enabled; HR mean invariant test still green.
3. **Charts + UI.** Verify: `python tests/browser.py --isolated` with new checks (toggle power, export blob contains `<gpxpx:Watts>`; power chart renders; fatigue input changes split distribution).

### Testing strategy — new tests/depth.test.mjs

- `power is a deterministic pure function of speed and grade` — run/ride anchors; two `simulate()` calls deepEqual with seed 12345.
- `running power responds to grade` — uphill interval > flat > downhill at equal speed.
- `cadence stays in bounds and follows variation` — bounds, constant-mode flatness, off ⇒ no `gpxtpx:cad` in export.
- `HR drift reshapes without changing the mean` — mean within 0.6 bpm of `hrAverage`, monotone rise late in a long activity.
- `fatigue shapes pace inside the exact target duration` — final split slower than first, total duration unchanged, `deepEqual` repeatability with seed 42424.
- `power and cadence settings validate and round-trip` — reject weight 25/220 kg, cadence 20/250, fatigue −0.1/0.4; accept and round-trip valid values (pattern of 'GPS and split settings validate and round-trip').
- **Golden repeatability (critical):** `tests/golden/depth-seed-12345.json` pins the full `simulate()` JSON output (run+ride, natural, fatigue 0.15, power/cadence/HR on, weather `mild`, seed 12345). Regeneration is the explicit documented step `node scripts/regen-golden.mjs` so formula changes can never silently alter seeded exports.

### Risks and limitations

- Power formulas are first-order approximations; every surface labels them "estimated", and the GPX desc says "not device measurements".
- Pinned goldens intentionally break when formulas change; regeneration is a documented, deliberate step, and `docs/VERIFICATION.md` logs each re-pin.
- HR drift interacts with the existing warmup term (model.ts:110); the combined baseline stays mean-centered, keeping existing HR tests green.

**Effort:** ≈ 1.5 dev-days.

---

# Feature 2 — Offline weather/temperature presets

## Goals

- Fixed **offline presets** (constant temperature, humidity, headwind) that deterministically degrade pace and lengthen the activity, with no network access of any kind.
- Effect visible in the headline duration, splits, pace chart, and the GPX description; `gpxtpx:atemp` carries the preset temperature.

## Non-goals

- No live weather APIs, no geolocation, no network calls of any kind (the constraint is explicit in the product brief).
- No wind-direction geometry (no per-segment bearing vs wind), no precipitation, no pressure/air-density modeling, no route-position-dependent microclimates.
- No per-interval gusts: weather adds **zero entropy**, so the seed contract stays trivially intact.

## Design

### Data model (src/types.ts)

```ts
export type WeatherPreset = 'ideal'|'cool'|'mild'|'warm'|'hot'|'humid'|'windy';
export interface WeatherSim { preset:WeatherPreset; tempC:number; humidity:number; headwindKph:number }
export const WEATHER_PRESETS:Record<WeatherPreset,Omit<WeatherSim,'preset'>> = {
  ideal:{tempC:12,humidity:40,headwindKph:0}, cool:{tempC:5,humidity:60,headwindKph:0},
  mild:{tempC:18,humidity:45,headwindKph:0}, warm:{tempC:26,humidity:45,headwindKph:0},
  hot:{tempC:33,humidity:55,headwindKph:0}, humid:{tempC:24,humidity:85,headwindKph:0},
  windy:{tempC:15,humidity:50,headwindKph:25},
};
// Settings gains: weather?:WeatherSim
```

Absent `weather` ⇒ neutral (factor 1, no `atemp`, no desc change). The UI select applies a preset's fixed humidity/headwind and a temperature number input (−30…50) overrides the preset temperature; the stored setting is always one resolved `WeatherSim` object.

### Algorithm — one deterministic scalar

- Heat (run): `1 + 0.0055·max(0, tempC − 12) + 0.002·max(0, humidity − 60)`; rides use half of both coefficients.
- Cold (run only): `1 + 0.0025·max(0, 5 − tempC)`.
- Headwind: run `1 + 0.006·headwindKph`; ride `1 + 0.5·headwindKph / max(5, speed)` with the configured target speed (km/h).
- `penalty = clamp(heat · cold · wind, 1, 2)`.

`simulate()` (src/model.ts:84) computes `duration = durationFor(total, sport, pace, speed) · penalty` before the existing duration validation, so every downstream consumer (splits, duration input, charts, GPX) inherits the slowdown through the existing normalization path — the same pipeline natural-mode variation already flows through. Anchor: hot preset (33 °C, 55 %) ⇒ run factor `1 + 0.0055·21 = 1.1155` → 25 min ≈ 27.9 min.

**Semantic decision (explicit):** weather scales the resulting duration rather than redistributing time inside a fixed duration. The configured pace/speed is the athlete's neutral-condition target; heat, humidity, and headwind honestly lengthen the activity. The shape-only alternative was rejected because its effect would be invisible in the duration the app advertises and exports.

**HR coupling:** the Feature 1 drift term deepens via `heatSlope(tempC)`; no other HR change.

### UI/workflow

- "Conditions" fieldset after the GPS section: `#weather-preset` select (default `ideal`) and `#weather-temp` number input, plus a static resolved-effect line ("≈ +11 % duration"). Duration and pace/speed displays update through the existing `render()` path; the duration input derives from `sim.duration` as it already does (src/main.ts:88).

### Export honesty (src/gpx.ts)

- `desc` gains: "Weather is a simulated offline preset (33 °C, 55 % humidity, 0 kph headwind) applied to pace."
- `trkpt` gains `<gpxtpx:atemp>` (rounded °C) inside TrackPointExtension when weather is set — `atemp` is part of the TrackPointExtension v1 schema the export already references.

### Files and functions to touch

- src/types.ts — `WeatherSim`, `WEATHER_PRESETS`, `Settings.weather?`.
- src/model.ts — `validateSettings` (tempC −30…50, humidity 0–100, headwindKph 0–80); `validateActivity` clean block; `simulate()` duration line.
- src/gpx.ts — `exportGPX` desc (line 17–18) and `trkpt` atemp (line 11).
- src/main.ts — `change('weather-preset'|'weather-temp', …)` beside `change('gps-noise',…)` (line 96–97).
- public/index.html — fieldset after the GPS block; public/app.css — minor styling.

### Milestones (each with verification)

1. **Model + validation.** Verify: Node tests — exact penalty anchors (run `hot` = 1.1155; ride half-heat), validation rejects tempC 60 / humidity 140 / wind −1, absent weather leaves `simulate()` byte-identical to today's output for a fixed seed (existing tests untouched and green).
2. **UI + export.** Verify: browser test selects "Hot" and asserts the duration statistic rises vs "Ideal"; exported blob contains `atemp` and the simulated-weather desc sentence; repeat export with the same seed is byte-identical.

### Testing strategy (tests/depth.test.mjs)

- `weather presets are pure offline data` — pin the preset table (guards against accidental network/derived values).
- `weather penalty scales duration deterministically` — ratio hot/ideal matches the closed form within 1e-9; `deepEqual` repeatability with saved seed 42424.
- `weather changes timing, not geometry` — distance and route coordinates unchanged; existing GPS-noise distance invariant still passes with weather on.
- `ride weather is gentler than run weather` — same preset, ride penalty < run penalty for `hot`.
- `GPX describes simulated weather and carries atemp` — desc + extension assertions, absent when weather is unset.
- `HR mean survives heat drift` — existing HR mean invariant under `hot`.
- browser.py additions: after the existing natural/HR block (tests/browser.py:66), select the hot preset, assert the duration stat text grows, export and assert `atemp` + desc.

### Risks and limitations

- **Semantics must be communicated**: the target pace is neutral-condition; heat lengthens the result. Documented in README, the inspector helper text, and ACCEPTANCE.
- Wind is a uniform headwind with no route-direction awareness — stated limitation, keeps the model deterministic and simple.
- Weather does not alter power estimates (watts follow speed/grade only); the desc wording keeps that honest.
- Long-weather-penalty activities could push duration past the 7-day validation cap; the existing error message covers it.

**Effort:** ≈ 1 dev-day.

---

# Feature 3 — Grade modeling, gradient shading, elevation scrubber

## Goals

- Natural-mode grade response that is **smoothed** (30 m window instead of raw ±10 m differences) and **asymmetric** (uphill costs more than downhill helps).
- **Gradient shading** of the route line on MapLibre and on the coordinate-canvas fallback, with a legend.
- An **interactive elevation scrubber**: press/drag on the elevation chart pins a marker on the map with distance, elevation, grade, and simulated pace.

## Non-goals

- No new elevation sources; everything derives from elevations already on `Activity.path`.
- No shading of the dashed draft line (drafts have no elevation), no separate "grade" chart mode.
- No changes to `elevationStats` or its deadband (src/geometry.ts).

## Design

### 1. Grade model (src/model.ts, `simulate()` weights loop, lines 88–96)

- **Smoothing:** the current code computes grade from a single ~10 m interval (`(q.ele − p.ele)/ds`, clamped ±0.15). Replace with a centered window: `grade = (ele(d+15) − ele(d−15)) / 30` via two `atDistance(route, c, ·)` calls, clamped ±0.15; missing elevation ⇒ 0 as today. The interval count and memory caps (model.ts:87) are unchanged.
- **Asymmetry:** replace `grade*.7` (model.ts:94) with `gradeTerm = grade ≥ 0 ? grade·2.0 : grade·1.1` — a 10 % climb costs +20 % time while a 10 % descent saves ~11 %, a single linear term that stays inside the existing clamp `(0.65, 1.4)` and the exact-duration normalization.
- The per-interval smoothed grades are stored once and reused by power (Feature 1) and by the shading helper below — one grade implementation, three consumers.

### 2. Gradient shading (src/map.ts + src/geometry.ts)

```ts
// geometry.ts — pure and Node-testable, beside elevationStats
export function gradeSegments(path:Point[], maxSegments?:number):{a:Point;b:Point;grade:number}[];
export function gradeColor(grade:number):string;
// stops: −0.08 '#2f6fb2' · 0 '#7d8b96' · +0.04 '#c07a2a' · +0.12 '#a8322e'
```

- **MapLibre:** `installLayers()` (src/map.ts:74) adds a `route-grade` line layer fed from the same `route` GeoJSON source; `render()` (src/map.ts:82) switches its data from a single LineString to a MultiLineString of ≤ 400 graded segments, with data-driven paint `line-color: ['interpolate',['linear'],['get','grade'],-0.08,'#2f6fb2',0,'#7d8b96',0.04,'#c07a2a',0.12,'#a8322e']`. The single-color `route-line` layer is hidden via `setLayoutProperty(… 'visibility','none')` when the path carries elevation and restored when it does not, so elevation-less routes keep today's plain accent line.
- **SVG fallback:** `drawFallback()` strokes each `gradeSegments` piece with `gradeColor` — the fallback already redraws on every state change, so this is contained.
- **Legend:** a `.gradient-legend` element in the chart panel (public/index.html near `#chart-note`, styles in public/app.css), visible only when elevation exists; hidden with the route-color path otherwise.

### 3. Elevation scrubber (src/charts.ts + src/map.ts + src/main.ts)

- Charts already map pointer position → nearest row → `hover(p)` (src/charts.ts:27–32). Add: `pointerdown` starts a scrub with `setPointerCapture`; moves update it; release **keeps** the pin (stickiness is what distinguishes a scrubber from the existing transient hover). Escape, or clicking the chart's empty area, clears it.
- Tooltip (charts.ts:29–30) gains the local grade — elevation difference over ±15 m of planned-path distance at the hovered point — rendered as `▲ +4.2 %`, and pace readouts gain a "(simulated)" suffix.
- `RouteMap` gains `scrub(p:Point|null)` beside `hover()` (src/map.ts:114): a distinct `scrub-marker` (MapLibre marker, or a ring drawn in `drawFallback()`), preserved across route re-renders until cleared. It does not touch `hoverMarker` or the drawing flow.
- Keyboard: the chart host becomes focusable; Left/Right move the scrub one data row; Escape clears. This serves the existing "all controls reachable by keyboard" acceptance expectation (docs/ACCEPTANCE.md item 14).

### Determinism

Only the simulator-facing grade term changes timing, and it consumes no randomness: same seed ⇒ same output, verified by the pinned golden. Shading and the scrubber are presentation-only; a test asserts scrub state never leaks into `simulate()` output.

### Milestones (each with verification)

1. **Grade model.** Add the smoothed/asymmetric grade in `simulate()`; re-pin the seed-12345 golden (documented regeneration).
   Verify: new tests — mirrored elevation profiles (climb-first vs climb-last) yield different split durations while total duration stays exact; existing duration/HR invariants green.
2. **`gradeSegments`/`gradeColor`.** Verify: Node tests on synthetic ramps (grade ≈ slope), missing-elevation ⇒ gradeless route, color-stop boundaries.
3. **Shading + legend.** Verify: browser test — fallback canvas shows ≥ 2 distinct stroke colors on an elevated route; a single-color line returns when elevation is absent; legend toggles.
4. **Scrubber.** Verify: Playwright pointer-down/drag moves the scrub marker and Escape clears it; arrow keys move it; a scrubbed export is byte-identical to an unscrubbed one.

### Testing strategy (tests/depth.test.mjs)

- `gradeSegments measures smoothed grades on synthetic ramps` — constant-slope path ⇒ grade within tolerance of the exact tan; 400-segment cap respected.
- `routes without elevation shade as a single color and simulate unchanged` — `gradeSegments` returns empty and the map keeps the plain line.
- `uphill costs more than downhill saves` — mirrored profiles give asymmetric split durations; net-flat route unchanged vs a tolerance.
- `natural mode stays duration-exact under the new grade term` — mirrors 'smooth natural simulation normalizes exact duration…' (tests/core.test.mjs).
- `scrubbing never affects simulation output` — Playwright check plus a node-level guard that scrub state lives only in chart/map instances.
- browser.py additions: stroke-color count check; scrub drag (Playwright mouse.down/move/up on `#chart`); Escape clears; screenshots via the existing `screenshot()` helper (tests/browser.py:35).

### Risks and limitations

- 100k-point imported routes: shading is capped at 400 graded segments per render; charts already sample ≤ 1000 rows (charts.ts:21), and the same philosophy applies here.
- MapLibre data-driven `line-color` on a MultiLineString is standard; if a future style breaks it, the single-color layer remains as a working fallback path.
- Sparse imported elevations (few `ele` values) degrade to fewer graded segments; nothing is interpolated into existence — missing stays missing.
- The grade rework shifts natural-mode timings slightly; that is the one deliberate behavior change, covered by the re-pinned golden and recorded in docs/VERIFICATION.md.

**Effort:** ≈ 2 dev-days (grade 0.5, shading 0.75, scrubber 0.75).

---

# Implementation order and overall verification

**Order:**

1. Settings foundation (all three features' types, defaults, validation, UI inputs) — verify: full suite + new validation tests.
2. Weather presets (Feature 2) — smallest end-to-end loop through the duration pipeline.
3. Grade model (Feature 3 part 1) — must precede power, which consumes the smoothed grades.
4. Power, cadence, HR drift, fatigue (Feature 1) — consumes grades; goldens pinned here.
5. Shading + scrubber (Feature 3 remainder) — consumes `gradeSegments`.
6. Docs and honesty pass — README, docs/IMPLEMENTATION.md, docs/ACCEPTANCE.md (extend items 7 and 16), docs/VERIFICATION.md; final full test pass.

**Final gate:**

- `npm test` green (build + Node suites, including tests/depth.test.mjs and the seed-12345 golden).
- `python tests/browser.py --isolated` green with the new checks.
- Export with every feature enabled; open the GPX in an external reader; confirm the desc names simulated timing, estimated power/cadence, and offline weather, and that `hr`/`cad`/`atemp`/`Watts` appear only when enabled.
- `tests/offline.test.mjs` still green; no new network path introduced (weather is a source constant; verify no new `fetch(` under src/).
- README + docs updated; UI copy reads "estimated"/"simulated" throughout.

# Honesty labeling across the cluster

- Every export keeps `creator="SimRun"` and the "not a recorded workout or device measurement" desc; new sentences name power/cadence as estimates and weather as offline simulated presets.
- GPX extensions are opt-in and schema-standard: `gpxtpx:hr` (existing), `gpxtpx:cad`, `gpxtpx:atemp`, `gpxpx:Watts`.
- UI copy: "estimated power", "estimated cadence", "simulated weather"; chart empty states name the enabling toggle; the cue sheet and its simulated-activity labeling are untouched.

# Risk and effort summary

| Feature | Effort | Main risk |
|---|---|---|
| Settings foundation | 0.5 d | Validation matrix breadth |
| Weather presets | 1 d | Communicating the duration-scaling semantics |
| Grade + shading + scrubber | 2 d | Render cost on huge routes (bounded by the 400-segment cap) |
| Power/cadence/HR drift/fatigue | 1.5 d | Golden re-pins; formula defensibility (labeled estimates) |

Total ≈ 5.5 dev-days. The only deliberately breaking change is the natural-mode grade term, handled by re-pinning the seed-12345 golden with a documented regeneration step.
