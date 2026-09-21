/* Film coverage dashboard — rendering only.
   Every number and every sentence comes from window.FILM_DATA, which the build
   script injects from data/<period>.json. Nothing here needs editing month to month. */
(function () {
"use strict";

var D        = window.FILM_DATA;
var META     = D.meta;
var FILMS    = D.films || [];
var TRANS    = D.transitions || [];
var WOLINES  = D.workOrderLines || [];
var SOLINES  = D.salesOrderLines || {};
var FCMONTHS = D.forecastMonths || {};
var FC_NOTE  = D.forecastNotes || {};
var NOFILM   = D.noFilmWorkOrders || [];

var ANCHOR    = new Date(META.asOf + "T00:00:00");
var BASE_LEAD = META.baseLeadWeeks || 16;

var state = {
  basis: "max",
  lead: META.defaultLeadWeeks || BASE_LEAD,
  them: true,
  quiet: false,
  focus: null,       // a status tile clicked: show only those films
  showRest: false,   // the covered / winding down / no demand rows, revealed
  allCols: false     // the full thirteen columns in the detail table
};

var fmt = window.FilmCoverage.fmt;
var dshort = function (wk) {
  var d = new Date(ANCHOR.getTime() + wk * 7 * 864e5);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
    (d.getFullYear() === ANCHOR.getFullYear() ? "" : " " + String(d.getFullYear()).slice(2));
};
var dstr = function (wk) {
  return new Date(ANCHOR.getTime() + wk * 7 * 864e5)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
var num = window.FilmCoverage.num;

var GLOSSARY = D.glossary || [];
var BASIS_LABEL = {
  wo: "work orders",
  so: "work orders and sales orders",
  plan: "orders plus the forecast",
  burn: "the recent build rate",
  max: "the worst-case basis"
};

/* term -> definition, so a status tag can explain itself on hover */
var DEFS = {};
GLOSSARY.forEach(function (g) {
  (g.terms || []).forEach(function (t) { DEFS[t.term.toLowerCase()] = t.def; });
});
function defOf(term) {
  var d = DEFS[String(term).toLowerCase()];
  return d ? " title=\"" + d.replace(/<[^>]+>/g, "").replace(/"/g, "&quot;") + "\"" : "";
}

/* ---------- tabs ---------- */

var GROUPS = D.substituteGroups || [];
var LINES = D.lines || [];
function OPTS() {
  return { basis: state.basis, lead: state.lead, baseLead: BASE_LEAD,
           films: FILMS, transitions: TRANS, salesOrderLines: SOLINES };
}
/* Two items that feed the same line are one buying decision, so the working views
   show the pool. The members keep their own rows in the data and in the drill-down. */
var ROWS = window.FilmCoverage.workingRows(FILMS, GROUPS, LINES);
var idsOf = function (r) { return r.memberIds || [r.item]; };
var TRACKERS = D.trackers || [];
var TRACKED = {};
TRACKERS.forEach(function (t) { TRACKED[t.item] = t; });
var TABS = ["coverage", "tracker", "reference"];
function showTab(name) {
  if (TABS.indexOf(name) < 0) name = "coverage";
  TABS.forEach(function (t) {
    document.getElementById("tab-" + t).hidden = (t !== name);
    document.getElementById("tab-btn-" + t).setAttribute("aria-selected", String(t === name));
  });
  try { history.replaceState(null, "", "#" + name); } catch (e) { /* file:// */ }
}

/* ---------- masthead, source panel, footer ---------- */

function renderStatic() {
  document.getElementById("title").innerHTML =
    META.title + "<span>" + META.subtitle + "</span>";

  var asofLines = [("Positions from NetSuite <b>" + META.asOfLabel + "</b>")]
    .concat(META.asOfLines || []);
  document.getElementById("asof").innerHTML = asofLines.join("<br>");

  var dh = document.getElementById("detailHead");
  dh.innerHTML = "Detail <em id=\"detailCount\"></em>" +
    "<button class=\"colbtn\" id=\"colToggle\" type=\"button\"></button>";
  document.getElementById("colToggle").addEventListener("click", function (e) {
    e.preventDefault();        // the button sits inside a <summary>
    e.stopPropagation();
    state.allCols = !state.allCols;
    render();
  });
  document.getElementById("sourcesHead").innerHTML =
    META.sourcesHeading + " <em>" + META.sourcesSub + "</em>";

  document.getElementById("sources").innerHTML = (D.sources || []).map(function (s) {
    return "<tr><td class=\"item\">" + s.column + "</td><td>" + s.source +
           "</td><td>" + s.firmness + "</td></tr>";
  }).join("");

  document.getElementById("sourceNotes").innerHTML = (D.sourceNotes || []).map(function (p, i) {
    return "<p style=\"margin:0 0 " + (i === (D.sourceNotes.length - 1) ? "0" : "10px") +
           ";font-size:13.5px;color:var(--muted);line-height:1.6\">" + p + "</p>";
  }).join("");

  document.getElementById("foot").innerHTML = META.footer;
  document.getElementById("lead").value = state.lead;
  document.title = META.title + " — " + (META.org || "Mighty Picnic");
}

/* status of a row, as one key the tiles and the filter both use */
function statusKey(c) { return c.quiet ? "quiet" : c.status; }

var TILES = [
  { key: "late",     label: "Past order-by", mark: "late" },
  { key: "watch",    label: "Order soon",    mark: "watch" },
  { key: "ok",       label: "Covered",      mark: "ok" },
  { key: "retiring", label: "Winding down", mark: "retiring" },
  { key: "quiet",    label: "No demand",    mark: "dormant" }
];

/* Counts across everything the other filters leave visible, so the numbers do not
   change when you click one. Clicking a tile narrows the bars and the table to it. */
function renderTiles(base) {
  var counts = {};
  base.forEach(function (x) {
    var k = statusKey(x.c);
    counts[k] = (counts[k] || 0) + 1;
  });

  document.getElementById("tiles").innerHTML = TILES.map(function (t) {
    var n = counts[t.key] || 0;
    var on = state.focus === t.key;
    return "<button class=\"tile\" type=\"button\" data-k=\"" + t.key + "\"" +
      " aria-pressed=\"" + on + "\"" + (n ? "" : " disabled") + defOf(t.label) + ">" +
      "<i style=\"background:var(--" + t.mark + "-mark)\"></i>" +
      "<span style=\"margin:0\"><b>" + n + "</b><span>" + t.label + "</span></span></button>";
  }).join("");

  var hint = document.getElementById("filterhint");
  if (state.focus) {
    var lab = TILES.filter(function (t) { return t.key === state.focus; })[0];
    hint.hidden = false;
    hint.innerHTML = "Showing only <strong>" + (lab ? lab.label.toLowerCase() : state.focus) +
      "</strong> films. <button type=\"button\" id=\"clearFocus\">Show all</button>";
    document.getElementById("clearFocus").addEventListener("click", function () {
      state.focus = null; render();
    });
  } else {
    hint.hidden = true;
    hint.innerHTML = "";
  }

  Array.prototype.forEach.call(document.querySelectorAll(".tile"), function (b) {
    b.addEventListener("click", function () {
      state.focus = state.focus === b.dataset.k ? null : b.dataset.k;
      state.showRest = false;
      render();
    });
  });
}

/* What to order — the first thing on the page, and the only panel that says "do this" */
function impsOf(r, qty) {
  var b = window.FilmCoverage.impressionBasis(r, OPTS());
  var n = window.FilmCoverage.impressions(qty, b);
  return n == null ? null : { text: "\u2248 " + fmt(n) + " impressions", basis: b };
}

function heldNote(r) {
  var t = idsOf(r).map(function (id) { return TRACKED[id]; }).filter(Boolean)[0];
  return t ? "held at " + t.heldBy + ", see Tracker" : "";
}

function renderActions() {
  var opts = OPTS();
  var HORIZON = 8;   // weeks: an order-by date further out than this is not this month's problem

  var mine = [];
  ROWS.forEach(function (r) {
    if (r.stockedBy !== "MP") return;
    var p = window.FilmCoverage.orderPlan(r, opts);
    if (!p || p.orderInWeeks > HORIZON) return;
    mine.push({ r: r, p: p });
  });
  mine.sort(function (a, b) { return a.p.orderInWeeks - b.p.orderInWeeks; });

  var theirs = ROWS.filter(function (r) {
    if (r.stockedBy !== "THEM") return false;
    var c = compute(r);
    return c.status === "late" || (c.status === "watch" && c.transfer > 0);
  });

  var panel = document.getElementById("orderPanel");
  var rows = mine.map(function (x) {
    var r = x.r, p = x.p;
    var col = "var(--" + (p.overdue ? "late" : "watch") + ")";
    var why = p.coverWeeks.toFixed(0) + " weeks of runway against a " + p.lead + "-week lead" +
      (p.gap < 0
        ? " — " + fmt(Math.abs(p.gap)) + " " + r.unit + " short of the " + fmt(p.need) +
          " that " + BASIS_LABEL[state.basis] + " needs"
        : " — " + Math.round(p.orderInWeeks) + " weeks of slack left");
    var inSteps = window.FilmCoverage.incomingSteps(r, opts);
    if (inSteps.steps.length) {
      why += ". <strong>" + inSteps.steps.map(function (st) {
        return "+" + fmt(st.rate) + " " + r.unit + "/wk from " + dshort(st.week) + " (item " + st.from + ")";
      }).join(", ") + "</strong> transfers onto it";
    }
    if (r.lineRole === "backup" && r.line) {
      why += ". <strong>Backup on " + r.line.name + "</strong> — ordered only when " +
             r.line.defaultItem + " will not arrive in time";
    }
    var held = idsOf(r).map(function (id) { return TRACKED[id]; }).filter(Boolean)[0];
    if (held) {
      why += ". <strong>" + held.heldBy + " hold this stock and it is not in our NetSuite " +
             "position</strong>, so check the Tracker tab before raising anything";
    }
    return "<div class=\"act\">" +
      "<div class=\"qty\" style=\"color:" + (held ? "var(--muted)" : col) + "\">" +
        fmt(p.qty) + " " + r.unit +
        "<small>" + (held ? "check tracker first" : p.rolls ? "\u2248 " + p.rolls + " rolls" : "suggested order") +
          (function () { var im = impsOf(r, p.qty); return im ? "<br>" + im.text : ""; })() +
        "</small></div>" +
      "<div class=\"what\">" + r.name + "<small>" +
        (r.members
          ? "raise it against <strong>" + r.orderItem.item + "</strong> \u00b7 pooled with " +
            r.memberIds.filter(function (id) { return id !== r.orderItem.item; }).join(", ")
          : "item " + r.item) +
        " \u00b7 " + why + "</small></div>" +
      "<div class=\"when\" style=\"color:" + col + "\">" +
        (p.overdue ? "Order now" : "By " + dstr(p.orderInWeeks)) +
        "<small>" + (p.overdue ? "already inside the " + p.lead + "-week lead"
                               : p.lead + "-week lead") + "</small></div>" +
      "</div>";
  }).join("");

  var theirRows = theirs.map(function (r) {
    var c = compute(r);
    return "<div class=\"act\">" +
      "<div class=\"qty\" style=\"color:var(--muted)\">THEM<small>not our order</small></div>" +
      "<div class=\"what\">" + r.name + "<small>item " + r.item + " \u00b7 " +
        (r.backordered ? fmt(r.backordered) + " " + r.unit + " backordered against released work orders"
                       : fmt(Math.abs(c.gap)) + " " + r.unit + " short") +
        ". " + (r.successor ? "Replaced by " + r.successor + "." : "THEM stock this one.") +
        "</small></div>" +
      "<div class=\"when\" style=\"color:var(--muted)\">Chase THEM<small>expedite, not a PO</small></div>" +
      "</div>";
  }).join("");

  if (!mine.length && !theirs.length) {
    panel.classList.add("clear");
    document.getElementById("acts").innerHTML =
      "<p class=\"act-none\"><b>Nothing to order.</b> No film we buy needs an order inside the next " +
      HORIZON + " weeks on this basis.</p>";
    return;
  }
  panel.classList.toggle("clear", !mine.length);
  document.getElementById("acts").innerHTML = rows + theirRows;
}

/* Consignment: film we bought that somebody else holds and manages. It is not in our
   NetSuite on-hand, so nothing upstream of this panel knows about it. */
function renderTrackers() {
  var el = document.getElementById("trackers");
  if (!el) return;
  var btn = document.getElementById("tab-btn-tracker");
  if (btn) btn.hidden = !TRACKERS.length;
  if (!TRACKERS.length) { el.innerHTML = ""; return; }

  el.innerHTML = TRACKERS.map(function (t) {
    var L = window.FilmCoverage.runLedger(t);
    var head = "<h2>" + t.name + " at " + t.heldBy +
      (t.ownedBy ? " <em>" + t.ownedBy + "</em>" : "") + "</h2>";
    var purpose = t.purpose ? "<p class=\"tracknote\">" + t.purpose + "</p>" : "";

    if (L.stale) {
      return "<section class=\"panel\">" + head + purpose +
        "<div class=\"stats\">" +
        "<div class=\"stat\"><b style=\"color:var(--faint)\">—</b><span>they hold now</span></div>" +
        "<div class=\"stat\"><b style=\"color:var(--faint)\">—</b><span>used a week</span></div>" +
        "<div class=\"stat\"><b style=\"color:var(--faint)\">—</b><span>cover</span></div></div>" +
        "<div class=\"ledger scroll\"><table>" +
        "<thead><tr><th>Date</th><th>What happened</th><th>Reference</th>" +
        "<th class=\"n\">In</th><th class=\"n\">Out</th><th class=\"n\">Balance</th></tr></thead>" +
        "<tbody><tr><td colspan=\"6\" class=\"empty-row\">" +
        "The log is empty. It fills from two things: each delivery into " + t.heldBy +
        ", and each shipment that consumed film — a date, a quantity and a PO or " +
        "shipment reference for each. A count " + t.heldBy + " report is welcome too, and " +
        "overrides the running balance. Send those over and they go straight in; the " +
        "balance, the weekly usage and the weeks of cover are all worked out from them." +
        "</td></tr></tbody></table></div></section>";
    }

    var col = L.low ? "var(--late)" : L.coverWeeks !== null && L.coverWeeks < 6 ? "var(--watch)" : "var(--ok)";
    var dry = L.coverWeeks === null ? null
      : new Date(new Date(L.lastDate + "T00:00:00").getTime() + L.coverWeeks * 7 * 864e5)
          .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

    var stats = "<div class=\"stats\">" +
      "<div class=\"stat\"><b style=\"color:" + col + "\">" + fmt(L.balance) + " " + t.unit +
        "</b><span>they hold now</span></div>" +
      "<div class=\"stat\"><b>" + (L.weeklyUsage > 0 ? fmt(L.weeklyUsage) + " " + t.unit : "—") +
        "</b><span>" + (L.weeklyUsage > 0
          ? "a week, from " + L.shipments + " shipment" + (L.shipments > 1 ? "s" : "") +
            " over " + L.usageWeeks.toFixed(0) + " wks"
          : "used a week — no shipments logged") + "</span></div>" +
      "<div class=\"stat\"><b style=\"color:" + col + "\">" +
        (L.coverWeeks === null ? "—" : L.coverWeeks.toFixed(1) + " wks") +
        "</b><span>" + (dry ? "runs out " + dry : "cover") + "</span></div>" +
      "<div class=\"stat\"><b>" + fmt(L.received) + " " + t.unit + "</b><span>received in total</span></div>" +
      "<div class=\"stat\"><b>" + fmt(L.used) + " " + t.unit + "</b><span>used in total</span></div>" +
      "</div>";

    var body = L.rows.slice().reverse().map(function (x) {
      var e = x.entry, isCount = e.type === "count";
      var what = isCount ? "Count reported by " + t.heldBy
               : e.type === "received" ? "Received"
               : e.type === "used" ? "Used" : "Adjustment";
      return "<tr" + (isCount ? " class=\"count\"" : "") + ">" +
        "<td>" + new Date(e.date + "T00:00:00").toLocaleDateString("en-GB",
          { day: "numeric", month: "short", year: "numeric" }) + "</td>" +
        "<td>" + what + (e.note ? " <span class=\"est\">" + e.note + "</span>" : "") + "</td>" +
        "<td>" + (e.ref || "\u2014") + "</td>" +
        "<td class=\"in\">" + (x.delta > 0 ? "+" + fmt(x.delta) : "") + "</td>" +
        "<td class=\"out\">" + (x.delta < 0 ? "\u2212" + fmt(-x.delta) : "") + "</td>" +
        "<td class=\"bal\">" + fmt(x.balance) + " " + t.unit + "</td></tr>";
    }).join("");

    var table = "<div class=\"ledger scroll\"><table>" +
      "<thead><tr><th>Date</th><th>What happened</th><th>Reference</th>" +
      "<th class=\"n\">In</th><th class=\"n\">Out</th><th class=\"n\">Balance</th></tr></thead>" +
      "<tbody>" + body + "</tbody></table></div>";

    return "<section class=\"panel\">" + head + purpose + stats + table + "</section>";
  }).join("");
}

function renderGlossary() {
  var el = document.getElementById("glossary");
  if (!el) return;
  el.innerHTML = GLOSSARY.map(function (g) {
    return "<div class=\"note\"><h3>" + g.group + "</h3>" +
      (g.terms || []).map(function (t) {
        return "<p><strong>" + t.term + "</strong> — " + t.def + "</p>";
      }).join("") + "</div>";
  }).join("");
}

function renderNotes() {
  document.getElementById("notes").innerHTML = (D.notes || []).map(function (n) {
    var body = (n.body || []).map(function (b) {
      if (Array.isArray(b)) {
        return "<ul>" + b.map(function (li) { return "<li>" + li + "</li>"; }).join("") + "</ul>";
      }
      return "<p>" + b + "</p>";
    }).join("");
    var table = "";
    if (n.table === "noFilmWorkOrders" && NOFILM.length) {
      table = "<table class=\"dt\">" + NOFILM.map(function (w) {
        return "<tr><td>" + w.wo + "</td><td>" + w.date + "</td><td>" + w.product +
               "</td><td class=\"n\">" + w.qty + "</td></tr>";
      }).join("") + "</table>";
    }
    return "<div class=\"note" + (n.flag ? " flag" : "") + "\"><h3>" + n.title + "</h3>" +
           body + table + "</div>";
  }).join("");
}

/* ---------- printed film in transition to blank ---------- */

function capPos(p) {
  if (p < 11) return "left:0;transform:none";
  if (p > 89) return "right:0;left:auto;transform:none";
  return "left:" + p + "%";
}

function renderTrans() {
  var live = TRANS.filter(function (t) { return num(t.weeklyRate) > 0; });
  var span = Math.max.apply(null, [46].concat(live.map(function (t) {
    return num(t.onHand) / num(t.weeklyRate);
  }))) * 1.06;

  var overdue = TRANS.filter(function (t) {
    var rate = num(t.weeklyRate);
    return rate > 0 && (num(t.onHand) / rate) - state.lead <= 0;
  }).length;
  document.getElementById("transHead").innerHTML = META.transitionsHeading +
    " <em>" + TRANS.length + " printed films being run out" +
    (overdue ? " \u00b7 " + overdue + " already past the switch-by date" : "") + "</em>";

  document.getElementById("trans").innerHTML =
    "<p class=\"dnone\" style=\"padding:12px 0 2px\">" + META.transitionsSub + "</p>" +
    TRANS.map(function (t) {
    var rate = num(t.weeklyRate);
    var head = "<div class=\"thead\"><b>" + t.name + "</b>" +
      "<span class=\"who " + (t.stockedBy === "MP" ? "mp" : "") + "\">" +
        (t.stockedBy === "MP" ? "we buy it" : "THEM stock it") + "</span>" +
      "<span class=\"qty\">item " + t.item + " &middot; " + fmt(num(t.onHand)) + " " + t.unit +
        " on hand" + (rate > 0 ? " &middot; " + fmt(rate) + " " + t.unit + "/wk from " + t.rateBasis : "") +
      "</span></div>";

    var foot = "<div class=\"tfoot\"><div>Replaced by <strong>" + t.successor + "</strong>" +
      (!t.buyer || t.buyer === "—" ? "" : ", bought by " + t.buyer) +
      (t.decided ? " — settled" : "") + ".</div><div>" + t.bomAction + "</div></div>";

    if (rate <= 0) {
      var col = t.stranded ? "var(--dormant)" : t.holding ? "var(--ok)" : "var(--watch)";
      var label = t.stranded ? "no draw — nothing left using it"
                : t.holding ? "no draw yet — printed stock that can be run down first"
                            : "no draw right now, and the switch is not made";
      return "<div class=\"tline\">" + head +
        "<div class=\"rail\"><div class=\"base\"></div>" +
        "<div class=\"cap\" style=\"left:0;transform:none;color:" + col + "\"><b>" + label + "</b></div></div>" +
        foot + "</div>";
    }

    var run = num(t.onHand) / rate, sw = run - state.lead;
    var overdue = sw <= 0;
    var key = overdue ? "late" : sw < 12 ? "watch" : "ok";
    var c = "var(--" + key + ")";              // text
    var cMark = "var(--" + key + "-mark)";     // the rail fill
    var runPct = Math.min(100, (run / span) * 100);
    var swPct = Math.max(0, Math.min(100, (sw / span) * 100));
    return "<div class=\"tline\">" + head +
      "<div class=\"rail\"><div class=\"base\"></div>" +
      "<div class=\"run\" style=\"left:0;width:" + Math.max(runPct, 1) + "%;background:" + cMark + ";opacity:.5\"></div>" +
      (overdue ? "" :
        "<div class=\"pin sw\" style=\"left:" + swPct + "%\"></div>" +
        "<div class=\"cap\" style=\"" + capPos(swPct) + "\">switch by <b>" + dstr(sw) + "</b></div>") +
      "<div class=\"pin\" style=\"left:" + runPct + "%\"></div>" +
      "<div class=\"cap\" style=\"" + capPos(runPct) + ";color:" + c + "\">runs dry <b>" + dstr(run) + "</b></div>" +
      "</div>" + foot + "</div>";
  }).join("");
}

/* ---------- coverage maths ---------- */
/* The maths itself lives in src/coverage.cjs so the build script can print the
   same figures. This only supplies the current control settings. */

function compute(r) {
  return window.FilmCoverage.compute(r, OPTS());
}

function visible() {
  return ROWS
    .filter(function (r) { return state.them || r.stockedBy !== "THEM"; })
    .map(function (r) { return { r: r, c: compute(r) }; })
    .filter(function (x) { return state.quiet || !x.c.quiet; })
    .filter(function (x) { return !state.focus || statusKey(x.c) === state.focus; })
    .sort(function (a, b) {
      if (a.c.quiet !== b.c.quiet) return a.c.quiet ? 1 : -1;
      return (a.c.spare == null ? 9e9 : a.c.spare) - (b.c.spare == null ? 9e9 : b.c.spare);
    });
}

/* ---------- main render ---------- */

function render() {
  renderActions();
  renderTrans();
  // Tile counts ignore the tile filter and the no-demand checkbox, so the numbers on the
  // tiles are the month's real totals and do not move when you click one.
  var focus = state.focus, quiet = state.quiet;
  state.focus = null; state.quiet = true;
  var base = visible();
  state.focus = focus; state.quiet = quiet;
  renderTiles(base);

  // clicking the no-demand tile reveals those rows whatever the checkbox says
  if (state.focus === "quiet") state.quiet = true;
  var rows = visible();
  state.quiet = quiet;
  var late = base.filter(function (x) { return x.c.status === "late"; });
  var lateMine = late.filter(function (x) { return x.r.stockedBy === "MP"; });
  var winding = base.filter(function (x) { return x.c.status === "retiring"; });
  var watch = base.filter(function (x) { return x.c.status === "watch"; });

  document.getElementById("horizon").textContent =
    new Date(ANCHOR.getTime() + state.lead * 7 * 864e5)
      .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  var v = document.getElementById("verdict"), p = v.querySelector("p");
  var pastDue = base.filter(function (x) {
    return x.r.stockedBy === "MP" && x.c.status === "late";
  });
  var soon = base.filter(function (x) { return x.c.status === "watch"; });
  if (pastDue.length) {
    v.classList.remove("clear");
    var names = pastDue.slice(0, 3).map(function (x) { return x.r.name.split(" —")[0]; }).join(", ");
    p.innerHTML = "<strong>" + pastDue.length + " film" + (pastDue.length > 1 ? "s we buy are" : " we buy is") +
      " past the date an order could still land in time.</strong>" +
      "<span class=\"sub\">" + names + (pastDue.length > 3 ? " and " + (pastDue.length - 3) + " more" : "") + ". " +
      soon.length + " more inside " + Math.round(state.lead * 0.2) + " weeks of their order-by date, " +
      winding.length + " winding down.</span>";
  } else {
    v.classList.add("clear");
    var next = base.map(function (x) { return { r: x.r, t: window.FilmCoverage.timeline(x.r, OPTS()) }; })
      .filter(function (x) { return x.t.orderByWeeks != null && x.r.stockedBy === "MP"; })
      .sort(function (a, b) { return a.t.orderByWeeks - b.t.orderByWeeks; })[0];
    p.innerHTML = "<strong>Nothing we buy is past its order-by date.</strong>" +
      "<span class=\"sub\">" +
      (next ? "Next is <strong>" + next.r.name.split(" —")[0] + "</strong>, by " +
              dshort(next.t.orderByWeeks) + ". " : "") +
      soon.length + " inside " + Math.round(state.lead * 0.2) + " weeks of theirs, " +
      winding.length + " winding down. Switch the demand basis to stress-test.</span>";
  }

  /* A runway, not a ratio: each film's bar runs from today to the day it runs dry, with
     a pin at the last date an order can be placed and still land in time. The vertical
     rule is today plus the lead time — a bar ending left of it cannot be saved by
     ordering now. */
  var TL = window.FilmCoverage.timeline;
  var opts = OPTS();
  var tl = rows.map(function (x) { return { r: x.r, c: x.c, t: TL(x.r, opts) }; });

  var covers = tl.map(function (x) { return x.t.coverWeeks; })
                 .filter(function (v) { return v != null && isFinite(v); });
  // twice the lead time is the decision window: far enough to see the next order coming,
  // near enough that the bars are readable. Anything longer is clipped and labelled.
  var span = Math.max(state.lead * 2, 26);
  if (covers.length) {
    span = Math.min(span, Math.max(Math.max.apply(null, covers) * 1.08, state.lead * 1.35));
  }
  span = Math.ceil(span);
  var pctOf = function (w) { return Math.max(0, Math.min(100, (w / span) * 100)); };

  var marks = [], mk = new Date(ANCHOR.getFullYear(), ANCHOR.getMonth() + 1, 1);
  while (((mk - ANCHOR) / (7 * 864e5)) <= span) {
    marks.push({ wk: (mk - ANCHOR) / (7 * 864e5),
                 label: mk.toLocaleDateString("en-GB", { month: "short" }) +
                        (mk.getMonth() === 0 ? " " + String(mk.getFullYear()).slice(2) : "") });
    mk = new Date(mk.getFullYear(), mk.getMonth() + 1, 1);
  }
  var gridlines = marks.map(function (m) {
    return "<span class=\"gl\" style=\"left:" + pctOf(m.wk) + "%\"></span>";
  }).join("");

  /* sorted by the decision: the order you have to place soonest comes first */
  tl.sort(function (a, b) {
    var av = a.t.orderByWeeks, bv = b.t.orderByWeeks;
    if (av == null && bv == null) return (a.t.coverWeeks || 9e9) - (b.t.coverWeeks || 9e9);
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv;
  });

  function runway(x) {
    var r = x.r, c = x.c, t = x.t;
    var sub = (r.members ? r.memberIds.join(" + ") : r.item) + " · " +
              (r.stockedBy === "THEM" ? "THEM-stocked" : "Lamick, we buy") +
              (r.note ? " · " + r.note : "");
    var nm = "<div class=\"nm\">" + r.name + (r.members ? " <b>pooled</b>" : "") +
             "<small>" + sub + "</small></div>";
    var leadPct = pctOf(state.lead);
    var frame = "<div class=\"track tl\">" + gridlines +
                "<span class=\"leadline\" style=\"left:" + leadPct + "%\"></span>";

    if (t.coverWeeks == null) {
      return "<div class=\"bar" + (r.members ? " grouprow" : "") + "\">" + nm + frame + "</div>" +
        "<div class=\"val\" style=\"color:var(--dormant)\">no demand<small>" +
        fmt(num(r.onHand)) + " " + r.unit + " held</small></div></div>";
    }

    var col = "var(--" + t.status + "-mark)";
    var txt = "var(--" + t.status + ")";
    var clipped = t.coverWeeks > span;
    var bar = "<span class=\"run" + (clipped ? " clip" : "") + "\" style=\"width:" +
              pctOf(t.coverWeeks) + "%;background:" + col + "\"></span>";
    var pin = t.orderByWeeks == null ? ""
      : t.orderByWeeks <= 0
        ? "<span class=\"pin order overdue\"></span>"
        : "<span class=\"pin order\" style=\"left:" + pctOf(t.orderByWeeks) + "%\"></span>";

    var dry = clipped ? "lasts past " + dshort(span) : "runs dry " + dshort(t.coverWeeks);
    var when = t.orderByWeeks == null
      ? (r.retiring ? "not reordered" : "—")
      : t.orderByWeeks <= 0 ? "order now"
      // a date two years out is arithmetic, not a plan
      : t.orderByWeeks > span ? "not yet"
      : "order by " + dshort(t.orderByWeeks);

    return "<div class=\"bar" + (r.members ? " grouprow" : "") + "\">" + nm +
      frame + bar + pin + "</div>" +
      "<div class=\"val\" style=\"color:" + txt + "\">" + when +
      "<small><em>" + dry + "</em></small></div></div>";
  }

  /* Only short and tight need a decision. The rest stay one click away rather than
     filling four screens with rows nobody has to act on. */
  var needsEye = tl.filter(function (x) { return x.c.status === "late" || x.c.status === "watch"; });
  var rest = tl.filter(function (x) { return x.c.status !== "late" && x.c.status !== "watch"; });
  var split = !state.focus && !state.showRest && needsEye.length > 0 && rest.length > 0;
  var shown = split ? needsEye : tl;

  document.getElementById("bars").innerHTML = shown.map(runway).join("") +
    (split
      ? "<button class=\"more\" type=\"button\" id=\"showRest\">Show " + rest.length +
        " more — covered, winding down and no demand</button>"
      : "");

  if (split) {
    document.getElementById("showRest").addEventListener("click", function () {
      state.showRest = true; render();
    });
  }

  document.getElementById("ticks").innerHTML =
    marks.map(function (m) {
      var at = pctOf(m.wk);
      // the lead rule owns its slot; a month label landing under it would collide
      if (Math.abs(at - pctOf(state.lead)) < 4) return "";
      return "<span style=\"left:" + at + "%\">" + m.label + "</span>";
    }).join("") +
    "<span class=\"lead\" style=\"left:" + pctOf(state.lead) + "%\">\u25b2 " +
      state.lead + "-week lead</span>";

  /* Six columns answer the question; the other seven are the working out. */
  var NARROW = ["Film", "Stock", "Demand in the window", "Runway", "Order by", "Order", "Status"];
  var WIDE = ["Film", "Stocked by", "On hand", "On order", "Committed", "Backordered",
              "On work orders", "SOs not yet WO'd", "Forecast beyond", "Build rate",
              "Free position", "Suggested order", "Status"];
  var cols = state.allCols ? WIDE : NARROW;
  document.getElementById("detail").className = state.allCols ? "wide" : "";
  document.getElementById("colToggle").textContent =
    state.allCols ? "Fewer columns" : "Every column";
  document.getElementById("detailCount").textContent =
    rows.length + (state.focus ? " films in this filter" : " films") + ", every figure behind them";
  document.getElementById("thead").innerHTML = "<tr>" + cols.map(function (h, i) {
    var numeric = i > 0 && i < cols.length - 1 && h !== "Stocked by";
    return "<th" + (i === 0 ? " class=\"stick\"" : numeric ? " class=\"n\"" : "") + ">" + h + "</th>";
  }).join("") + "</tr>";

  document.getElementById("tbody").innerHTML = rows.map(function (x) {
    var r = x.r, c = x.c;
    var label = c.quiet ? "No demand"
      : c.status === "retiring" ? "Winding down"
      : c.status === "late" ? (r.stockedBy === "THEM" ? "THEM to order" : "Order now")
      : c.status === "watch" ? "Order soon" : "Covered";
    var cls = c.quiet ? "dormant" : c.status === "retiring" ? "retiring"
      : c.status === "late" ? "late" : c.status === "watch" ? "watch" : "ok";
    var tag = "<span class=\"tag t-" + cls + "\"" + defOf(label) + ">" + label + "</span>";
    var scale = (r.leadWeeks != null ? r.leadWeeks : state.lead) / BASE_LEAD;

    var wideRow =
      "<td class=\"item\">" + r.name + "<small>item " + r.item + (r.note ? " · " + r.note : "") + "</small></td>" +
      "<td>" + (r.stockedBy === "THEM" ? "THEM (Maruto)" : "MP (Lamick)") + "</td>" +
      "<td class=\"n\">" + fmt(num(r.onHand)) + " " + r.unit +
        (function () { var im = impsOf(r, num(r.onHand)); return im ? "<small>" + im.text + "</small>" : ""; })() + "</td>" +
      "<td class=\"n\">" + (r.onOrder ? fmt(r.onOrder) : "—") + "</td>" +
      "<td class=\"n\">" + (r.committed ? fmt(r.committed) : "—") + "</td>" +
      "<td class=\"n\" style=\"" + (r.backordered ? "color:var(--late);font-weight:600" : "") + "\">" +
        (r.backordered ? fmt(r.backordered) : "—") + "</td>" +
      "<td class=\"n\">" + (r.onWorkOrders ? fmt(r.onWorkOrders) : "—") + "</td>" +
      "<td class=\"n\">" + (r.soNotYetWO ? fmt(r.soNotYetWO) : "—") + "</td>" +
      "<td class=\"n\">" + (r.forecastBeyond ? fmt(r.forecastBeyond * scale) : "—") + "</td>" +
      "<td class=\"n\">" + (c.burnNeed ? fmt(c.burnNeed) : "—") + "</td>" +
      "<td class=\"n\" style=\"color:" + (c.quiet ? "inherit" : "var(--" + c.status + ")") + "\">" +
        (c.quiet ? "—" : c.status === "retiring" && c.transfer > 0 ? "→ " + fmt(c.transfer)
          : (c.gap < 0 ? "−" : "+") + fmt(Math.abs(c.gap))) + "</td>" +
      "<td class=\"n\">" + (c.order && r.stockedBy === "MP" ? fmt(c.order) + " " + r.unit : "—") + "</td>" +
      "<td>" + tag + "</td>";

    var demand = c.quiet ? null : (c.rawNeed != null ? c.rawNeed : c.need);
    var tRow = window.FilmCoverage.timeline(r, OPTS());
    var narrowRow =
      "<td class=\"item\">" + r.name + "<small>" +
        (r.members ? r.memberIds.join(" + ") : "item " + r.item) + " · " +
        (r.stockedBy === "THEM" ? "THEM (Maruto)" : "MP (Lamick)") +
        (r.note ? " · " + r.note : "") +
        (heldNote(r) ? " · " + heldNote(r) : "") + "</small></td>" +
      "<td class=\"n\">" + fmt(c.stock) + " " + r.unit +
        (function () { var im = impsOf(r, c.stock); return im ? "<small>" + im.text + "</small>" : ""; })() + "</td>" +
      "<td class=\"n\">" + (demand ? fmt(demand) + " " + r.unit : "—") + "</td>" +
      "<td class=\"n\">" + (tRow.coverWeeks == null ? "—"
        : tRow.coverWeeks.toFixed(0) + " wks") + "</td>" +
      "<td class=\"n\" style=\"color:" + (c.quiet ? "inherit" : "var(--" + c.status + ")") + "\">" +
        (tRow.orderByWeeks == null ? (r.retiring ? "not reordered" : "—")
          : tRow.orderByWeeks <= 0 ? "overdue" : dshort(tRow.orderByWeeks)) + "</td>" +
      "<td class=\"n\">" + (c.order && r.stockedBy === "MP" ? fmt(c.order) + " " + r.unit : "—") + "</td>" +
      "<td>" + tag + "</td>";

    var head = "<tr class=\"head\" data-id=\"" + r.item + "\">" +
      (state.allCols ? wideRow : narrowRow) + "</tr>";

    var lines = WOLINES.filter(function (l) { return l.film === r.item; });
    var woHtml = lines.length
      ? "<h4>On open work orders — " + fmt(num(r.onWorkOrders)) + " " + r.unit + " across " +
          lines.length + " line" + (lines.length > 1 ? "s" : "") + "</h4>" +
        "<table class=\"dt\">" + lines.map(function (l) {
          return "<tr><td>" + l.wo + "</td><td>" + l.date + "</td><td>" + l.status + "</td><td>" + l.product +
            "</td><td class=\"n\">" + fmt(l.qty) + " " + r.unit + "</td>" +
            "<td class=\"n " + (l.backordered ? "bo" : "") + "\">" +
            (l.backordered ? fmt(l.backordered) + " short" : "") + "</td></tr>";
        }).join("") + "</table>"
      : "<h4>On open work orders</h4><p class=\"dnone\">None — nothing released against this film yet.</p>";

    var sol = SOLINES[r.item] || [];
    var soTot = sol.reduce(function (a, s) { return a + num(s.filmQty); }, 0);
    var soHtml = sol.length
      ? "<h4>Open sales orders — " + fmt(soTot) + " " + r.unit + " of demand" +
          (r.soNotYetWO ? "" : ", all of it already covered by the work orders above") + "</h4>" +
        "<table class=\"dt\">" + sol.map(function (s) {
          return "<tr><td>" + s.product + "</td><td>" + s.customer + "</td>" +
            "<td class=\"n\">" + Number(s.units).toLocaleString() + " u</td>" +
            "<td>due " + s.due + "</td><td>" + s.orders + " SO" + (s.orders > 1 ? "s" : "") + "</td>" +
            "<td class=\"n\">" + fmt(s.filmQty) + " " + r.unit + "</td></tr>";
        }).join("") +
        (r.soNotYetWO ? "<tr><td colspan=\"6\" style=\"padding-top:6px\">" + fmt(r.soNotYetWO) + " " +
          r.unit + " of this has no work order raised yet.</td></tr>" : "") + "</table>"
      : "<h4>Open sales orders</h4><p class=\"dnone\">None on this film.</p>";

    var imDrill = (function () {
      var b = window.FilmCoverage.impressionBasis(r, OPTS());
      if (!b) {
        return "<h4>Estimated impressions</h4><p class=\"dnone\">No basis for this film \u2014 " +
          "it has no open sales orders to read a pack size from, and none is stated. " +
          "Add <b>filmPerImpression</b> to the film, or leave it blank rather than guess.</p>";
      }
      var st = window.FilmCoverage.impressions(c.stock, b);
      var nd = c.quiet ? null : window.FilmCoverage.impressions(c.rawNeed != null ? c.rawNeed : c.need, b);
      return "<h4>Estimated impressions</h4><p class=\"dnone\">" +
        "At <b>" + b.per.toFixed(b.per < 1 ? 4 : 2) + " " + r.unit + "</b> an impression (" + b.source + "), " +
        "the " + fmt(c.stock) + " " + r.unit + " in hand and on order is about <b>" + fmt(st) + " impressions</b>" +
        (nd ? ", against " + fmt(nd) + " of demand over the window" : "") + ".</p>";
    })();

    var nlHtml = r.nextInLineNote
      ? "<h4>Next in line — not drawn yet</h4><p class=\"dnone\">" + r.nextInLineNote + "</p>" : "";

    var rtHtml = r.retiring
      ? "<h4>Being run out, not reordered</h4><p class=\"dnone\">Replaced by " + r.successor + "." +
        (c.transfer > 0
          ? " Demand beyond the " + fmt(c.stock) + " " + r.unit + " left — about <b>" +
            fmt(c.transfer) + " " + r.unit + "</b> — transfers there rather than being ordered here."
          : " Stock in hand covers the window, so nothing transfers yet.") + "</p>"
      : "";

    var nbHtml = r.noBom
      ? "<h4>Not on any bill of materials</h4><p class=\"dnone\">No revision points at this item, so nothing will consume it until a BOM is repointed.</p>"
      : "";

    var fcm = FCMONTHS[r.item] || [];
    var fcHtml = fcm.length
      ? "<h4>On the FILM plan" + (r.forecastBeyond
          ? " — " + fmt(r.forecastBeyond * scale) + " " + r.unit + " beyond the orders"
          : ", entirely covered by the orders above") + "</h4>" +
        "<table class=\"dt\">" + fcm.map(function (m) {
          return "<tr><td>" + m.month + "</td><td class=\"n\">" + m.qty + "</td></tr>";
        }).join("") + "</table>"
      : "<h4>On the FILM plan</h4><p class=\"dnone\">" + (FC_NOTE[r.item] ||
          ("No row for this film on the FILM tab" +
           (r.weeklyBuildRate ? " — yet it is being consumed, so the plan has a gap" : "") + ".")) + "</p>";

    return head + "<tr class=\"drill\" data-for=\"" + r.item + "\" hidden><td colspan=\"" + cols.length + "\">" +
      "<div class=\"drillbox\">" + nlHtml + rtHtml + woHtml + soHtml + fcHtml + imDrill + nbHtml + "</div></td></tr>";
  }).join("");

  Array.prototype.forEach.call(document.querySelectorAll("tbody tr.head"), function (tr) {
    tr.addEventListener("click", function () {
      var d = document.querySelector("tr.drill[data-for=\"" + tr.dataset.id + "\"]");
      if (!d) return;
      d.hidden = !d.hidden;
      tr.classList.toggle("open", !d.hidden);
    });
  });
}

/* ---------- controls ---------- */

Array.prototype.forEach.call(document.querySelectorAll(".seg"), function (seg) {
  seg.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    Array.prototype.forEach.call(seg.querySelectorAll("button"), function (x) {
      x.setAttribute("aria-pressed", String(x === b));
    });
    state.basis = b.dataset.v;
    render();
  });
});
document.getElementById("lead").addEventListener("input", function (e) {
  var v = parseInt(e.target.value, 10);
  state.lead = isFinite(v) ? Math.max(1, Math.min(52, v)) : BASE_LEAD;
  render();
});
document.getElementById("showThem").addEventListener("change", function (e) {
  state.them = e.target.checked; render();
});
document.getElementById("showQuiet").addEventListener("change", function (e) {
  state.quiet = e.target.checked; render();
});

Array.prototype.forEach.call(document.querySelectorAll(".tabs button"), function (b) {
  b.addEventListener("click", function () { showTab(b.dataset.tab); });
});
window.addEventListener("hashchange", function () { showTab(location.hash.slice(1)); });

renderStatic();
renderNotes();
renderGlossary();
renderTrackers();
render();
showTab(location.hash.slice(1) || "coverage");
})();
