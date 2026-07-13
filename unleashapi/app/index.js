// unleash-flight-recap
// Fuse an Unleash Live flight log with the AI analytics from its video stream
// into a narrated, self-contained HTML recap.
//
// Usage:
//   UL_PAT=ul_pat_... node index.js --list                      # list recent flights
//   UL_PAT=ul_pat_... node index.js                             # recap the latest flight
//   UL_PAT=ul_pat_... node index.js --flight <id>               # recap a specific flight
//   UL_PAT=ul_pat_... node index.js --device <id>               # override the analytics device id
//   UL_PAT=ul_pat_... node index.js --batch [--limit N]         # one overview page for many flights
//                              [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--device <id>]

import { writeFile, mkdir } from "node:fs/promises";
import { UnleashClient } from "./src/api.js";
import { buildRecap, analyzeTelemetry, toMs } from "./src/recap.js";
import { renderReport, renderBatch } from "./src/report.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);

// Fetch + fuse everything for a single flight. Logs are optional (best-effort).
async function recapFlight(client, flight, deviceOverride, log = console.log) {
  const deviceId = deviceOverride || flight.deviceId;

  let telemetry = null;
  if (flight.s3Path) {
    try {
      telemetry = analyzeTelemetry(await client.flightLog(flight.s3Path));
    } catch (err) {
      log(`  ! could not download flight log for ${flight.id} (${err.message.split("\n")[0]})`);
    }
  }

  const fromMs = toMs(flight.flightStartDate);
  const toMsEnd = toMs(flight.flightEndDate) || fromMs + 60 * 60 * 1000;
  let detections = [];
  if (deviceId && Number.isFinite(fromMs)) {
    try {
      detections = await client.analytics(deviceId, fromMs, toMsEnd);
    } catch {
      /* no stored analytics for this device/window — fine, section renders empty */
    }
  }

  return buildRecap(flight, { telemetry, detections });
}

async function main() {
  const client = new UnleashClient(process.env.UL_PAT);

  const version = await client.version();
  console.log(`✓ Connected to Unleash Live (analytics API v${version})`);

  // Server-side date/device filters keep the flight list small.
  const filters = {};
  const from = arg("from");
  const to = arg("to");
  if (from) filters.dateFrom = Date.parse(from);
  if (to) filters.dateTo = Date.parse(to) + 86_400_000 - 1; // inclusive end of day
  if (from || to) filters.dateType = "flightStartDate";
  if (arg("device")) filters.deviceId = arg("device");

  const flights = await client.flights(filters);
  if (!flights.length) {
    console.log("No flight logs found for that scope.");
    return;
  }
  flights.sort((a, b) => toMs(b.flightStartDate) - toMs(a.flightStartDate));

  if (has("list")) {
    console.log(`\nRecent flights (${flights.length}):`);
    for (const f of flights.slice(0, 20)) {
      console.log(`  ${f.id}  ${f.flightStartDate ?? "?"}  ${f.droneName ?? "?"}  device=${f.deviceId ?? "?"}`);
    }
    console.log("\nRecap one with:  node index.js --flight <id>");
    return;
  }

  if (has("batch")) return runBatch(client, flights, { from, to, deviceId: arg("device") });

  // --- Single flight ---------------------------------------------------------
  const flightId = arg("flight");
  const flight = flightId ? flights.find((f) => f.id === flightId) : flights[0];
  if (!flight) throw new Error(`Flight ${flightId} not found.`);

  console.log(`\nBuilding recap for: ${flight.name ?? flight.id}`);
  const recap = await recapFlight(client, flight, arg("device"));

  await mkdir("out", { recursive: true });
  const outPath = `out/recap-${flight.id}.html`;
  await writeFile(outPath, renderReport(recap), "utf8");

  console.log(`\n✓ Recap written to ${outPath}`);
  if (recap.telemetry) {
    const s = recap.telemetry.stats;
    console.log(`  peak ${s.maxHeight?.toFixed(1)}m · ${s.maxDist?.toFixed(0)}m from home · top ${s.maxSpeed.toFixed(1)}m/s · battery ${s.batStart}%→${s.batEnd}%`);
  }
  console.log(`  ${recap.analytics.total} AI detections across ${recap.analytics.summary.length} classes`);
}

// --- Batch: many flights -> one overview page + every individual recap -------
async function runBatch(client, flights, scope) {
  const limit = Number(arg("limit")) || 12;
  const selected = flights.slice(0, limit);
  console.log(`\nBatch: building ${selected.length} recaps (of ${flights.length} in scope)...`);

  // Modest concurrency so we do not hammer the API with dozens of parallel downloads.
  const recaps = [];
  const POOL = 4;
  for (let i = 0; i < selected.length; i += POOL) {
    const chunk = selected.slice(i, i + POOL);
    const done = await Promise.all(chunk.map((f) => recapFlight(client, f, scope.deviceId)));
    recaps.push(...done);
    process.stdout.write(`  ${Math.min(i + POOL, selected.length)}/${selected.length}\r`);
  }

  // Aggregate totals across the batch.
  const totals = {
    distance: 0,
    airTime: 0,
    drones: new Set(),
    pilots: new Set(),
    detTotal: 0,
    detClasses: [],
  };
  const classAgg = new Map();
  for (const r of recaps) {
    totals.distance += Number(r.flight.flightDistance) || 0;
    totals.airTime += Number(r.flight.flightDuration) || 0;
    if (r.flight.droneName) totals.drones.add(r.flight.droneName);
    if (r.flight.pilotName) totals.pilots.add(r.flight.pilotName);
    totals.detTotal += r.analytics.total;
    for (const c of r.analytics.summary) classAgg.set(c.cls, (classAgg.get(c.cls) ?? 0) + c.n);
  }
  totals.detClasses = [...classAgg.entries()].sort((a, b) => b[1] - a[1]).map(([cls, n]) => ({ cls, n }));

  // Write the overview + one full recap per flight into a dated folder so the
  // card links (<flightId>.html) resolve.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = `out/batch-${stamp}`;
  await mkdir(dir, { recursive: true });
  await Promise.all(recaps.map((r) => writeFile(`${dir}/${r.flight.id}.html`, renderReport(r, { backHref: "index.html" }), "utf8")));
  const indexPath = `${dir}/index.html`;
  await writeFile(indexPath, renderBatch({ totals, flights: recaps, filters: scope }), "utf8");

  console.log(`\n\n✓ Batch overview: ${indexPath}`);
  console.log(`  ${recaps.length} flights · ${(totals.distance / 1000).toFixed(2)} km · ${Math.round(totals.airTime / 60)} min air time · ${totals.detTotal} AI detections`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
