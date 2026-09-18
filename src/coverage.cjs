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

/* The rate a film is drawn at. A film that is the default on a line carries the whole
   line's draw, even where a backup took some of it while the default was empty. */
function buildRate(r) { return num(r.lineRate) || num(r.weeklyBuildRate); }

/* What is coming onto this film later.
   A film being run out hands its draw to its successor the week its own stock is gone,
   so the step date is derived, not guessed: it is the retiring film's runout. Anything
   with no date — a move that is agreed but unscheduled — is returned separately, so it
   can be shown without silently moving a date. */
function incomingSteps(r, opts) {
  var films = (opts && opts.films) || [];
  var steps = [], unscheduled = [];

  var transitions = (opts && opts.transitions) || [];
  films.forEach(function (o) {
    if (!o.retiring || o.successorItem !== r.item) return;
    // a film being run out is judged on the rate it is actually being consumed at, which
    // the transition panel carries — the trailing build rate can be near zero for a SKU
    // that simply has not been built lately, and would put the handover decades out
    var tr = transitions.filter(function (t) { return t.item === o.item; })[0];
    var rate = tr && num(tr.weeklyRate) > 0 ? num(tr.weeklyRate) : buildRate(o);
    if (rate <= 0) return;
    var conv = o.unit === r.unit ? 1 : num(o.successorPerUnit);
    if (!conv) { unscheduled.push({ from: o.item, name: o.name, rate: null, why: "units differ and no conversion is given" }); return; }
    var stock = tr && num(tr.onHand) > 0 ? num(tr.onHand) : num(o.onHand) + num(o.onOrder);
    steps.push({ week: stock / rate, rate: rate * conv, from: o.item, name: o.name,
                 basis: tr ? tr.rateBasis : "recent builds" });
  });

  (r.incoming || []).forEach(function (x) {
    if (x.fromWeek == null) { unscheduled.push({ from: x.source, name: x.note, rate: num(x.rate), why: "no date set" }); return; }
    steps.push({ week: num(x.fromWeek), rate: num(x.rate), from: x.source, name: x.note });
  });

  steps.sort(function (a, b) { return a.week - b.week; });
  return { steps: steps, unscheduled: unscheduled };
}

/* The draw rate is a step function once something is transferring onto this film.
   Returns the quantity drawn between two week offsets. */
function drawBetween(r, opts, from, to) {
  var base = buildRate(r);
  var steps = incomingSteps(r, opts).steps;
  var total = 0, at = from;
  var rateAt = function (w) {
    return steps.reduce(function (a, s) { return w >= s.week ? a + s.rate : a; }, base);
  };
  var bounds = [from].concat(steps.map(function (s) { return s.week; }).filter(function (w) {
    return w > from && w < to;
  })).concat([to]);
  for (var i = 0; i < bounds.length - 1; i++) {
    total += rateAt(bounds[i]) * (bounds[i + 1] - bounds[i]);
    at = bounds[i + 1];
  }
  return total;
}

/* How many weeks the stock lasts, walking through the steps as they land. */
function weeksOfCover(stock, r, opts) {
  var base = buildRate(r);
  var steps = incomingSteps(r, opts).steps;
  if (base <= 0 && !steps.length) return null;
  var left = stock, week = 0, rate = base;
  for (var i = 0; i < steps.length; i++) {
    var until = steps[i].week;
    if (rate > 0) {
      var burn = rate * (until - week);
      if (burn >= left) return week + left / rate;
      left -= burn;
    }
    week = until;
    rate += steps[i].rate;
  }
  if (rate <= 0) return null;
  return week + left / rate;
}

/* r    — one row of data.films, or a pooled group row
   opts — { basis: "wo"|"so"|"plan"|"burn"|"max", lead: weeks, baseLead: weeks } */
function compute(r, opts) {
  var baseLead = opts.baseLead || 16;
  var lead = r.leadWeeks != null ? r.leadWeeks : opts.lead;   // a film with its own lead is judged on it
  var scale = lead / baseLead;

  var woNeed   = num(r.onWorkOrders);                          // film on open work orders
  var soNeed   = woNeed + num(r.soNotYetWO);                   // plus orders with no work order yet
  var planNeed = soNeed + num(r.forecastBeyond) * scale;       // plus the forecast beyond both
  var burnNeed = drawBetween(r, opts, 0, lead);                // the draw over the window, steps and all

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
  var spare = gap / need;            // how much more than the window needs, as a ratio

  // A film being run out is never "short" — we are not reordering it. Demand beyond
  // what is left transfers to its successor; it is that film's problem, not this one's.
  if (r.retiring) {
    var transfer = Math.max(0, need - stock);
    return { need: Math.min(need, stock), rawNeed: need, woNeed: woNeed, soNeed: soNeed,
             planNeed: planNeed, burnNeed: burnNeed, stock: stock, gap: gap, spare: spare,
             transfer: transfer, order: 0, quiet: false,
             status: r.expediting && transfer > 0 ? "watch" : "retiring" };
  }

  return { need: need, woNeed: woNeed, soNeed: soNeed, planNeed: planNeed, burnNeed: burnNeed,
           stock: stock, gap: gap, spare: spare, quiet: false,
           // short, or inside a fifth of the window — which in time is a fifth of the lead
           status: gap < 0 ? "late" : spare < 0.2 ? "watch" : "ok",
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
  var rate = Math.max(buildRate(r), c.need / lead);
  var stepped = weeksOfCover(c.stock, r, opts);
  var coverWeeks = rate > 0 ? Math.min(stepped == null ? Infinity : stepped, c.stock / rate) : Infinity;
  var orderInWeeks = coverWeeks - lead;

  // short: cover the shortfall plus one further lead time. Thin but not short: one lead time.
  // the order lands one lead time out and has to carry the lead time after that, at
  // whatever the draw is by then — which is not today's draw if something transfers in
  var window = drawBetween(r, opts, lead, lead * 2);
  var qty = c.gap < 0 ? Math.abs(c.gap) + Math.max(c.need, window) : Math.max(c.need, window);

  // round up to whole rolls and respect a supplier minimum, where the item carries them
  var rolls = null;
  if (num(r.rollSize) > 0) { rolls = Math.ceil(qty / r.rollSize); qty = rolls * r.rollSize; }
  if (num(r.minOrder) > 0 && qty < r.minOrder) {
    qty = r.minOrder;
    if (num(r.rollSize) > 0) rolls = Math.ceil(qty / r.rollSize);
  }

  return { status: c.status, need: c.need, gap: c.gap, spare: c.spare, stock: c.stock,
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
  var rate = Math.max(buildRate(r), c.quiet ? 0 : c.need / lead);
  var out = { lead: lead, rate: rate, stock: c.stock, gap: c.gap, spare: c.spare,
              status: c.quiet ? "quiet" : c.status, reorder: !r.retiring && !c.quiet };
  if (rate <= 0) { out.coverWeeks = null; out.orderByWeeks = null; return out; }
  var stepped = weeksOfCover(c.stock, r, opts);
  var flat = c.stock / rate;
  // the implied rate from firm orders can exceed the build rate; take whichever runs out first
  out.coverWeeks = stepped == null ? flat : Math.min(stepped, flat);
  out.steps = incomingSteps(r, opts);
  out.orderByWeeks = out.reorder ? out.coverWeeks - lead : null;
  out.slackWeeks = out.orderByWeeks;      // weeks of runway beyond the lead time
  return out;
}

/* Two items that hold the same printed film are one runway, even when they are held in
   different units at different sites. A member may declare `perUnit` — how much of its
   own unit makes one of the group's — and quantities convert on the way in. */
function mergeGroup(films, g) {
  var spec = (g.items || []).map(function (it) {
    return typeof it === "string" ? { item: it, perUnit: 1 }
                                  : { item: it.item, perUnit: num(it.perUnit) || 1 };
  });
  var members = spec.map(function (sp) {
    var r = films.filter(function (x) { return x.item === sp.item; })[0];
    return r ? { r: r, perUnit: sp.perUnit } : null;
  }).filter(Boolean);
  if (!members.length) return null;

  var sum = function (k) {
    return members.reduce(function (a, m) { return a + num(m.r[k]) / m.perUnit; }, 0);
  };
  var order = members.filter(function (m) { return m.r.item === g.orderItem; })[0];
  var orderItem = order ? order.r : members[0].r;

  return {
    item: g.id,
    name: g.name,
    group: g,
    members: members.map(function (m) { return m.r; }),
    memberSpec: members,
    memberIds: members.map(function (m) { return m.r.item; }),
    orderItem: orderItem,
    unit: g.unit || members[0].r.unit,
    stockedBy: g.stockedBy || members[0].r.stockedBy,
    note: g.note,
    leadWeeks: g.orderItem ? (orderItem.leadWeeks != null ? orderItem.leadWeeks : null) : null,
    onHand: sum("onHand"), onOrder: sum("onOrder"),
    committed: sum("committed"), backordered: sum("backordered"),
    onWorkOrders: sum("onWorkOrders"), soNotYetWO: sum("soNotYetWO"),
    forecastBeyond: sum("forecastBeyond"), weeklyBuildRate: sum("weeklyBuildRate"),
    retiring: g.retiring != null ? g.retiring : members.every(function (m) { return m.r.retiring; }),
    successor: g.successor || orderItem.successor,
    rollSize: orderItem.rollSize, minOrder: orderItem.minOrder
  };
}

/* A line has one default film and one or more backups. They are NOT pooled: the backup
   has its own lead time and is only bought when the default will not arrive in time.
   What the default does inherit is the line's whole draw, because any week the backup
   was in the machine is a week the default would otherwise have supplied. */
function applyLine(films, line) {
  var rateOf = function (id) {
    var r = films.filter(function (x) { return x.item === id; })[0];
    return r ? num(r.weeklyBuildRate) : 0;
  };
  var ids = [line.defaultItem].concat(line.backupItems || []);
  var lineRate = ids.reduce(function (a, id) { return a + rateOf(id); }, 0);
  var marks = {};
  marks[line.defaultItem] = { lineRate: lineRate, line: line, role: "default" };
  (line.backupItems || []).forEach(function (id) {
    marks[id] = { line: line, role: "backup" };
  });
  return marks;
}

/* The rows the working views use: films that are not inside a group, plus one row per
   group, with the line annotations applied. */
function workingRows(films, groups, lines) {
  var claimed = {};
  (groups || []).forEach(function (g) {
    (g.items || []).forEach(function (it) {
      claimed[typeof it === "string" ? it : it.item] = true;
    });
  });

  var marks = {};
  (lines || []).forEach(function (line) {
    var m = applyLine(films, line);
    Object.keys(m).forEach(function (k) { marks[k] = m[k]; });
  });

  var rows = films.filter(function (r) { return !claimed[r.item]; }).map(function (r) {
    var mk = marks[r.item];
    if (!mk) return r;
    var copy = {}, k;
    for (k in r) if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k];
    if (mk.lineRate) copy.lineRate = mk.lineRate;
    copy.line = mk.line;
    copy.lineRole = mk.role;
    return copy;
  });

  (groups || []).forEach(function (g) {
    var m = mergeGroup(films, g);
    if (m) rows.push(m);
  });
  return rows;
}

return { compute: compute, orderPlan: orderPlan, timeline: timeline,
         mergeGroup: mergeGroup, workingRows: workingRows, buildRate: buildRate,
         incomingSteps: incomingSteps, drawBetween: drawBetween, weeksOfCover: weeksOfCover,
         runLedger: runLedger, fmt: fmt, num: num };
});
