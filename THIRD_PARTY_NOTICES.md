# Third-party software and data

SimRun is an independent implementation. It contains no SimuRun source, branding, illustrations or copied UI text.

- **MapLibre GL JS**, pinned runtime version 5.6.1, BSD-3-Clause. The default runtime fetches JS/CSS from unpkg. Optional `npm run vendor` also downloads the upstream LICENSE.txt into the archive. Source and license: https://github.com/maplibre/maplibre-gl-js/tree/v5.6.1 . Never strip upstream notices.
- **OpenFreeMap** map service: https://openfreemap.org/quick_start/ . Keep OpenFreeMap, OpenStreetMap and OpenMapTiles attribution in the map. Map tiles/data are fetched remotely, not bundled in this archive.
- **OpenStreetMap contributors**: https://www.openstreetmap.org/copyright . OSM data is available under ODbL. Rendering or routing against OSM does not remove attribution requirements.
- **OpenMapTiles** schema: https://openmaptiles.org/ . Attribution is retained.
- **Valhalla**, open-source routing engine, MIT: https://github.com/valhalla/valhalla . The personal-use demo server is operated by FOSSGIS; engine licensing is not a promise of free unlimited hosting. API references: https://valhalla.github.io/valhalla/api/route/api-reference/ and https://valhalla.github.io/valhalla/api/elevation/ . Demo terms: https://github.com/valhalla/valhalla/discussions/3373 . Recheck current operator guidance before any public rollout.
- **Nominatim** public service policy: https://operations.osmfoundation.org/policies/nominatim/ . Explicit opt-in, identification, deliberate low-volume queries, caching and appropriate attribution are required. OSM attribution applies to search results too. This is not a general-purpose autocomplete service.
- **TypeScript**, build-only 5.8.3, Apache-2.0: https://github.com/microsoft/TypeScript . npm installs its license with the locked compiler package; dependency directories are intentionally excluded from the source ZIP.
- **GPX 1.1** schema/reference: https://www.topografix.com/GPX/1/1/ . Optional HR uses `http://www.garmin.com/xmlschemas/TrackPointExtension/v1`. This is a standards-compatible namespace, not a claim that Garmin hardware recorded these simulations.

Interface icons and the SimRun mark in `public/favicon.svg` are original vector drawings for this implementation. Typography uses the operating system's fonts; no font binaries are included or distributed.
