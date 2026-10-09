# Self-hosting Valhalla

The default routing and elevation provider is FOSSGIS's public Valhalla demo
(`https://valhalla1.openstreetmap.de`). It is shared infrastructure with fixed
`service_limits`, so long routes fail on the server, not in the app:

| Costing (sport) | Server limit | Response |
| --- | --- | --- |
| `pedestrian` (Run) | 100 km | `HTTP 400`, `error_code 154`, "Path distance exceeds the max distance limit: 100000 meters" |
| `bicycle` (Ride) | 150 km | same, `150000 meters` |

The limit applies to the whole requested route, not to each leg: a 92 km
pedestrian route split across waypoints succeeds while a 123 km one fails.
The request-level `costing_options.max_distance` does **not** override it —
the server's `service_limits` wins. Automobile costing is not capped this way,
but the app never requests it.

Self-hosting removes the distance cap. No application code changes are needed:
the routing and elevation URLs are editable in **Settings → Open service
endpoints**.

## 1. Run Valhalla

Build tiles for a regional OSM extract, then serve the service. The published
image mounts a `custom_files` directory and listens on `8002`:

```sh
docker run -dt --name valhalla -p 8002:8002 \
  -v "$PWD/custom_files:/custom_files" \
  ghcr.io/valhalla/valhalla:latest
```

Place a `.osm.pbf` extract in `custom_files/`; the image builds tiles on first
start. A planet build is unnecessary for personal use.

## 2. Raise the limits

`service_limits` is per costing. Edit the generated `custom_files/valhalla.json`
(or seed it before the first run):

```json
{
  "service_limits": {
    "pedestrian": { "max_distance": 500000.0 },
    "bicycle":    { "max_distance": 500000.0 }
  }
}
```

Restart the container after changing the config.

## 3. Terminate HTTPS and add CORS

Two constraints come from the app:

- `endpoint()` in `src/providers.ts` accepts only `https:` URLs, without
  credentials, a query or a fragment.
- Valhalla's built-in server sends no CORS headers.

So put a TLS-terminating reverse proxy in front of `8002` that adds
`Access-Control-Allow-Origin`. The app issues simple `GET` requests with
`Accept: application/json`, so a preflight handler is not strictly required,
but returning one is harmless:

```nginx
server {
    listen 443 ssl;
    server_name valhalla.example.com;
    # ssl_certificate ...; ssl_certificate_key ...;

    location / {
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin '*';
            add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS';
            add_header Access-Control-Allow-Headers 'Accept, Content-Type';
            add_header Content-Length 0;
            return 204;
        }
        add_header Access-Control-Allow-Origin '*' always;
        proxy_pass http://127.0.0.1:8002;
    }
}
```

Restrict the allowed origin when the deployment is not public.

## 4. Point the app at it

In **Settings → Open service endpoints**, set:

- **Valhalla routing:** `https://valhalla.example.com/route`
- **Valhalla elevation:** `https://valhalla.example.com/height`

Save. The app appends its own `?json=` query, so enter the bare path only.

## Limits that still apply

Self-hosting raises the provider cap only. The app keeps its own ceilings:
5,000 km per activity, 50 routing waypoints, 100,000 route points and 20,000
loop laps (`src/model.ts`). Elevation is sampled at most 60 points per route.
