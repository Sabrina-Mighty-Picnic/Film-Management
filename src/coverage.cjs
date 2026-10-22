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

/* Estimated impressions — how many packs a quantity of film makes.
   Preferred source is the film's own open sales orders, which carry both the finished
   units and the film they convert to, so the factor is observed rather than assumed.
   A film can state `filmPerImpression` instead. A film with neither gets no estimate:
   the page leaves it blank rather than guessing a pack size. */
/* A film-per-impression factor is either the plate's own geometry, which is gross and
   allows nothing for waste, or it is observed from what builds actually drew, which
   already carries whatever allowance the bill of materials holds. Measured on the three
   films where both figures exist (1037, 1038, 1108), the observed factor sits 2.0% above
   the pitch — so the BOM carries about 2%, and a planning buffer on top of it would be
   counted twice. Which kind a factor is therefore has to travel with it. */
function impressionBasis(r, opts) {
  if (num(r.filmPerImpression) > 0) {
    return { per: num(r.filmPerImpression), source: "stated for this film",
             lines: 0, gross: true };
  }
  var so = (opts && opts.salesOrderLines) || {};
  var spec = r.memberSpec || [{ r: r, perUnit: 1 }];
  var film = 0, units = 0, lines = 0;
  spec.forEach(function (m) {
    (so[m.r.item] || []).forEach(function (s) {
      film += num(s.filmQty) / m.perUnit;      // into the row's own unit
      units += num(s.units);
      lines++;
    });
  });
  if (film <= 0 || units <= 0) return null;
  return {
    per: film / units,
    lines: lines,
    gross: false,                 // observed from what was drawn, so waste is in it
    source: "blended across " + lines + " open sales order line" + (lines > 1 ? "s" : "")
  };
}

/* Impressions a quantity of film will actually yield. A planning buffer belongs to the
   film that needs one — Bacon Jam runs more particulates than the rest — not to the
   page, so it is read off the film and applied only to a gross factor. An observed
   factor already carries the bill of materials' own allowance. */
function lossBuffer(r) {
  var l = num(r && r.lossBuffer);
  return l > 0 && l < 1 ? l : 0;
}

function impressions(qty, basis, r) {
  if (!basis || !(basis.per > 0)) return null;
  var n = num(qty) / basis.per;
  var loss = basis.gross ? lossBuffer(r) : 0;
  return loss ? n * (1 - loss) : n;
}

/* What a reader needs to know about a figure: whether a buffer came off it. */
function impressionNote(basis, r) {
  if (!basis) return "";
  if (!basis.gross) return "observed from what builds drew, so the BOM allowance is in it";
  var loss = lossBuffer(r);
  return loss ? "plate geometry less this film's " + Math.round(loss * 100) + "% planning buffer"
              : "plate geometry, before any loss allowance";
}

/* How fast a film being run out is actually going away.
   The three readings disagree, and each is wrong on its own: a trailing build rate
   reads near zero for a film whose orders are all still open; committed orders miss
   what the plan says is coming; a plan rate misses orders beyond it. Take the fastest,
   which is the same worst-case rule the coverage rows use, and say which one won — a
   retiring film that empties sooner than expected is the one that catches you out. */
function transitionRate(t, opts) {
  var films = (opts && opts.films) || [];
  var r = films.filter(function (f) { return f.item === t.item; })[0];
  var cands = [];
  if (num(t.weeklyRate) > 0) cands.push({ rate: num(t.weeklyRate), basis: t.rateBasis || "the plan" });
  if (r) {
    if (buildRate(r) > 0) cands.push({ rate: buildRate(r), basis: "recent builds" });
    var c = compute(r, opts);
    var lead = r.leadWeeks != null ? r.leadWeeks : (opts && opts.lead) || 16;
    var need = c.rawNeed != null ? c.rawNeed : c.need;
    if (need > 0) cands.push({ rate: need / lead, basis: "its orders and draw over the window" });
  }
  if (!cands.length) return { rate: 0, basis: t.rateBasis || "no draw" };
  // on a tie the first candidate wins, so a rate that came from a stated plan or
  // projection keeps the credit rather than being relabelled as the orders behind it
  return cands.sort(function (a, b) {
    return Math.abs(b.rate - a.rate) < 0.5 ? 0 : b.rate - a.rate;
  })[0];
}

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
    // take the basis from whichever candidate actually won, not from the row's own
    // rateBasis — a film with a stated basis can still be paced by its open orders
    var pick = tr ? transitionRate(tr, opts) : { rate: buildRate(o), basis: "recent builds" };
    var rate = pick.rate;
    // a film nobody has built lately has no rate, so its handover cannot be dated.
    // Saying so is the point: dropping it silently leaves the successor's runway
    // quietly short of a draw that is certainly coming.
    if (rate <= 0) {
      unscheduled.push({ from: o.item, name: o.name, rate: null,
                         why: tr ? "nothing has drawn it lately and no rate is stated"
                                 : "nothing has drawn it lately and it has no transitions row to carry a rate" });
      return;
    }
    var conv = o.unit === r.unit ? 1 : num(o.successorPerUnit);
    if (!conv) { unscheduled.push({ from: o.item, name: o.name, rate: null, why: "units differ and no conversion is given" }); return; }
    var stock = tr && num(tr.onHand) > 0 ? num(tr.onHand) : num(o.onHand) + num(o.onOrder);
    steps.push({ week: stock / rate, rate: rate * conv, from: o.item, name: o.name,
                 basis: pick.basis });
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
/* A backup is relief, not supply. It is bought only when the default on its line will
   not arrive in time, so it earns no suggested order of its own while the default is
   still ordering on schedule — otherwise the page asks every month for film held
   precisely so it does not have to be ordered every month. */
function backupIdle(r, opts) {
  if (r.lineRole !== "backup" || !r.line) return false;
  var films = (opts && opts.films) || [];
  var def = films.filter(function (x) { return x.item === r.line.defaultItem; })[0];
  if (!def) return false;
  var marks = applyLine(films, r.line)[def.item];
  var copy = {};
  for (var k in def) if (def.hasOwnProperty(k)) copy[k] = def[k];
  if (marks) { copy.lineRate = marks.lineRate; copy.line = marks.line; copy.lineRole = marks.role; }
  var t = timeline(copy, opts);
  // the default is late: relief is a live decision again
  return !(t && t.orderByWeeks != null && t.orderByWeeks <= 0);
}

/* A display copy of a tracked film whose stock is what the co-packer actually holds.
   The stored position is never touched — compute() still reads NetSuite's zero, which
   is what it should read — but a runway drawn from that zero says the film ran dry
   today when in fact FFW hold most of a year of it. The ledger is the only record of
   that stock, so the bar reads the ledger. Returns null when there is no tracker. */
function trackerRow(r, opts) {
  var tc = trackerCover(r, opts);
  if (!tc || tc.stale) return null;
  var copy = {};
  for (var k in r) if (r.hasOwnProperty(k)) copy[k] = r[k];
  copy.onHand = tc.balance;
  copy.onOrder = 0;
  copy.heldOffSite = tc.tracker.heldBy;
  return copy;
}

function orderPlan(r, opts) {
  var c = compute(r, opts);
  if (c.quiet || r.retiring) return null;
  if (backupIdle(r, opts)) return null;
  // what a co-packer holds is outside our position by design, so it never goes into
  // onHand — but it does answer the order question, and a window it covers needs none
  var tc = trackerCover(r, opts);
  if (tc && tc.covers) return null;

  var lead = r.leadWeeks != null ? r.leadWeeks : opts.lead;
  var trp = ((opts && opts.transitions) || []).filter(function (x) { return x.item === r.item; })[0];
  var rate = Math.max(buildRate(r), c.need / lead, trp ? num(trp.weeklyRate) : 0);
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

  // Usage over the whole life of the log: everything consumed, across the weeks from the
  // first entry to the last. Measuring between shipments instead needed three of them
  // before it said anything, and read far too high when there were exactly two.
  var uses = entries.filter(function (e) { return e.type === "used"; });
  var consumed = uses.reduce(function (a, e) { return a + num(e.qty); }, 0);
  var weeklyUsage = 0, usageWeeks = 0;
  if (entries.length >= 2 && consumed > 0) {
    var first = new Date(entries[0].date + "T00:00:00");
    var last = new Date(entries[entries.length - 1].date + "T00:00:00");
    usageWeeks = (last - first) / (7 * 864e5);
    if (usageWeeks > 0) weeklyUsage = consumed / usageWeeks;
  }

  var coverWeeks = weeklyUsage > 0 ? balance / weeklyUsage : null;
  var lastDate = entries.length ? entries[entries.length - 1].date : null;

  return { rows: rows, balance: balance, received: received, used: used,
           counted: counted, weeklyUsage: weeklyUsage, coverWeeks: coverWeeks,
           usageWeeks: usageWeeks, shipments: uses.length,
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
  var tr = ((opts && opts.transitions) || []).filter(function (x) { return x.item === r.item; })[0];
  var rate = Math.max(buildRate(r), c.quiet ? 0 : c.need / lead,
                      tr ? num(tr.weeklyRate) : 0);
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


/* ---------- printing plates ----------
   A printed film is run from a plate the supplier holds, and the plate lapses on a
   fixed date rather than with use. Renewing it is a charge, so what matters is not
   the expiry on its own but whether the next order falls the wrong side of it. The
   fee is a date question, like everything else here, so it is answered in weeks. */

function plateFor(ids, plates) {
  var reg = (plates && plates.register) || [];
  for (var i = 0; i < reg.length; i++) {
    var p = reg[i];
    if (!p.item) continue;
    var covers = [p.item].concat(p.alsoItems || []);
    for (var j = 0; j < ids.length; j++) {
      if (covers.indexOf(ids[j]) >= 0) return p;
    }
  }
  return null;
}

/* weeks from the as-of date to a YYYY-MM-DD, or null when either is missing */
function weeksUntil(date, asOf) {
  if (!date || !asOf) return null;
  var a = Date.parse(asOf + "T00:00:00"), b = Date.parse(date + "T00:00:00");
  if (isNaN(a) || isNaN(b)) return null;
  return (b - a) / (7 * 864e5);
}

/* A plate is only worth renewing while we still intend to print from it. Every item a
   plate covers can be on its way out — the jerk plate covers a retiring item and a live
   one — so it is needed if any one of them is still being bought. */
function plateNeeded(p, opts) {
  var films = opts.films || [];
  var groups = opts.groups || [];
  var covers = [p.item].concat(p.alsoItems || []);
  // a plate against a group id covers every member of that group
  groups.forEach(function (g) {
    if (covers.indexOf(g.id) < 0) return;
    (g.items || []).forEach(function (it) {
      covers.push(typeof it === "string" ? it : it.item);
    });
  });
  var known = false;
  for (var i = 0; i < covers.length; i++) {
    var f = films.filter(function (x) { return x.item === covers[i]; })[0];
    if (!f) continue;
    known = true;
    if (!f.retiring) return true;
  }
  // nothing we hold is covered by it: not ours to decide, so never "not needed"
  return !known;
}

function plateOutlook(r, opts) {
  opts = opts || {};
  // a pooled row answers to its group id as well as to its members: one film, one plate
  var ids = (r.memberIds || []).concat([r.item]);
  var p = plateFor(ids, opts.plates);
  if (!p) return { state: "none", plate: null };

  var weeks = weeksUntil(p.expires, opts.asOf);
  var horizon = opts.plateHorizon != null ? opts.plateHorizon : 8;
  var needed = plateNeeded(p, opts);
  var base = { plate: p, weeks: weeks, needed: needed, dated: p.expires != null };

  // nothing will be printed from it again, so letting it lapse costs nothing
  if (!needed) return assign(base, { state: "not-needed" });

  // the register gives some expiries as "Expired" with no date: no date to count to,
  // but the renewal is just as due, so it is never reported as covered
  if (p.expired || (weeks != null && weeks <= 0)) return assign(base, { state: "expired" });
  if (weeks == null) return assign(base, { state: "undated" });

  // close enough that the charge lands whatever the film's own ordering does
  if (weeks <= horizon) return assign(base, { state: "lapsing" });

  // otherwise the thing a lapse would land on is the film's next order
  var t = timeline(r, opts);
  var order = t && t.orderByWeeks != null ? t.orderByWeeks : null;
  base.orderByWeeks = order;
  if (order != null && weeks < order) return assign(base, { state: "lapses-first" });
  return assign(base, { state: "ok" });
}

function assign(a, b) { for (var k in b) if (b.hasOwnProperty(k)) a[k] = b[k]; return a; }

/* Every plate, soonest first, with the weeks left and the item it belongs to.
   Undated expiries sort to the front: they are already due. */
function plateSchedule(opts) {
  var reg = (opts.plates && opts.plates.register) || [];
  return reg.map(function (p) {
    var weeks = weeksUntil(p.expires, opts.asOf);
    var expired = p.expired || (weeks != null && weeks <= 0);
    return { plate: p, weeks: weeks, expired: expired };
  }).sort(function (a, b) {
    var av = a.expired ? (a.weeks == null ? -1e9 : a.weeks) : a.weeks;
    var bv = b.expired ? (b.weeks == null ? -1e9 : b.weeks) : b.weeks;
    return av - bv;
  });
}


/* Film a co-packer holds is not in our position, so the coverage maths reads it as
   zero and asks for the lot. The ledger is the only record of it, so the question for
   a tracked film is not "what is our stock" but "does what they hold cover the window".
   Returns null for a film with no tracker, so callers can tell the two apart. */
function trackerCover(r, opts) {
  var ids = (r.memberIds || []).concat([r.item]);
  var tr = ((opts && opts.trackers) || []).filter(function (t) {
    return ids.indexOf(t.item) >= 0;
  })[0];
  if (!tr) return null;

  var led = runLedger(tr);
  var c = compute(r, opts);
  var need = num(c.rawNeed != null ? c.rawNeed : c.need);
  var balance = num(led.balance);
  return {
    tracker: tr, ledger: led, balance: balance, need: need,
    stale: led.stale,                       // nothing logged: we cannot say either way
    covers: !led.stale && balance >= need,
    shortfall: Math.max(0, need - balance)
  };
}

return { compute: compute, orderPlan: orderPlan, timeline: timeline,
         mergeGroup: mergeGroup, workingRows: workingRows, buildRate: buildRate,
         incomingSteps: incomingSteps, drawBetween: drawBetween, weeksOfCover: weeksOfCover,
         impressionBasis: impressionBasis, impressions: impressions,
         impressionNote: impressionNote, lossBuffer: lossBuffer,
         transitionRate: transitionRate,
         plateFor: plateFor, plateOutlook: plateOutlook, plateSchedule: plateSchedule,
         plateNeeded: plateNeeded, backupIdle: backupIdle,
         trackerCover: trackerCover, trackerRow: trackerRow,
         weeksUntil: weeksUntil,
         runLedger: runLedger, fmt: fmt, num: num };
});
