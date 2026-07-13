// Render the recap model into a self-contained HTML file (inline SVG charts,
// no external assets), so it opens offline and is safe to share.

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
const fmtDur = (s) => (Number.isFinite(+s) ? `${Math.floor(+s / 60)}m ${Math.round(+s % 60)}s` : "—");
const fmtDist = (m) => (!Number.isFinite(+m) ? "—" : +m >= 1000 ? `${(+m / 1000).toFixed(2)} km` : `${Math.round(+m)} m`);
const round = (n, d = 1) => (Number.isFinite(+n) ? (+n).toFixed(d) : "—");

// Altitude-over-time area chart from telemetry points.
function altitudeChart(points) {
  const W = 720, H = 160, pad = 24;
  const ts = points.map((p) => p.t);
  const hs = points.map((p) => p.h);
  const tMax = Math.max(...ts, 1);
  const hMax = Math.max(...hs, 1);
  const x = (t) => pad + (t / tMax) * (W - 2 * pad);
  const y = (h) => H - pad - (h / hMax) * (H - 2 * pad);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.h).toFixed(1)}`).join(" ");
  const area = `${line} L${x(tMax).toFixed(1)},${H - pad} L${pad},${H - pad} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Altitude profile">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f81f7" stop-opacity=".5"/>
      <stop offset="1" stop-color="#2f81f7" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#ag)"/>
    <path d="${line}" fill="none" stroke="#39d0d8" stroke-width="2"/>
    <text x="${pad}" y="14" class="cax">${hMax.toFixed(0)} m</text>
    <text x="${pad}" y="${H - 6}" class="cax">T+0</text>
    <text x="${W - pad}" y="${H - 6}" class="cax" text-anchor="end">T+${Math.round(tMax)}s</text>
  </svg>`;
}

const TILE = 256;

// Web-mercator: lat/lng -> global pixel coords at a given zoom.
function project(lat, lng, z) {
  const n = TILE * 2 ** z;
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((lng + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  };
}

// Satellite tile URL. Defaults to Esri World Imagery (no token). Upgrades to
// Mapbox satellite when MAPBOX_TOKEN is set in the environment.
function tileUrl(z, x, y) {
  const tk = process.env.MAPBOX_TOKEN;
  if (tk) return `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}.jpg?access_token=${tk}`.replace(/&/g, "&amp;");
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

// Top-down GPS path over satellite imagery. Pass `size` for a square, or an
// explicit `width`/`height` for a landscape map.
export function pathChart(points, { size = 340, width, height, markerR = 5 } = {}) {
  const W = width || size, H = height || size;
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (pts.length < 2) return "";
  const uid = Math.random().toString(36).slice(2, 8);
  const PAD = 1.6; // how much of the frame the path fills (higher = more context)

  // Pick the highest zoom (most detail) at which the padded path still fits.
  let z = 18;
  for (; z > 13; z--) {
    const px = pts.map((p) => project(p.lat, p.lng, z));
    const spanX = Math.max(...px.map((p) => p.x)) - Math.min(...px.map((p) => p.x));
    const spanY = Math.max(...px.map((p) => p.y)) - Math.min(...px.map((p) => p.y));
    if (spanX * PAD <= W && spanY * PAD <= H) break;
  }

  const px = pts.map((p) => project(p.lat, p.lng, z));
  const cx = (Math.min(...px.map((p) => p.x)) + Math.max(...px.map((p) => p.x))) / 2;
  const cy = (Math.min(...px.map((p) => p.y)) + Math.max(...px.map((p) => p.y))) / 2;
  const originX = cx - W / 2, originY = cy - H / 2; // top-left of viewport in world px

  // Lay down the tiles that cover the viewport.
  let tiles = "";
  const n = 2 ** z;
  for (let tx = Math.floor(originX / TILE); tx <= Math.floor((originX + W) / TILE); tx++) {
    for (let ty = Math.floor(originY / TILE); ty <= Math.floor((originY + H) / TILE); ty++) {
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      tiles += `<image href="${tileUrl(z, tx, ty)}" x="${(tx * TILE - originX).toFixed(1)}" y="${(ty * TILE - originY).toFixed(1)}" width="${TILE}" height="${TILE}"/>`;
    }
  }

  const sx = (p) => (p.x - originX).toFixed(1);
  const sy = (p) => (p.y - originY).toFixed(1);
  const line = px.map((p, i) => `${i ? "L" : "M"}${sx(p)},${sy(p)}`).join(" ");
  const a = px[0], b = px[px.length - 1];
  const label = Math.min(W, H) >= 200
    ? `<text x="${W - 8}" y="${H - 8}" text-anchor="end" fill="#fff" opacity=".65" font-size="11">Imagery: ${process.env.MAPBOX_TOKEN ? "Mapbox / Maxar" : "Esri, Maxar"}</text>`
    : "";

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Flight path over satellite imagery">
    <defs><clipPath id="clip-${uid}"><rect x="0" y="0" width="${W}" height="${H}" rx="12"/></clipPath></defs>
    <g clip-path="url(#clip-${uid})">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#0e141b"/>
      ${tiles}
      <path d="${line}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${line}" fill="none" stroke="#39d0d8" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${sx(a)}" cy="${sy(a)}" r="${markerR}" fill="#39d0d8" stroke="#000" stroke-opacity=".6"/>
      <circle cx="${sx(b)}" cy="${sy(b)}" r="${markerR}" fill="#ff7b72" stroke="#000" stroke-opacity=".6"/>
      ${label}
    </g>
  </svg>`;
}

export function renderReport(recap, { backHref } = {}) {
  const f = recap.flight;
  const t = recap.telemetry;
  const a = recap.analytics;
  const head = t?.header || {};
  const take = f.takeOffLocation || head.takeOffLocation || {};
  const lat = take.lat, lon = take.long ?? take.lng ?? take.lon;
  const hasGeo = Number.isFinite(+lat) && Number.isFinite(+lon);
  const mapUrl = hasGeo ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}` : null;

  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;

  const telemetryStats = t
    ? [
        stat("Peak height", `${round(t.stats.maxHeight)} m`),
        stat("Max from home", fmtDist(t.stats.maxDist)),
        stat("Top ground speed", `${round(t.stats.maxSpeed)} m/s`),
        stat("Battery", `${round(t.stats.batStart, 0)}% → ${round(t.stats.batEnd, 0)}%`),
        stat("Avg wind", `${round(t.stats.windAvg)} m/s`),
        stat("Telemetry samples", t.stats.samples),
      ].join("")
    : "";

  const eventRows = t?.events?.length
    ? t.events.map((e) => `<li><span class="t">T+${Math.round(e.t)}s</span><span class="d">${esc(e.text)}</span></li>`).join("")
    : `<li><span class="d muted">No telemetry track available for this flight.</span></li>`;

  const maxDet = Math.max(1, ...a.summary.map((x) => x.n));
  const detRows = a.summary.length
    ? a.summary.map((x) => `
      <div class="bar-row"><span class="bar-label">${esc(x.cls)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(x.n / maxDet) * 100}%"></span></span>
      <span class="bar-num">${x.n}</span></div>`).join("")
    : `<p class="muted">No AI detections were recorded on this device during the flight window. (The Analytics API is live and authenticated — this account just has no stored detections yet.)</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Flight Recap — ${esc(f.name || f.id)}</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#0b0f14;color:#e6edf3;padding:32px}
  .wrap{max-width:820px;margin:0 auto}
  h1{font-size:26px;margin:0 0 4px}.sub{color:#8b98a5;margin:0 0 28px}
  .card{background:#131a22;border:1px solid #202b36;border-radius:14px;padding:20px 22px;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}
  .stat .k{color:#8b98a5;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .stat .v{font-size:20px;font-weight:600;margin-top:2px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#8b98a5;margin:0 0 14px}
  .charts{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
  .chart{background:#0e141b;border-radius:10px;max-width:100%}
  .chart.flex{flex:1 1 380px}.cax{fill:#5b6774;font-size:11px}
  .bigmap{border-radius:12px;overflow:hidden}
  .bigmap svg,.chart svg{width:100%;height:auto;display:block}
  .bar-row{display:grid;grid-template-columns:130px 1fr 44px;align-items:center;gap:10px;margin:7px 0}
  .bar-label{text-align:right;color:#c9d4de;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bar-track{background:#1d2732;border-radius:6px;height:16px;overflow:hidden}
  .bar-fill{display:block;height:100%;background:linear-gradient(90deg,#2f81f7,#39d0d8)}
  .bar-num{text-align:right;font-variant-numeric:tabular-nums;color:#c9d4de}
  ol.timeline{list-style:none;margin:0;padding:0}
  ol.timeline li{display:flex;gap:16px;padding:8px 0;border-top:1px solid #1b2530}
  ol.timeline li:first-child{border-top:none}
  .t{font-variant-numeric:tabular-nums;color:#39d0d8;min-width:64px;font-weight:600}
  .muted{color:#8b98a5}a{color:#2f81f7}
  footer{color:#5b6774;font-size:12px;margin-top:24px;text-align:center}
  .back{display:inline-block;color:#8b98a5;text-decoration:none;font-size:14px;margin-bottom:14px}
  .back:hover{color:#2f81f7}
</style></head><body><div class="wrap">
  ${backHref ? `<a class="back" href="${esc(backHref)}">← All flights</a>` : ""}
  <h1>Flight Recap</h1>
  <p class="sub">${esc(f.name || f.id)} · ${esc(head.userName || f.pilotName || "")} · ${esc(new Date(head.flightStartTime || +f.flightStartDate || Date.now()).toISOString())}</p>

  <div class="card"><div class="grid">
    ${stat("Drone", esc(f.droneName || head.droneName || "—"))}
    ${stat("Pilot", esc(f.pilotName || head.userName || "—"))}
    ${stat("Duration", fmtDur(f.flightDuration))}
    ${stat("Distance", fmtDist(f.flightDistance))}
    ${telemetryStats}
  </div>${mapUrl ? `<p style="margin:16px 0 0"><a href="${mapUrl}" target="_blank" rel="noopener">📍 Take-off: ${lat}, ${lon} — open in map</a></p>` : ""}</div>

  ${t ? `<div class="card"><h2>Flight path</h2>
    <div class="bigmap">${pathChart(t.points, { width: 760, height: 460, markerR: 6 })}</div>
  </div>
  <div class="card"><h2>Altitude profile</h2>
    <div class="chart" style="background:none;width:100%">${altitudeChart(t.points)}</div>
  </div>` : ""}

  <div class="card"><h2>Flight timeline</h2><ol class="timeline">${eventRows}</ol></div>

  <div class="card"><h2>What the AI saw</h2>${detRows}</div>

  <footer>Generated by unleash-flight-recap · Unleash Live Flight Logs + Analytics APIs</footer>
</div></body></html>`;
}

// ---- Batch: many flights on one overview page -------------------------------

export function renderBatch(batch) {
  const { totals, flights, filters } = batch;
  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;

  const scopeBits = [];
  if (filters.from) scopeBits.push(`from ${filters.from}`);
  if (filters.to) scopeBits.push(`to ${filters.to}`);
  if (filters.deviceId) scopeBits.push(`device ${filters.deviceId}`);
  const scope = scopeBits.length ? scopeBits.join(" · ") : "most recent flights";

  const cards = flights
    .map(({ flight: f, telemetry: t, analytics: a }) => {
      const when = new Date(t?.header?.flightStartTime || +f.flightStartDate || Date.now());
      const thumb = t ? pathChart(t.points, { size: 150, markerR: 4 }) : `<div class="nothumb">no track</div>`;
      const detBadge = a.total ? `<span class="badge">${a.total} AI</span>` : "";
      return `<a class="fcard" href="${esc(f.id)}.html">
        <div class="thumb">${thumb}</div>
        <div class="fbody">
          <div class="fname">${esc(f.name || f.id)} ${detBadge}</div>
          <div class="fmeta">${esc(f.droneName || t?.header?.droneName || "—")} · ${esc(f.pilotName || t?.header?.userName || "—")}</div>
          <div class="fmeta">${esc(when.toISOString().replace("T", " ").slice(0, 16))}</div>
          <div class="frow">
            <span>${fmtDur(f.flightDuration)}</span>
            <span>${fmtDist(f.flightDistance)}</span>
            <span>${t ? round(t.stats.maxHeight, 0) + " m peak" : "—"}</span>
          </div>
        </div></a>`;
    })
    .join("");

  const topClasses = totals.detClasses.length
    ? `<div class="card"><h2>AI detections across all flights</h2>${totals.detClasses
        .map((c) => `<span class="pill">${esc(c.cls)} · ${c.n}</span>`)
        .join(" ")}</div>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Flight Batch — ${flights.length} flights</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#0b0f14;color:#e6edf3;padding:32px}
  .wrap{max-width:960px;margin:0 auto}
  h1{font-size:26px;margin:0 0 4px}.sub{color:#8b98a5;margin:0 0 28px}
  .card{background:#131a22;border:1px solid #202b36;border-radius:14px;padding:20px 22px;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px}
  .stat .k{color:#8b98a5;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .stat .v{font-size:20px;font-weight:600;margin-top:2px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#8b98a5;margin:0 0 14px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
  .fcard{display:flex;gap:14px;background:#131a22;border:1px solid #202b36;border-radius:12px;padding:12px;text-decoration:none;color:inherit;transition:border-color .15s}
  .fcard:hover{border-color:#2f81f7}
  .thumb{flex:0 0 90px}.thumb svg{width:90px;height:90px}
  .nothumb{width:90px;height:90px;display:flex;align-items:center;justify-content:center;background:#0e141b;border-radius:8px;color:#5b6774;font-size:12px}
  .fbody{min-width:0;flex:1}
  .fname{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fmeta{color:#8b98a5;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .frow{display:flex;gap:12px;margin-top:8px;font-size:13px;color:#c9d4de;font-variant-numeric:tabular-nums}
  .badge{background:#1f6feb33;color:#58a6ff;font-size:11px;padding:1px 6px;border-radius:6px;vertical-align:middle}
  .pill{display:inline-block;background:#1d2732;border-radius:6px;padding:3px 9px;margin:0 6px 6px 0;font-size:13px}
  footer{color:#5b6774;font-size:12px;margin-top:24px;text-align:center}
</style></head><body><div class="wrap">
  <h1>Flight Batch Overview</h1>
  <p class="sub">${flights.length} flights · ${esc(scope)}</p>

  <div class="card"><div class="grid">
    ${stat("Flights", flights.length)}
    ${stat("Total distance", fmtDist(totals.distance))}
    ${stat("Total air time", fmtDur(totals.airTime))}
    ${stat("Drones", totals.drones.size)}
    ${stat("Pilots", totals.pilots.size)}
    ${stat("AI detections", totals.detTotal)}
  </div></div>

  ${topClasses}

  <div class="card"><h2>Flights</h2><div class="cards">${cards}</div></div>

  <footer>Generated by unleash-flight-recap · click a flight to open its full recap</footer>
</div></body></html>`;
}
