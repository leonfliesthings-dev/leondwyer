# Unleash Live API — Flight Recap

A small demo built to explore the [Unleash Live developer APIs](https://developer.unleashlive.com).
It fuses **Flight Logs** telemetry with stream **Analytics** into per-flight HTML
"recaps" — a satellite map of the flight path, altitude profile, telemetry
stats, a mode-by-mode timeline, and (when present) the AI detections from the
drone's video stream.

## View it

- **[Open the flight overview →](./index.html)** — a batch of recent flights;
  click any card for its full recap.

These are static pages. All flight data is baked in at build time; opening a
page only fetches satellite map tiles (Esri World Imagery). Nothing calls the
Unleash Live API at view time.

## APIs used

| Step | API | Endpoint |
|------|-----|----------|
| Auth check | Analytics | `GET /v1/analytics/version` |
| List flights | Flight Logs | `GET /v1/flights` |
| Telemetry track | Flight Logs (file) | `GET https://flights.unleashlive.com/<s3Path>` |
| AI detections | Analytics | `GET /v1/analytics/tableau/{deviceId}/{from}/{to}/{page}` |

## Source

The generator is a zero-dependency Node app (Node 18+, uses built-in `fetch`).
See [`app/`](./app) — `index.js` orchestrates the calls, `src/api.js` is the API
client, `src/recap.js` does the fusion, `src/report.js` renders the HTML.
