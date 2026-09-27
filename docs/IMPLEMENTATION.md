# Implementation decisions

The supplied product brief requests a map-primary, local-first running/cycling route simulator, no cloud services for user data, free/open replaceable providers, complete GPX round trips and an autonomous portable handoff. The repository began empty.

## Design

Full-height map canvas, compact top bar, left route toolbar, right activity inspector and bottom profile panel. Light neutral surfaces with one orange route accent, original vector icons, system fonts, thin borders and small shadows. Mobile uses an inspector sheet. The visual reference informed only product workflow; no proprietary source/assets/text were copied.

## Architecture and sequence

1. Pure typed geometry, time conversion, seeded simulation and GPX serialization, exercised by Node tests.
2. Normalized provider contract with cancellation, queue/rate limits, profile correctness, elevation missingness and deliberate geocoder opt-in.
3. Versioned local storage and explicit nonpersistent fallback; route snapshots independent of activity settings.
4. Map integration, coordinate-only failure path, modular DOM editor and SVG profiles.
5. Browser acceptance harness, layout inspection, fault tests, portable documentation and source archive validation.

Native TypeScript/DOM was chosen because no Sites scaffold was exposed and React/Vite/MapLibre npm packages could not be retrieved in this network-restricted workspace. This is an explicit change from the brief's preferred React stack, not a claim that React is unsupported by Sites. MapLibre remains the intended actual map renderer. A pinned remote bundle plus optional vendoring is isolated in the map adapter.

All network fixtures live in test code only. Draft/failed waypoint geometry is not promoted to a successful road route. Exported activities always identify synthetic timing. Community map providers are not treated as unlimited free infrastructure.

See README and the agent handoff for current limitations and deployment instructions.
