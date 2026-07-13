# Unleash Flight Recap

A tiny, zero-dependency Node app that turns an [Unleash Live](https://developer.unleashlive.com)
flight into a self-contained HTML **flight recap** — flight path, altitude profile,
telemetry stats, a mode-by-mode timeline, and (when present) the AI detections
from the drone's video stream.

Built to learn the Unleash Live developer APIs by wiring three of them together:

| Step | API | Endpoint |
|------|-----|----------|
| Auth check | Analytics | `GET /v1/analytics/version` |
| List flights | Flight Logs | `GET /v1/flights` |
| Telemetry track | Flight Logs (file) | `GET https://flights.unleashlive.com/<s3Path>` |
| What the AI saw | Analytics | `GET /v1/analytics/tableau/{deviceId}/{from}/{to}/{page}` |

## Requirements

- Node 18+ (uses the built-in `fetch`; no `npm install` needed)
- A Personal Access Token: Unleash Live → Profile → Developers → Create Token
  (Viewer role is enough)

## Usage

```bash
export UL_PAT=ul_pat_your_token_here      # or put it in .env

node index.js --list                      # list your recent flights
node index.js                             # recap your latest flight
node index.js --flight <id>               # recap a specific flight
node index.js --device <analyticsDeviceId># override which device to pull analytics from

# Batch: one overview page for many flights, plus every individual recap
node index.js --batch                     # 12 most recent flights
node index.js --batch --limit 30          # more flights
node index.js --batch --from 2026-06-01 --to 2026-06-30   # a month
node index.js --batch --device W339346bb4bc402a           # one device/site
```

A single recap is written to `out/recap-<flightId>.html`. Batch mode writes a
dated folder `out/batch-<timestamp>/` containing `index.html` (the clickable
overview: aggregate distance / air time / drones / pilots / detections, plus a
card per flight) and one full `<flightId>.html` recap for each flight.

The flight-path charts are drawn over **satellite imagery**. By default this
uses Esri World Imagery tiles (no API key required). Set `MAPBOX_TOKEN` in your
environment to use Mapbox satellite tiles instead. The imagery loads from the
tile provider when the report is opened in a browser (the charts themselves are
still inline SVG — only the map tiles are fetched at view time).

## Notes

- **Auth** is a Bearer token: `Authorization: Bearer <UL_PAT>` against
  `https://api.unleashlive.com`.
- The **analytics device IDs** (`/v1/analytics/devices`) can differ from a
  flight's `deviceId`. If a flight was not live-streamed to a detector, the
  analytics section will simply be empty — the telemetry recap still renders.
- `.env` and `out/` are gitignored so your token and reports never get committed.

## Project layout

```
index.js        CLI entry: orchestrates the calls, writes the report
src/api.js      Thin Unleash Live API client
src/recap.js    Fusion logic: telemetry analysis + detection summary
src/report.js   Self-contained HTML + inline SVG renderer
```
