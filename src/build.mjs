#!/usr/bin/env node
/* Build the film coverage dashboard from a monthly data file.
 *
 *   node src/build.mjs                 build the newest data/*.json
 *   node src/build.mjs 2026-10         build that period
 *   node src/build.mjs --all           build every period
 *   node src/build.mjs --check         validate only, write nothing
 *
 * Output: dist/film-coverage-<period>.html, and dist/index.html for the newest. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { compute, fmt } = require("./coverage.cjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const DIST_DIR = path.join(ROOT, "dist");

const NUMERIC = ["onHand", "onOrder", "committed", "backordered",
                 "onWorkOrders", "soNotYetWO", "forecastBeyond", "weeklyBuildRate"];

/* ---------- helpers ---------- */

function periods() {
  return fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}\.json$/.test(f))
    .map(f => f.replace(/\.json$/, ""))
    .sort();
}

function loadPeriod(period) {
  const file = path.join(DATA_DIR, period + ".json");
  if (!fs.existsSync(file)) {
    throw new Error(`No data file for ${period} (expected data/${period}.json).\n` +
                    `Periods available: ${periods().join(", ") || "none"}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`data/${period}.json is not valid JSON — ${e.message}`);
  }
}

/* ---------- validation ---------- */

function validate(d, period) {
  const errors = [], warnings = [];
  const E = m => errors.push(m);
  const W = m => warnings.push(m);

  const meta = d.meta || {};
  if (!meta.asOf || isNaN(new Date(meta.asOf + "T00:00:00"))) {
    E(`meta.asOf must be a YYYY-MM-DD date (got ${JSON.stringify(meta.asOf)})`);
  }
  if (meta.period && meta.period !== period) {
    W(`meta.period is "${meta.period}" but the file is ${period}.json`);
  }
  for (const k of ["title", "subtitle", "asOfLabel", "footer"]) {
    if (!meta[k]) W(`meta.${k} is empty — that text will render blank`);
  }
  if (!meta.baseLeadWeeks) W("meta.baseLeadWeeks missing — falling back to 16");
  if (!Array.isArray(d.films) || !d.films.length) E("data.films is empty — nothing to show");

  const seen = new Set();
  for (const r of d.films || []) {
    const where = `film ${r.item || "(no item)"}`;
    if (!r.item) E(`a film row has no item number`);
    else if (seen.has(r.item)) E(`item ${r.item} appears twice in films`);
    else seen.add(r.item);
    if (!r.name) E(`${where}: no name`);
    if (!r.unit) E(`${where}: no unit (m, mm or ea)`);
    if (!["MP", "THEM"].includes(r.stockedBy)) E(`${where}: stockedBy must be "MP" or "THEM"`);
    for (const k of NUMERIC) {
      if (r[k] === undefined) { W(`${where}: ${k} missing — treated as 0`); continue; }
      if (typeof r[k] !== "number" || !isFinite(r[k])) E(`${where}: ${k} is not a number (${JSON.stringify(r[k])})`);
      else if (r[k] < 0) E(`${where}: ${k} is negative (${r[k]})`);
    }
    if (r.leadWeeks != null && (typeof r.leadWeeks !== "number" || r.leadWeeks <= 0)) {
      E(`${where}: leadWeeks must be a positive number of weeks`);
    }
    if (r.retiring && !r.successor) W(`${where}: marked retiring but has no successor text`);
    if (r.committed > r.onHand) {
      W(`${where}: committed (${r.committed}) exceeds on hand (${r.onHand}) — check the NetSuite pull`);
    }
  }

  const blank = (d.films || []).every(r => NUMERIC.every(k => !r[k]));
  if (blank) W("every position in this file is still 0 — the month has not been filled in yet");

  // cross-references
  const known = id => seen.has(id);
  const woByFilm = new Map();
  for (const l of d.workOrderLines || []) {
    if (!known(l.film)) W(`work order ${l.wo} points at film ${l.film}, which is not in films`);
    if (typeof l.qty !== "number") E(`work order ${l.wo} (${l.film}): qty is not a number`);
    woByFilm.set(l.film, (woByFilm.get(l.film) || 0) + (l.qty || 0));
  }
  for (const r of d.films || []) {
    const lines = woByFilm.get(r.item);
    if (lines == null) {
      if (r.onWorkOrders > 0) W(`film ${r.item}: onWorkOrders is ${fmt(r.onWorkOrders)} ${r.unit} but no work order lines are listed`);
      continue;
    }
    const diff = Math.abs(lines - (r.onWorkOrders || 0));
    if (diff > Math.max(1, (r.onWorkOrders || 0) * 0.01)) {
      W(`film ${r.item}: work order lines total ${fmt(lines)} ${r.unit} but onWorkOrders says ${fmt(r.onWorkOrders || 0)} — one of the two is stale`);
    }
  }
  for (const id of Object.keys(d.salesOrderLines || {})) {
    if (!known(id)) W(`salesOrderLines has film ${id}, which is not in films`);
    for (const s of d.salesOrderLines[id]) {
      if (typeof s.filmQty !== "number") E(`sales order line for ${id} (${s.product}): filmQty is not a number`);
    }
  }
  for (const id of Object.keys(d.forecastMonths || {})) {
    if (!known(id)) W(`forecastMonths has film ${id}, which is not in films`);
  }
  for (const id of Object.keys(d.forecastNotes || {})) {
    if (!known(id)) W(`forecastNotes has film ${id}, which is not in films`);
  }
  for (const t of d.transitions || []) {
    if (!known(t.item)) W(`transition ${t.item} (${t.name}) has no matching row in films`);
    if (typeof t.onHand !== "number") E(`transition ${t.item}: onHand is not a number`);
    if (typeof t.weeklyRate !== "number") E(`transition ${t.item}: weeklyRate is not a number`);
  }
  for (const n of d.notes || []) {
    if (!n.title) W("a note card has no title");
    for (const b of n.body || []) {
      if (typeof b !== "string" && !Array.isArray(b)) {
        E(`note "${n.title}": body entries must be a paragraph (string) or a bullet list (array of strings)`);
      }
    }
    if (n.table && n.table !== "noFilmWorkOrders") {
      W(`note "${n.title}": table "${n.table}" is not a table this dashboard knows how to draw`);
    }
  }

  return { errors, warnings };
}

/* ---------- what the dashboard will say ---------- */

function summarise(d) {
  const lead = d.meta.defaultLeadWeeks || d.meta.baseLeadWeeks || 16;
  const opts = { basis: "max", lead, baseLead: d.meta.baseLeadWeeks || 16 };
  const rows = d.films.map(r => ({ r, c: compute(r, opts) }));
  const pick = s => rows.filter(x => x.c.status === s);
  const late = pick("late"), watch = pick("watch"), winding = pick("retiring");
  const quiet = rows.filter(x => x.c.quiet);

  const lines = [];
  lines.push(`Worst-case basis, ${lead}-week lead:`);
  lines.push(`  ${late.length} short   ${watch.length} tight   ` +
             `${rows.length - late.length - watch.length - winding.length - quiet.length} covered   ` +
             `${winding.length} winding down   ${quiet.length} no demand`);
  for (const { r, c } of late.sort((a, b) => a.c.headroom - b.c.headroom)) {
    lines.push(`  SHORT  ${r.item} ${r.name} — ${fmt(Math.abs(c.gap))} ${r.unit} short` +
               (r.stockedBy === "MP" ? `, suggested order ${fmt(c.order)} ${r.unit}` : ` (THEM to order)`));
  }
  for (const { r, c } of watch.sort((a, b) => a.c.headroom - b.c.headroom)) {
    lines.push(`  TIGHT  ${r.item} ${r.name} — ${(c.headroom * 100).toFixed(0)}% headroom`);
  }
  return lines.join("\n");
}

/* ---------- render ---------- */

function render(d, period) {
  const template = fs.readFileSync(path.join(ROOT, "src", "template.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "src", "dashboard.js"), "utf8");
  const cov = fs.readFileSync(path.join(ROOT, "src", "coverage.cjs"), "utf8");
  const title = `${d.meta.title} — ${d.meta.org || "Mighty Picnic"}`;
  // </script> inside a JSON string would close the tag early
  const json = JSON.stringify(d).replace(/<\//g, "<\\/");
  return template
    .replace("{{TITLE}}", title)
    .replace("{{DATA}}", () => json)
    .replace("{{APP}}", () => cov + "\n" + app)
    + `\n<!-- built from data/${period}.json on ${new Date().toISOString().slice(0, 10)} -->\n`;
}

/* ---------- main ---------- */

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const all = argv.includes("--all");
const named = argv.filter(a => !a.startsWith("--"));

const available = periods();
if (!available.length) {
  console.error("No data files found in data/ — expected something like data/2026-09.json");
  process.exit(1);
}
const targets = all ? available : named.length ? named : [available[available.length - 1]];
const newest = available[available.length - 1];

let failed = false;
for (const period of targets) {
  const d = loadPeriod(period);
  const { errors, warnings } = validate(d, period);

  console.log(`\n${period}  ${d.meta?.asOfLabel || ""}  (${(d.films || []).length} films)`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  for (const e of errors) console.log(`  ERROR:   ${e}`);

  if (errors.length) {
    console.log(`  not built — fix the ${errors.length} error${errors.length > 1 ? "s" : ""} above`);
    failed = true;
    continue;
  }

  console.log(summarise(d).split("\n").map(l => "  " + l).join("\n"));

  if (checkOnly) { console.log("  checked only, nothing written"); continue; }

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const html = render(d, period);
  const out = path.join(DIST_DIR, `film-coverage-${period}.html`);
  fs.writeFileSync(out, html);
  console.log(`  wrote dist/film-coverage-${period}.html  (${Math.round(html.length / 1024)} KB)`);
  if (period === newest) {
    fs.writeFileSync(path.join(DIST_DIR, "index.html"), html);
    console.log("  wrote dist/index.html  (newest period)");
  }
}

console.log("");
process.exit(failed ? 1 : 0);
