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
const { compute, orderPlan, timeline, workingRows, runLedger, fmt,
        plateSchedule, plateOutlook, weeksUntil, backupIdle } = require("./coverage.cjs");

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
  for (const g of d.substituteGroups || []) {
    const where = `group ${g.id || "(no id)"}`;
    const spec = (g.items || []).map(it => (typeof it === "string" ? { item: it, perUnit: 1 } : it));
    if (!g.id || !g.name) E(`${where}: a group needs an id and a name`);
    if (spec.length < 2) E(`${where}: a group needs at least two items`);
    const members = spec.map(sp => (d.films || []).find(r => r.item === sp.item));
    members.forEach((m, k) => { if (!m) E(`${where}: item ${spec[k].item} is not in films`); });
    const found = members.filter(Boolean);
    const unit = g.unit || (found[0] && found[0].unit);
    found.forEach((m, k) => {
      const per = spec[k].perUnit;
      if (m.unit !== unit && !(typeof per === "number" && per > 0)) {
        E(`${where}: item ${m.item} is held in ${m.unit} but the group is in ${unit}, and no perUnit conversion is given`);
      }
      if (per != null && (typeof per !== "number" || per <= 0)) {
        E(`${where}: item ${m.item} has an invalid perUnit (${JSON.stringify(per)})`);
      }
    });
    if (g.orderItem && !spec.some(sp => sp.item === g.orderItem)) E(`${where}: orderItem ${g.orderItem} is not one of its items`);
    if (!g.orderItem && !g.retiring) W(`${where}: no orderItem, so the order panel cannot say which item to raise the PO against`);
  }

  for (const line of d.lines || []) {
    const where = `line ${line.id || "(no id)"}`;
    const has = id => (d.films || []).some(r => r.item === id);
    if (!line.defaultItem) E(`${where}: needs a defaultItem`);
    else if (!has(line.defaultItem)) E(`${where}: defaultItem ${line.defaultItem} is not in films`);
    for (const b of line.backupItems || []) {
      if (!has(b)) E(`${where}: backupItem ${b} is not in films`);
    }
    if (!(line.backupItems || []).length) W(`${where}: no backupItems, so the line adds nothing`);
  }

  for (const r of d.films || []) {
    if (r.filmPerImpression != null &&
        (typeof r.filmPerImpression !== "number" || r.filmPerImpression <= 0)) {
      E(`film ${r.item}: filmPerImpression must be a positive number (${JSON.stringify(r.filmPerImpression)})`);
    }
  }

  for (const r of d.films || []) {
    if (!r.successorItem) continue;
    const suc = (d.films || []).find(x => x.item === r.successorItem);
    if (!suc) { W(`film ${r.item}: successorItem ${r.successorItem} is not in films — its draw will not transfer anywhere`); continue; }
    if (!r.retiring) W(`film ${r.item}: has a successorItem but is not marked retiring, so nothing transfers`);
    if (suc.unit !== r.unit && !r.successorPerUnit) {
      W(`film ${r.item}: hands over to ${suc.item}, but ${r.unit} and ${suc.unit} differ and no successorPerUnit is given — the step onto ${suc.item} is left out`);
    }
  }

  for (const r of d.films || []) {
    const so = r.siblingOrder;
    if (!so) continue;
    if (!so.item || so.qty == null || !so.unit || !so.ref) {
      E(`film ${r.item}: siblingOrder needs item, qty, unit and ref`);
      continue;
    }
    const sib = (d.films || []).find(x => x.item === so.item);
    if (!sib) { W(`film ${r.item}: siblingOrder points at ${so.item}, which is not in films`); continue; }
    if (sib.onOrder !== so.qty) {
      W(`film ${r.item}: siblingOrder says ${fmt(so.qty)} ${so.unit} on ${so.ref}, but item ${so.item} reads ${fmt(sib.onOrder)} ${sib.unit} on order — one of the two is stale`);
    }
    const pooled = (d.substituteGroups || []).some(g =>
      (g.items || []).map(it => (typeof it === "string" ? it : it.item)).includes(so.item));
    if (pooled) W(`film ${r.item}: siblingOrder names ${so.item}, which is already pooled in a substituteGroup — the order would be counted twice`);
  }

  /* A brand prefix is the whole difference between two products. "BA Mirin .5oz" draws
     929; "Mirin .5oz" is run at THEM on their own blank and draws nothing of ours. Any
     name match loose enough to merge the pair attributes one's volume to the other, so
     the twins are found and checked for having been collapsed into one film. */
  const BRAND = /^(BA|HF|TJS|GE)\s+/;
  const placeOf = {};
  for (const [film, rows] of Object.entries(d.salesOrderLines || {})) {
    for (const r of rows) (placeOf[r.product] = placeOf[r.product] || new Set()).add("film:" + film);
  }
  for (const w of d.noFilmWorkOrders || []) {
    (placeOf[w.product] = placeOf[w.product] || new Set()).add("nofilm");
  }
  for (const name of Object.keys(placeOf)) {
    if (!BRAND.test(name)) continue;
    const bare = name.replace(BRAND, "");
    if (!placeOf[bare]) continue;
    const shared = [...placeOf[name]].filter(k => placeOf[bare].has(k) && k !== "nofilm");
    if (shared.length) {
      E(`"${name}" and "${bare}" are different products but both map to ${shared.join(", ")} — ` +
        `the brand prefix is the distinction, so one of them is attributing the other's volume`);
    }
  }

  const nfr = d.noFilmReasons || {};
  for (const w of d.noFilmWorkOrders || []) {
    if (!w.wo || !w.product) { E("a noFilmWorkOrders entry is missing wo or product"); continue; }
    if (!w.reason) continue;
    const reason = nfr[w.reason];
    if (!reason) {
      W(`${w.wo}: reason "${w.reason}" has no entry in noFilmReasons, so the page will print the key`);
      continue;
    }
    if (!reason.label) W(`noFilmReasons.${w.reason} has no label`);
    /* A BA product runs on our film. One carrying no film line is therefore an
       exception, and has to say which one — "it is at THEM" is the rule for the
       plain-named products, not an account of why a BA product left our film. */
    if (/^BA\s/.test(w.product) && !reason.baException) {
      W(`${w.wo} ${w.product}: a BA product runs on our film, so "${w.reason}" does not ` +
        `explain why this one carries no film line — it needs a reason marked baException`);
    }
  }
  const unexplained = (d.noFilmWorkOrders || []).filter(w => !w.reason);
  if (unexplained.length) {
    W(`${unexplained.length} work order${unexplained.length === 1 ? "" : "s"} carry no film line and no stated reason: ` +
      unexplained.map(w => `${w.wo} ${w.product}`).join(", "));
  }

  const pl = d.plates;
  if (pl) {
    if (!Array.isArray(pl.register)) E("plates.register must be an array");
    if (!pl.asOf) W("plates.asOf missing — the page cannot say how old the register is");
    if (!pl.termMonths) W("plates.termMonths missing — the page cannot say how long a plate runs");
    const seen = new Map();
    for (const p of pl.register || []) {
      if (!p.plate) { E("a plates.register entry has no plate name"); continue; }
      if (p.expires != null && isNaN(new Date(p.expires + "T00:00:00"))) {
        E(`plate ${p.plate}: expires must be a YYYY-MM-DD date or null (got ${JSON.stringify(p.expires)})`);
      }
      if (p.expires == null && !p.expired) {
        W(`plate ${p.plate}: no expiry and not marked expired — it will read as undated`);
      }
      const covers = [p.item].concat(p.alsoItems || []).filter(Boolean);
      for (const id of covers) {
        const known = (d.films || []).some(r => r.item === id) ||
                      (d.substituteGroups || []).some(g => g.id === id);
        if (!known) W(`plate ${p.plate}: covers ${id}, which is not a film or a substitute group`);
        if (seen.has(id)) W(`${id} is covered by two plates: ${seen.get(id)} and ${p.plate}`);
        else seen.set(id, p.plate);
      }
      if (!p.item && !p.note) W(`plate ${p.plate}: no item and no note saying why`);
    }
    // a printed film we buy, with no plate against it, is a gap in the register
    for (const r of d.films || []) {
      if (r.stockedBy !== "MP" || r.blank) continue;
      const covered = (pl.register || []).some(p =>
        [p.item].concat(p.alsoItems || []).includes(r.item)) ||
        (d.substituteGroups || []).some(g =>
          (g.items || []).map(it => (typeof it === "string" ? it : it.item)).includes(r.item) &&
          (pl.register || []).some(p => p.item === g.id));
      if (!covered && !r.retiring && (r.onWorkOrders || r.weeklyBuildRate)) {
        W(`film ${r.item} is being consumed but no plate in the register covers it — either it is a blank or the register is short a row`);
      }
    }
  }

  const LEDGER_TYPES = ["received", "used", "count", "adjustment"];
  for (const t of d.trackers || []) {
    const where = `tracker ${t.item || "(no item)"}`;
    if (!t.item) E("a tracker has no item number");
    else if (!known(t.item)) W(`${where} has no matching row in films — it will not be cross-linked`);
    if (!t.unit) E(`${where}: no unit`);
    if (!t.heldBy) E(`${where}: heldBy must name who holds the stock`);
    let last = "";
    for (const e of t.ledger || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) {
        E(`${where}: ledger entry date must be YYYY-MM-DD (got ${JSON.stringify(e.date)})`);
      } else {
        if (e.date < last) W(`${where}: ledger entry ${e.date} is out of date order — check nothing is missing`);
        last = e.date;
      }
      if (!LEDGER_TYPES.includes(e.type)) E(`${where}: ledger type must be one of ${LEDGER_TYPES.join(", ")} (got ${JSON.stringify(e.type)})`);
      if (typeof e.qty !== "number" || !isFinite(e.qty)) E(`${where}: ledger qty is not a number (${JSON.stringify(e.qty)})`);
      else if (e.qty < 0 && e.type !== "adjustment") E(`${where}: only an adjustment may carry a negative quantity`);
      if (!e.ref) W(`${where}: the ${e.date} ${e.type} entry has no reference — a PO or shipment number makes it auditable`);
    }
    if ((t.ledger || []).length) {
      const L = runLedger(t);
      if (L.balance < 0) E(`${where}: the running balance goes negative (${Math.round(L.balance)} ${t.unit}) — an entry is missing or wrong`);
    }
  }

  for (const g of d.glossary || []) {
    if (!g.group) W("a glossary section has no group name");
    for (const t of g.terms || []) {
      if (!t.term || !t.def) E(`glossary section "${g.group}": every entry needs both a term and a definition`);
    }
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

/* A film whose stock sits partly on a differently-denominated sibling item: the order
   on the sibling cannot be pooled without a stated conversion, so it is flagged, never
   quietly folded into the runway. */
function sibling(d, r) {
  const ids = r.memberIds || [r.item];
  for (const id of ids) {
    const f = d.films.find(x => x.item === id);
    if (f && f.siblingOrder) return f.siblingOrder;
  }
  return null;
}

function summarise(d) {
  const lead = d.meta.defaultLeadWeeks || d.meta.baseLeadWeeks || 16;
  const opts = { basis: "max", lead, baseLead: d.meta.baseLeadWeeks || 16,
                 films: d.films, transitions: d.transitions,
                 plates: d.plates, groups: d.substituteGroups || [], asOf: d.meta.asOf };
  const working = workingRows(d.films, d.substituteGroups || [], d.lines || []);
  const rows = working.map(r => ({ r, c: compute(r, opts) }));
  const pick = s => rows.filter(x => x.c.status === s);
  const late = pick("late"), watch = pick("watch"), winding = pick("retiring");
  const quiet = rows.filter(x => x.c.quiet);

  const lines = [];

  const toOrder = working
    .filter(r => r.stockedBy === "MP")
    .map(r => ({ r, p: orderPlan(r, opts) }))
    .filter(x => x.p && x.p.orderInWeeks <= 8)
    .sort((a, b) => a.p.orderInWeeks - b.p.orderInWeeks);
  const tracked = new Set((d.trackers || []).map(t => t.item));

  lines.push(toOrder.length ? "To order inside the next 8 weeks:" : "Nothing to order inside the next 8 weeks.");
  const later = working
    .filter(r => r.stockedBy === "MP")
    .map(r => ({ r, t: timeline(r, opts) }))
    .filter(x => x.t.orderByWeeks != null && x.t.orderByWeeks > 8)
    .sort((a, b2) => a.t.orderByWeeks - b2.t.orderByWeeks)
    .slice(0, 5);
  for (const { r, p } of toOrder) {
    lines.push(`  ${p.overdue ? "NOW" : "by "}  ${fmt(p.qty).padStart(7)} ${r.unit.padEnd(2)} ${r.item} ${r.name}` +
               (tracked.has(r.item) ? "   [held off-site — check the tracker]" : "") +
               (sibling(d, r) ? `   [${sibling(d, r).qty.toLocaleString()} ${sibling(d, r).unit} already on ${sibling(d, r).ref}, item ${sibling(d, r).item} — not counted]` : ""));
  }
  if (later.length) {
    lines.push("Next after that:");
    for (const { r, t } of later) {
      lines.push(`  ${t.orderByWeeks.toFixed(0).padStart(3)}wk  ${r.item} ${r.name}` +
                 `  (runs dry in ${t.coverWeeks.toFixed(0)} wks)`);
    }
  }
  for (const t of d.trackers || []) {
    const L = runLedger(t);
    lines.push(L.stale
      ? `  tracker ${t.item} ${t.name}: no ledger entries yet`
      : `  tracker ${t.item} ${t.name}: ${fmt(L.balance)} ${t.unit} at ${t.heldBy}` +
        (L.coverWeeks === null ? "" : `, ${L.coverWeeks.toFixed(1)} weeks of cover`));
  }
  const plates = d.plates || {};
  if ((plates.register || []).length) {
    const sched = plateSchedule(opts);
    const say = s => {
      const r = s.plate.item
        ? working.find(x => x.item === s.plate.item || (x.memberIds || []).includes(s.plate.item))
        : null;
      return r ? plateOutlook(r, opts) : { state: s.plate.item ? "undated" : "no-film" };
    };
    const flag = sched.map(s => ({ s, o: say(s) }))
      .filter(x => ["expired", "lapsing", "lapses-first"].includes(x.o.state));
    lines.push("");
    lines.push(flag.length ? "Plate renewals in sight:" : "No plate renewal is in sight.");
    const why = ({ s, o }) =>
      o.state === "lapses-first"
        ? `lapses ${s.plate.expires}, before its ${Math.round(o.orderByWeeks)}-week order-by`
        : o.state === "lapsing"
          ? `lapses ${s.plate.expires}, in ${Math.round(s.weeks)} wk${Math.round(s.weeks) === 1 ? "" : "s"}`
          : s.plate.expires ? `lapsed ${s.plate.expires}` : "expired, no date given";
    for (const x of flag) {
      lines.push(`  ${(x.o.state === "lapses-first" ? "by " : "NOW").padEnd(5)}` +
                 `${(x.s.plate.item || "—").padEnd(7)} ${x.s.plate.plate}   ${why(x)}`);
    }
    const spare = sched.filter(s => s.plate.item && say(s).state === "not-needed");
    for (const s of spare) {
      lines.push(`  none ${s.plate.item.padEnd(7)} ${s.plate.plate}   being run out, no renewal needed`);
    }
    const orphan = sched.filter(s => !s.plate.item);
    for (const s of orphan) {
      lines.push(`  ?    ${"—".padEnd(7)} ${s.plate.plate}   no film item holds this any more`);
    }
  }

  lines.push("");
  lines.push(`Worst-case basis, ${lead}-week lead:`);
  lines.push(`  ${late.length} short   ${watch.length} tight   ` +
             `${rows.length - late.length - watch.length - winding.length - quiet.length} covered   ` +
             `${winding.length} winding down   ${quiet.length} no demand`);
  const slackOf = x => {
    const t = timeline(x.r, opts);
    return t && t.slackWeeks != null ? t.slackWeeks : Infinity;
  };
  for (const { r, c } of late.slice().sort((a, b) => slackOf(a) - slackOf(b))) {
    lines.push(`  SHORT  ${r.item} ${r.name} — ${fmt(Math.abs(c.gap))} ${r.unit} short` +
               (r.stockedBy !== "MP" ? ` (THEM to order)`
                 : backupIdle(r, opts) ? ` — relief for ${r.line.defaultItem}, not ordered while that is on schedule`
                 : `, suggested order ${fmt(c.order)} ${r.unit}`));
  }
  for (const x of watch.slice().sort((a, b) => slackOf(a) - slackOf(b))) {
    const w = slackOf(x);
    // A retiring film is never reordered, so it has no order-by date and no slack.
    // What matters is how long its own stock lasts and what hands over at the end.
    if (x.r.retiring) {
      const t = timeline(x.r, opts);
      lines.push(`  SOON   ${x.r.item} ${x.r.name} — winding down, ` +
                 `${t.coverWeeks.toFixed(0)} wks of its own stock left` +
                 (x.c.transfer > 0
                   ? `, ${fmt(x.c.transfer)} ${x.r.unit} transfers to ${x.r.successorItem || "its successor"}`
                   : ""));
      continue;
    }
    lines.push(`  SOON   ${x.r.item} ${x.r.name} — ` +
               (w === Infinity ? "little slack left before the order-by date"
                               : `${w.toFixed(0)} wk${w.toFixed(0) === "1" ? "" : "s"} of slack before the order-by date`));
  }
  return lines.join("\n");
}

/* ---------- render ---------- */

function render(d, period) {
  const template = fs.readFileSync(path.join(ROOT, "src", "template.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "src", "dashboard.js"), "utf8");
  const cov = fs.readFileSync(path.join(ROOT, "src", "coverage.cjs"), "utf8");
  const title = `${d.meta.title} — ${d.meta.org || "Mighty Picnic"}`;
  // the logo travels inside the page, so a built file still shows it when emailed or
  // opened straight off disk. It is a mask, so CSS gives it its colour per theme.
  const logo = "data:image/png;base64," +
    fs.readFileSync(path.join(ROOT, "src", "logo-mask.png")).toString("base64");
  const favicon = "data:image/png;base64," +
    fs.readFileSync(path.join(ROOT, "src", "favicon.png")).toString("base64");
  // </script> inside a JSON string would close the tag early
  const json = JSON.stringify(d).replace(/<\//g, "<\\/");
  return template
    .replace("{{TITLE}}", title)
    .replace(/\{\{LOGO\}\}/g, () => logo)
    .replace("{{FAVICON}}", () => favicon)
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
