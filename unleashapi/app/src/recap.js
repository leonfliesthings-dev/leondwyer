// Fusion logic: turn a flight's telemetry track + AI detections into a recap model.

// Accepts a ms epoch number, a numeric string, or an ISO date string.
export function toMs(value) {
  if (value == null) return NaN;
  if (typeof value === "number") return value;
  if (/^\d+$/.test(String(value))) return Number(value);
  return Date.parse(value);
}

// mm:ss offset from the start of the flight, e.g. 192_000ms -> "03:12".
export function formatOffset(ms) {
  const sign = ms < 0 ? "-" : "";
  const total = Math.abs(Math.round(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${sign}T+${mm}:${ss}`;
}

// Great-circle distance between two {lat,lng} points, in metres.
function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---- Telemetry: analyse the flight log's `route` samples --------------------

export function analyzeTelemetry(log) {
  const route = (log && log.route) || [];
  if (!route.length) return null;

  const startTime = route[0].time;
  const points = []; // normalised samples for charting + stats
  let maxSpeed = 0;

  for (let i = 0; i < route.length; i++) {
    const r = route[i];
    let speed = 0;
    if (i > 0 && r.loc && route[i - 1].loc) {
      const dt = (r.time - route[i - 1].time) / 1000;
      if (dt > 0) speed = haversine(route[i - 1].loc, r.loc) / dt; // m/s ground speed
    }
    maxSpeed = Math.max(maxSpeed, speed);
    points.push({
      t: (r.time - startTime) / 1000, // seconds into flight
      lat: r.loc?.lat,
      lng: r.loc?.lng,
      h: r.h ?? 0, // height above take-off (m)
      hAsl: r.hAsl,
      bat: Array.isArray(r.batC) ? r.batC[0] : r.batC,
      homeDist: r.homeDist ?? 0,
      mode: r.flightMode,
      wind: r.wind,
      speed,
    });
  }

  const num = (sel) => points.map(sel).filter((v) => Number.isFinite(v));
  const heights = num((p) => p.h);
  const dists = num((p) => p.homeDist);
  const bats = num((p) => p.bat);
  const winds = num((p) => (p.wind ? p.wind.s : NaN));

  // Timeline from flight-mode transitions + milestone moments.
  const events = [];
  let lastMode = null;
  for (const p of points) {
    if (p.mode && p.mode !== lastMode) {
      events.push({ t: p.t, kind: "mode", text: `Flight mode → ${p.mode}` });
      lastMode = p.mode;
    }
  }
  const peak = points.reduce((a, b) => (b.h > a.h ? b : a), points[0]);
  const far = points.reduce((a, b) => (b.homeDist > a.homeDist ? b : a), points[0]);
  if (peak) events.push({ t: peak.t, kind: "peak", text: `Peak height ${peak.h.toFixed(1)} m above take-off` });
  if (far) events.push({ t: far.t, kind: "far", text: `Furthest point ${far.homeDist.toFixed(1)} m from home` });
  events.sort((a, b) => a.t - b.t);

  return {
    header: log.header || {},
    points,
    events,
    stats: {
      samples: points.length,
      maxHeight: heights.length ? Math.max(...heights) : null,
      maxDist: dists.length ? Math.max(...dists) : null,
      maxSpeed,
      batStart: bats[0],
      batEnd: bats[bats.length - 1],
      windAvg: winds.length ? winds.reduce((s, x) => s + x, 0) / winds.length : null,
    },
  };
}

// ---- Analytics: summarise AI detections (optional overlay) ------------------

function className(row) {
  return row.class_name ?? row.className ?? row.class ?? row.label ?? "unknown";
}
function detectionCount(row) {
  const n = Number(row.count ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function summariseDetections(detections, startMs, bucketSeconds = 10) {
  const totals = new Map();
  const buckets = new Map();
  for (const row of detections) {
    const cls = className(row);
    const count = detectionCount(row);
    totals.set(cls, (totals.get(cls) ?? 0) + count);
    const ts = toMs(row.timestamp ?? row.time ?? row.createdAt);
    if (!Number.isFinite(ts)) continue;
    const idx = Math.floor((ts - startMs) / (bucketSeconds * 1000));
    if (!buckets.has(idx)) buckets.set(idx, { at: ts - startMs, classes: new Map() });
    const b = buckets.get(idx);
    b.classes.set(cls, (b.classes.get(cls) ?? 0) + count);
  }
  const summary = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([cls, n]) => ({ cls, n }));
  const timeline = [...buckets.values()].sort((a, b) => a.at - b.at).map((b) => ({
    label: formatOffset(b.at),
    detections: [...b.classes.entries()].sort((a, c) => c[1] - a[1]).map(([cls, n]) => ({ cls, n })),
  }));
  return { summary, timeline, total: summary.reduce((s, x) => s + x.n, 0) };
}

// Combine everything into the model the report renders.
export function buildRecap(flight, { telemetry = null, detections = [] } = {}) {
  const startMs = toMs(flight.flightStartDate) || telemetry?.header?.flightStartTime;
  return {
    flight,
    telemetry,
    analytics: summariseDetections(detections, startMs),
  };
}
