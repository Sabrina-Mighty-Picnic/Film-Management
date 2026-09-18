/* The coverage maths, shared by the page and the build script.
   Loaded in the browser as a plain script (sets window.FilmCoverage) and in
   Node by src/build.mjs, so the sanity numbers printed at build time are the
   same numbers the dashboard shows. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FilmCoverage = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }

function fmt(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
       : n >= 1e4 ? Math.round(n / 1e3) + "k"
       : Math.round(n).toLocaleString();
}

/* r    — one row of data.films
   opts — { basis: "wo"|"so"|"plan"|"burn"|"max", lead: weeks, baseLead: weeks } */
function compute(r, opts) {
  var baseLead = opts.baseLead || 16;
  var lead = r.leadWeeks != null ? r.leadWeeks : opts.lead;   // a film with its own lead is judged on it
  var scale = lead / baseLead;

  var woNeed   = num(r.onWorkOrders);                          // film on open work orders
  var soNeed   = woNeed + num(r.soNotYetWO);                   // plus orders with no work order yet
  var planNeed = soNeed + num(r.forecastBeyond) * scale;       // plus the forecast beyond both
  var burnNeed = num(r.weeklyBuildRate) * lead;                // recent build rate over the window

  var need = opts.basis === "wo"   ? woNeed
           : opts.basis === "so"   ? soNeed
           : opts.basis === "plan" ? planNeed
           : opts.basis === "burn" ? burnNeed
           : Math.max(soNeed, planNeed, burnNeed);

  // on hand + on order, not NetSuite's "available": committed stock is allocated to the
  // same work orders counted here, so netting both would take the demand off twice.
  var stock = num(r.onHand) + num(r.onOrder);

  if (need <= 0) {
    return { need: 0, woNeed: woNeed, soNeed: soNeed, planNeed: planNeed,
             burnNeed: burnNeed, stock: stock, quiet: true };
  }

  var gap = stock - need;
  var headroom = gap / need;

  // A film being run out is never "short" — we are not reordering it. Demand beyond
  // what is left transfers to its successor; it is that film's problem, not this one's.
  if (r.retiring) {
    var transfer = Math.max(0, need - stock);
    return { need: Math.min(need, stock), rawNeed: need, woNeed: woNeed, soNeed: soNeed,
             planNeed: planNeed, burnNeed: burnNeed, stock: stock, gap: gap, headroom: headroom,
             transfer: transfer, order: 0, quiet: false,
             status: r.expediting && transfer > 0 ? "watch" : "retiring" };
  }

  return { need: need, woNeed: woNeed, soNeed: soNeed, planNeed: planNeed, burnNeed: burnNeed,
           stock: stock, gap: gap, headroom: headroom, quiet: false,
           status: gap < 0 ? "late" : headroom < 0.2 ? "watch" : "ok",
           // cover the shortfall plus one further lead time at the same rate
           order: gap < 0 ? Math.abs(gap) + need : 0 };
}

/* What to buy, and by when.
   Cover is judged against the faster of the recent build rate and the rate the chosen
   demand basis implies over the lead time, so a film with orders but no build history
   still gets a date. The order-by date is the point at which the remaining cover equals
   the lead time: past it, an order placed today lands too late.
   Returns null for a film there is nothing to buy for — no demand, or being run out. */
function orderPlan(r, opts) {
  var c = compute(r, opts);
  if (c.quiet || r.retiring) return null;

  var lead = r.leadWeeks != null ? r.leadWeeks : opts.lead;
  var rate = Math.max(num(r.weeklyBuildRate), c.need / lead);
  var coverWeeks = rate > 0 ? c.stock / rate : Infinity;
  var orderInWeeks = coverWeeks - lead;

  // short: cover the shortfall plus one further lead time. Thin but not short: one lead time.
  var qty = c.gap < 0 ? Math.abs(c.gap) + c.need : c.need;

  // round up to whole rolls and respect a supplier minimum, where the item carries them
  var rolls = null;
  if (num(r.rollSize) > 0) { rolls = Math.ceil(qty / r.rollSize); qty = rolls * r.rollSize; }
  if (num(r.minOrder) > 0 && qty < r.minOrder) {
    qty = r.minOrder;
    if (num(r.rollSize) > 0) rolls = Math.ceil(qty / r.rollSize);
  }

  return { status: c.status, need: c.need, gap: c.gap, headroom: c.headroom, stock: c.stock,
           lead: lead, weeklyRate: rate, coverWeeks: coverWeeks, orderInWeeks: orderInWeeks,
           qty: qty, rolls: rolls, overdue: orderInWeeks <= 0 };
}

/* A consignment ledger: film we bought that somebody else holds and manages, so it is
   not in our NetSuite on-hand. Entries are, in date order:
     received  + qty   film delivered to them
     used      - qty   film consumed, from what shipped
     count     = qty   a physical count they report, which overrides the running balance
     adjustment+ qty   anything else (scrap, transfer); qty may be negative
   Returns the rows with a running balance, plus what that balance implies. */
function runLedger(t) {
  var entries = (t.ledger || []).slice().sort(function (a, b) {
    return String(a.date).localeCompare(String(b.date));
  });

  var balance = 0, received = 0, used = 0, counted = null;
  var rows = entries.map(function (e) {
    var q = num(e.qty), delta = 0;
    if (e.type === "received") { delta = q; received += q; balance += q; }
    else if (e.type === "used") { delta = -q; used += q; balance -= q; }
    else if (e.type === "count") { delta = q - balance; balance = q; counted = e; }
    else { delta = q; balance += q; }                       // adjustment
    return { entry: e, delta: delta, balance: balance };
  });

  // usage rate from the span of the "used" entries, so a single shipment cannot imply a rate
  var uses = entries.filter(function (e) { return e.type === "used"; });
  var weeklyUsage = 0;
  if (uses.length >= 2) {
    var first = new Date(uses[0].date + "T00:00:00");
    var last = new Date(uses[uses.length - 1].date + "T00:00:00");
    var weeks = (last - first) / (7 * 864e5);
    // the first entry opens the window rather than falling inside it
    var consumed = uses.slice(1).reduce(function (a, e) { return a + num(e.qty); }, 0);
    if (weeks > 0) weeklyUsage = consumed / weeks;
  }

  var coverWeeks = weeklyUsage > 0 ? balance / weeklyUsage : null;
  var lastDate = entries.length ? entries[entries.length - 1].date : null;

  return { rows: rows, balance: balance, received: received, used: used,
           counted: counted, weeklyUsage: weeklyUsage, coverWeeks: coverWeeks,
           lastDate: lastDate, stale: !entries.length,
           low: num(t.reorderAt) > 0 && balance <= t.reorderAt };
}

/* When does this film run out, and when must it be ordered?
   The rate is the faster of the recent build rate and the rate the chosen demand basis
   implies over the lead time, so a film with orders but no build history still gets a
   date. A film being run out still runs dry — it just has no order-by date. */
function timeline(r, opts) {
  var c = compute(r, opts);
  var lead = r.leadWeeks != null ? r.leadWeeks : opts.lead;
  var rate = Math.max(num(r.weeklyBuildRate), c.quiet ? 0 : c.need / lead);
  var out = { lead: lead, rate: rate, stock: c.stock, gap: c.gap, headroom: c.headroom,
              status: c.quiet ? "quiet" : c.status, reorder: !r.retiring && !c.quiet };
  if (rate <= 0) { out.coverWeeks = null; out.orderByWeeks = null; return out; }
  out.coverWeeks = c.stock / rate;
  out.orderByWeeks = out.reorder ? out.coverWeeks - lead : null;
  return out;
}

/* Two items that feed the same line are one buying decision. A group is judged on the
   pooled position and the pooled draw; the lead time is the one you actually have to
   commit to, which is the item you reorder. Members keep their own rows in the data —
   the group replaces them in the working views. */
function mergeGroup(films, g) {
  var members = g.items.map(function (id) {
    return films.filter(function (r) { return r.item === id; })[0];
  }).filter(Boolean);
  if (!members.length) return null;

  var sum = function (k) {
    return members.reduce(function (a, r) { return a + num(r[k]); }, 0);
  };
  var orderItem = members.filter(function (r) { return r.item === g.orderItem; })[0] || members[0];

  return {
    item: g.id,
    name: g.name,
    group: g,
    members: members,
    memberIds: members.map(function (r) { return r.item; }),
    orderItem: orderItem,
    unit: members[0].unit,
    stockedBy: members[0].stockedBy,
    note: g.note,
    leadWeeks: orderItem.leadWeeks != null ? orderItem.leadWeeks : null,
    onHand: sum("onHand"), onOrder: sum("onOrder"),
    committed: sum("committed"), backordered: sum("backordered"),
    onWorkOrders: sum("onWorkOrders"), soNotYetWO: sum("soNotYetWO"),
    forecastBeyond: sum("forecastBeyond"), weeklyBuildRate: sum("weeklyBuildRate"),
    retiring: members.every(function (r) { return r.retiring; }),
    rollSize: orderItem.rollSize, minOrder: orderItem.minOrder
  };
}

/* The rows the working views use: films that are not in a group, plus one row per group. */
function workingRows(films, groups) {
  var claimed = {};
  (groups || []).forEach(function (g) {
    g.items.forEach(function (id) { claimed[id] = true; });
  });
  var rows = films.filter(function (r) { return !claimed[r.item]; });
  (groups || []).forEach(function (g) {
    var m = mergeGroup(films, g);
    if (m) rows.push(m);
  });
  return rows;
}

return { compute: compute, orderPlan: orderPlan, timeline: timeline,
         mergeGroup: mergeGroup, workingRows: workingRows,
         runLedger: runLedger, fmt: fmt, num: num };
});
