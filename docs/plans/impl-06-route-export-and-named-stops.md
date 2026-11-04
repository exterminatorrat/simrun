# Implementation plan — route geometry export and named stops

File-and-function-level plan for two additive features on the current strict-TypeScript, dependency-free app:

1. **Route geometry export** in GeoJSON and CSV so the same route can be opened in QGIS, spreadsheets or other GIS tools.
2. **Named stops with notes** that carry distance, name and note into the cue-sheet CSV.

Import already covers GPX, KML and GeoJSON (`src/import.ts`); export covers GPX, TCX, FIT and ZIP of simulated activity files (`src/send.ts`) plus a cue-sheet CSV (`src/cues.ts`). Neither describes the planned route as plain geometry, and waypoints are anonymous `Point`s, so nothing a user types about a stop can reach the sheet.

## Decisions

- **Geometry source is `plannedPath(a)`**, the same function the cue sheet and simulation use. Loop plans and rotated starts therefore export the route the user actually sees, not the unrepeated base path.
- **GeoJSON follows RFC 7946**: WGS84 lon/lat, no `crs` member, six decimals, `elevation` only as a third ordinate and only when every vertex has one.
- **CSV is one row per route vertex**, not one row per cue. GIS and spreadsheet imports expect geometry rows; the cue sheet remains the turn-by-turn document.
- **Named stops are exported as GeoJSON `Point` features**, and the GeoJSON importer reads them back, so a route survives the round trip. GPX `<wpt>` and KML `Placemark/Point` import are deliberately out of scope; the GeoJSON path is the one this feature creates, so it is the one that must round-trip.
- **New exports are standalone downloads**, not new ZIP entries. `zipActivities` keeps meaning "simulated activity files" and its tests keep their semantics.
- **Named stops never replace turns.** A stop within 10 m of a turn folds its name and note into that turn's row; otherwise it becomes its own `Stop` row. Start and Finish rows are never renamed.
- **`Activity.version` stays 1.** `name`/`note` are optional fields on a widened `Waypoint` type; older saved activities validate unchanged.

## Architecture

```
Activity (editor state)
  └─ plannedPath(a) ──┬─ routeexport.ts ── GeoJSON / CSV download
                      └─ cues.ts ───────── cue-sheet CSV (turns + named stops)
Activity.waypoints: Waypoint[] ─┬─ editor.ts (edit / reorder / undo carry)
                                ├─ model.ts validateActivity (sanitize)
                                └─ routeexport.ts (Point features)
```

New and changed modules:

| File | Role |
| --- | --- |
| `src/csv.ts` (new) | `csvCell` / `csvRow`: the single RFC 4180 quoting implementation |
| `src/routeexport.ts` (new) | `routeGeoJSON`, `routeCSV`, `downloadRouteGeoJSON`, `downloadRouteCSV` |
| `src/types.ts` | `Waypoint extends Point {name?; note?}`; `Activity.waypoints: Waypoint[]`; `Cue` gains `kind`, `name`, `note` |
| `src/model.ts` | `validateActivity` sanitizes stop names and notes |
| `src/import.ts` | reads GeoJSON `Point` features into named waypoints |
| `src/editor.ts` | `setStop`, metadata-preserving `edit`/`move`/`installRoute` |
| `src/cues.ts` | merges named stops into the cue list and adds two columns |
| `src/main.ts`, `public/index.html`, `public/app.css` | stop fields in the waypoint list, two exports in the send dialog |
| `src/locales/en.ts` | new English strings |

No backend, storage migration, dependency or network behaviour changes: every export is generated locally from already-validated state.

## Data model

```ts
export interface Waypoint extends Point { name?: string; note?: string }
export type CueKind = 'start' | 'turn' | 'stop' | 'finish';
export interface Cue { distance:number; turn:string; heading:number; lat:number; lon:number; streetName?:string; kind:CueKind; name?:string; note?:string }
```

Validation trims both fields, strips C0 control characters, caps the name at 80 and the note at 500 characters, and drops empty strings so a blank input adds no field.

## Route GeoJSON shape

```json
{"type":"FeatureCollection","features":[
  {"type":"Feature","geometry":{"type":"LineString","coordinates":[[lon,lat,ele],…]},
   "properties":{"name":"…","description":"…","sport":"run","source":"routed","distance_m":12345.6,"simulated":true}},
  {"type":"Feature","geometry":{"type":"Point","coordinates":[lon,lat]},
   "properties":{"role":"stop","name":"Water fountain","note":"Refill bottles","distance_m":4321.0}}
]}
```

Waypoints without a name or note are not emitted as features: they are bend points, and the LineString already contains them.

## Route CSV shape

```
seq,latitude,longitude,elevation_m,distance_m
1,45.501700,-73.567300,42.00,0.0
```

CRLF line endings, comma separators, blank `elevation_m` when a vertex has no elevation.

## Cue-sheet columns

```
#,Distance (km),Elapsed,Turn,Name,Note,Heading (deg),Latitude,Longitude,Street name
```

Name and Note sit next to Turn so a printed sheet reads stop-then-instruction, and all quoting flows through `csvRow` so commas, quotes and newlines in a note stay valid CSV.

## Implementation sequence

1. `src/csv.ts` and `src/routeexport.ts`; point `src/cues.ts` at the shared CSV helpers. Verify: build, new export tests.
2. `Waypoint` type, validation, importer round trip. Verify: import/round-trip tests.
3. `Editor.setStop` plus metadata carry through edit, move, reorder, reverse, out-and-back, undo. Verify: editor tests.
4. Cue merging and the new columns. Verify: cue and browser-harness assertions.
5. Markup, styles and handlers for stop fields and the two downloads. Verify: build, lint, preview.

## Verification

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

## Known limitations

- GeoJSON `Point` features import as named stops, but GPX `<wpt>` and KML placemarks still import as geometry only.
- A waypoint on a loop plan is placed at its first occurrence along the planned path; later laps repeat the geometry without repeating the stop.
- Street names remain routing-provider data; cues for imported routes keep that column blank.
