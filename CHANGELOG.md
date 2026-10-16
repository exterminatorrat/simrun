# Changelog

All notable changes to SimRun are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Route editing: trim, split, merge and freehand drawing, all undoable.
- Routing intelligence: target-distance round trips, surface and road-type data, street names in cue sheets and opt-in water and toilet points of interest.
- Simulation: pace strategies, grade-adjusted pace, TRIMP, walk, hike, trail run and mountain-bike sports, activity descriptions, batch generation and worker-backed simulation for large routes.
- Send and library: Web Share, save to folder, ZIP export, per-platform import guidance, collections, bulk actions and a full-library ZIP.
- Maps and offline: Photon suggestions, locate-me, topo, cycling and hiking layers, saved places with offline search and an offline corridor manager.
- Guidance: first-run tip, keyboard-shortcut help, draft and storage status, grouped settings and touch editing improvements.
- Firefox and WebKit coverage in the browser harness and CI, a `--browser` option, PWA icons and phone layout regression checks.
- Pull-request verification and built-in Node test coverage output.
- Weekly grouped dependency updates and lint/EditorConfig tooling.
- Static security headers, a local-first privacy page, and release policy guidance.

### Fixed

- Share now opens for real routes; the QR encoder supports versions 1 to 40 with an error-correction fallback.
- Offline corridor downloads fetch the vector tiles of the default basemap by resolving TileJSON sources.
- Phone layout on touch devices: all top actions reachable, attribution toggle uncovered, empty state clear of the toolbar.
- Settings and inspector layout issues, the missing Share icon, a distinct Send icon, a language selector instead of a free-text field, and an explicit no-weather option.
- Overpass points-of-interest queries use one corridor linestring with exact tag filters.
- Routes with more than ten waypoints route again: the app chains requests that each stay inside the public Valhalla service's ten-location limit and joins the returned path.

## [0.1.0]

### Added

- Initial local-first route editor and explicitly simulated activity studio.
