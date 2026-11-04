# 06 — Polish close-out

Closes the polish items left open after the collapsible-panel work in #38.
Four items were on the list; WP4 is owner-only and cannot be closed in code.

## WP1 — Right-to-left panel layout

**Problem.** `#map,.maplibregl-control-container,.search-wrap,.map-tools,.zoom-tools{direction:ltr}`
(`public/app.css`) forces those boxes to resolve their own `inset-inline-*` against LTR.
In `ar-XB` the rail therefore lands at the inline-start *left* edge, underneath the
inspector, which mirrors to the left; measured at 1440×900 the rail sits at x 0–48 and
the inspector at x 0–340, so every rail button is covered (`#draw` hit-tests to
`activity-name`). `#map` keeps LTR insets too, so it spans 48–1100 and leaves dead
space between 1100 and the rail.

**Change.** Remove `.search-wrap`, `.map-tools` and `.zoom-tools` from that rule: they
are icon-only or direction-neutral, and inheriting the document direction lets their
logical insets mirror correctly. Keep `#map` and `.maplibregl-control-container` on
LTR, because the coordinate-canvas labels and map text must not reverse, and give
`#map` a direction-aware physical inset so it still fills between panel and rail.

**Verify.** In `ar-XB` at 1440×900 and 390×844: rail and inspector do not overlap, the
rail's buttons hit-test to themselves, the map has no dead strip, and no horizontal
overflow. Assertions are added to `tests/a11y.py` so this cannot regress.

## WP2 — Persist the layout choice

**Problem.** Panel and chart collapse is per-session; reloading restores every panel.

**Change.** Add four booleans to `Preferences` (`collapseTools`, `collapseInspector`,
`collapseTopbar`, `collapseChart`), default `false` in `model.ts`, validated with the
existing `===true` pattern in `storage.ts`. `main.ts` applies them at startup, writes
them when a toggle is used, and re-applies them after either backup restore path.
Existing backups stay valid because the new fields are optional booleans.

**Verify.** Node test asserting the validator's behaviour for missing, `true` and
junk values; browser check that each toggle survives a reload, and that a backup
restore re-applies the stored layout.

## WP3 — Screen-reader-facing state on the new controls

**Problem.** The six new buttons carry an accessible name but no relationship to the
region they show or hide, so a screen reader cannot report collapsed state.

**Change.** Give the tool rail and header ids, and set `aria-controls` plus
`aria-expanded` on each collapse control and its restore tab, kept truthful by the
same function that applies the classes.

**Verify.** `tests/a11y.py` asserts `aria-controls` resolves to an element, that only
one of each pair is visible, and that the reported state flips with the panel.
A real NVDA or VoiceOver session is still out of scope here (WP4).

## WP4 — Owner-only verification (not closable in code)

Unchanged from `docs/VERIFICATION.md`: a real screen-reader pass, deployed CSP and
CORS behaviour, Web Share on real devices, Lighthouse, and imports into real Strava,
Garmin Connect and COROS accounts. These need accounts and hardware, not patches.

## Sequencing

WP1 and WP2, then WP3, then one verification run: `npm test`, `npm run lint`,
`tests/browser.py`, `tests/a11y.py`.
