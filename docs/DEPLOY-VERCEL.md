# Deploying SimRun to Vercel

SimRun is a static site. The build compiles TypeScript and copies `public/` into `dist/`, so Vercel must serve `dist/` and never the unbuilt `public/` sources.

## Linked project

| Item | Value |
| --- | --- |
| Vercel account | `exterminatorrat` |
| Scope | `warriorsvsrobloxs-projects` |
| Project | `simrun` |
| Production alias | https://simrun.vercel.app |
| Source of truth | https://github.com/exterminatorrat/simrun |

`vercel.json` pins the build: install `npm ci`, build `npm run build`, output `dist/`.

## Authentication

The CLI needs a Vercel token, and none is committed to this repository. Provide one per session:

```sh
export VERCEL_TOKEN=...   # create at https://vercel.com/account/tokens
```

`vercel login` also works interactively. `vercel link` writes `.vercel/` and `.env.local`; both stay gitignored and must not be committed.

## Commands

```sh
npx vercel@latest link --yes --project simrun --token "$VERCEL_TOKEN"
npx vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN"
npx vercel@latest curl https://simrun.vercel.app --token "$VERCEL_TOKEN"
```

A login-free `npx vercel@latest deploy --temporary` creates an anonymous deployment that expires in about an hour and can be claimed from its output link.

## Notes

- Deployment Protection (Vercel Authentication) is enabled. Preview URLs require authentication, but the production alias `https://simrun.vercel.app` is publicly reachable (verified with an anonymous request). Enable production protection in the Vercel dashboard before relying on the deployment to stay private.
- The app relies on public third-party services (OpenFreeMap, FOSSGIS Valhalla, opt-in Nominatim). Do not run this personal configuration as a high-volume public service.
- Keep the deployment private until the acceptance scenarios in `docs/ACCEPTANCE.md` pass in the target environment.

## Security policy and caching

The Content Security Policy keeps scripts, stylesheets, fonts, workers, and the service worker on the app origin, while allowing HTTPS connections and images because routing, elevation, geocoding, and map-style endpoints are configurable and may use different provider hosts. Enumerating default provider hosts would break user-configured HTTPS endpoints; the broad `https:` source is intentional and means those secure providers receive the requests described in the privacy page. MapLibre needs inline style attributes to position map controls, and its self-hosted CSP worker is allowed; `blob:` is also permitted for worker construction. Scripts remain restricted to the app origin.

The app currently serves fixed, un-fingerprinted filenames, including `app.css` and vendored MapLibre files, so no long-lived immutable cache rule is applied to them. The `/` and `/index.html` app shell and `/sw.js` use `Cache-Control: no-cache` so clients can revalidate updates. Add an immutable cache rule only if the build later emits content-hashed asset filenames.
