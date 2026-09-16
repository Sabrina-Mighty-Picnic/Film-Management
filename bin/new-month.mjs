#!/usr/bin/env node
/* Start a new monthly snapshot from the last one.
 *
 *   node bin/new-month.mjs 2026-10                  new file, positions blanked
 *   node bin/new-month.mjs 2026-10 --as-of 2026-10-14
 *   node bin/new-month.mjs 2026-10 --keep-numbers   carry last month's figures over
 *
 * Structure is kept: the film list, names, units, who stocks them, retiring flags,
 * per-item lead times, the transition panel, the source table and the note cards.
 * Positions and order lines are cleared, because a figure you forget to update is
 * more dangerous as a stale number than as a zero. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");

const POSITIONS = ["onHand", "onOrder", "committed", "backordered",
                   "onWorkOrders", "soNotYetWO", "forecastBeyond", "weeklyBuildRate"];

const argv = process.argv.slice(2);
const period = argv.find(a => /^\d{4}-\d{2}$/.test(a));
const keep = argv.includes("--keep-numbers");
const asOfArg = (() => {
  const i = argv.indexOf("--as-of");
  return i >= 0 ? argv[i + 1] : null;
})();

if (!period) {
  console.error("Usage: node bin/new-month.mjs <YYYY-MM> [--as-of YYYY-MM-DD] [--keep-numbers]");
  process.exit(1);
}

const out = path.join(DATA_DIR, period + ".json");
if (fs.existsSync(out)) {
  console.error(`data/${period}.json already exists — edit it, or delete it first.`);
  process.exit(1);
}

const prior = fs.readdirSync(DATA_DIR)
  .filter(f => /^\d{4}-\d{2}\.json$/.test(f))
  .sort()
  .pop();
if (!prior) {
  console.error("No previous data file to copy from.");
  process.exit(1);
}

const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, prior), "utf8"));
const asOf = asOfArg || new Date().toISOString().slice(0, 10);
const asOfDate = new Date(asOf + "T00:00:00");
if (isNaN(asOfDate)) {
  console.error(`--as-of must be a YYYY-MM-DD date (got ${asOfArg})`);
  process.exit(1);
}

d.meta.period = period;
d.meta.asOf = asOf;
d.meta.asOfLabel = asOfDate.toLocaleDateString("en-GB",
  { day: "numeric", month: "long", year: "numeric" });

if (!keep) {
  for (const r of d.films) for (const k of POSITIONS) if (k in r) r[k] = 0;
  for (const t of d.transitions) { t.onHand = 0; t.weeklyRate = 0; }
  d.workOrderLines = [];
  d.salesOrderLines = {};
  d.forecastMonths = {};
  d.noFilmWorkOrders = [];
}

fs.writeFileSync(out, JSON.stringify(d, null, 2) + "\n");

console.log(`Created data/${period}.json from ${prior}, as of ${d.meta.asOfLabel}.`);
console.log(keep
  ? "Last month's figures were carried over — overwrite each one you refresh."
  : "Positions and order lines were blanked. Still to fill in:");
if (!keep) {
  console.log(`  films[]          ${d.films.length} rows: ${POSITIONS.join(", ")}`);
  console.log("  workOrderLines   one row per open work order film line");
  console.log("  salesOrderLines  open sales orders, by film");
  console.log("  forecastMonths   the FILM tab rows, by film");
  console.log("  noFilmWorkOrders open work orders with no film line");
  console.log("  transitions[]    onHand and weeklyRate for each printed film running out");
}
if ((d.trackers || []).length) {
  console.log("Carried over in full, because a ledger is a running log and not a monthly position:");
  for (const t of d.trackers) {
    console.log(`  tracker ${t.item} ${t.name} — ${(t.ledger || []).length} entries. ` +
                "Add this month's deliveries and shipments to the end of it.");
  }
}
console.log("Also re-read by hand, because they are last month's words:");
console.log("  meta.asOfLines, sourceNotes, notes[] — the commentary cards");
console.log(`Then: npm run build -- ${period}`);
