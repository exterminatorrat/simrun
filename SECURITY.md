# Security Policy

SimRun is a static, client-side web app ([simrun.vercel.app](https://simrun.vercel.app)). It has no backend, accounts, database, analytics or secrets, so the attack surface is the browser code, its build output and the third-party services it calls.

## Supported versions

Only the latest commit on `main` and the matching production deployment receive fixes.

## Reporting a vulnerability

Please report privately and do not open a public issue.

1. Use GitHub's **[Report a vulnerability](https://github.com/exterminatorrat/simrun/security/advisories/new)** form (private security advisory).
2. Include the affected URL or commit, reproduction steps, impact, and a proof of concept if you have one.

You can expect an acknowledgement within a few days. Fixes are released on `main` and redeployed to Vercel, and reporters are credited unless they prefer otherwise. This is a personal project without a bounty program.

## Scope

In scope:

- Script injection or unsafe HTML handling in imports (GPX, KML, GeoJSON) and JSON backup restore
- Corruption or exfiltration of locally stored data (IndexedDB, localStorage, Cache Storage)
- Service worker cache poisoning or serving of unintended origins
- Leakage of coordinates or file contents beyond what [README.md](README.md#external-services-and-privacy) documents
- Secrets or tokens committed to the repository or build output

Out of scope:

- Availability, rate limits or terms of third-party providers (OpenFreeMap, FOSSGIS Valhalla, Nominatim)
- Vulnerabilities in dependencies with no demonstrated impact on SimRun
- Findings that require a compromised device or browser
- Denial of service through intentionally huge local files

## Data and privacy model

- Imported file contents are parsed locally and never uploaded.
- Map views, waypoint coordinates and elevation samples are sent to the configured routing/basemap providers. Routing imported waypoints asks for confirmation first.
- Nominatim search is off by default and only sends user-submitted queries.
- Data is origin-specific and stored in the browser; clearing site data removes it.

## Hardening notes for operators

- No secrets are required. Never commit `VERCEL_TOKEN`, `.vercel/` or `.env.local`; they are gitignored.
- MapLibre is served from `public/vendor/` (same-origin worker); runtime does not load scripts from third-party CDNs. `npm run vendor` refreshes it from a pinned version.
- Deployment Protection protects Vercel preview URLs; the production alias is public. See [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md).
- Hosted CORS/CSP behavior is not yet fully verified; see [docs/VERIFICATION.md](docs/VERIFICATION.md).
