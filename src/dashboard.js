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
  quiet: false
};

var fmt = window.FilmCoverage.fmt;
var dstr = function (wk) {
  return new Date(ANCHOR.getTime() + wk * 7 * 864e5)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
var num = window.FilmCoverage.num;

/* ---------- masthead, source panel, footer ---------- */

function renderStatic() {
  document.getElementById("title").innerHTML =
    META.title + "<span>" + META.subtitle + "</span>";

  var asofLines = [("Positions from NetSuite <b>" + META.asOfLabel + "</b>")]
    .concat(META.asOfLines || []);
  document.getElementById("asof").innerHTML = asofLines.join("<br>");

  document.getElementById("transHead").innerHTML =
    META.transitionsHeading + " <em>" + META.transitionsSub + "</em>";
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

  document.getElementById("trans").innerHTML = TRANS.map(function (t) {
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
  return window.FilmCoverage.compute(r, {
    basis: state.basis, lead: state.lead, baseLead: BASE_LEAD
  });
}

function visible() {
  return FILMS
    .filter(function (r) { return state.them || r.stockedBy !== "THEM"; })
    .map(function (r) { return { r: r, c: compute(r) }; })
    .filter(function (x) { return state.quiet || !x.c.quiet; })
    .sort(function (a, b) {
      if (a.c.quiet !== b.c.quiet) return a.c.quiet ? 1 : -1;
      return (a.c.headroom == null ? 9e9 : a.c.headroom) - (b.c.headroom == null ? 9e9 : b.c.headroom);
    });
}

/* ---------- main render ---------- */

function render() {
  renderTrans();
  var rows = visible();
  var late = rows.filter(function (x) { return x.c.status === "late"; });
  var lateMine = late.filter(function (x) { return x.r.stockedBy === "MP"; });
  var winding = rows.filter(function (x) { return x.c.status === "retiring"; });
  var watch = rows.filter(function (x) { return x.c.status === "watch"; });

  document.getElementById("horizon").textContent =
    new Date(ANCHOR.getTime() + state.lead * 7 * 864e5)
      .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  var v = document.getElementById("verdict"), p = v.querySelector("p");
  if (lateMine.length) {
    v.classList.remove("clear");
    var names = lateMine.slice(0, 3).map(function (x) { return x.r.name.split(" —")[0]; }).join(", ");
    p.innerHTML = "<strong>" + lateMine.length + " film" +
      (lateMine.length > 1 ? "s we buy run" : " we buy runs") + " out before a new order could land.</strong>" +
      "<span class=\"sub\">" + names + (lateMine.length > 3 ? " and " + (lateMine.length - 3) + " more" : "") + ". " +
      (late.length - lateMine.length) + " more on THEM's side, " + watch.length +
      " with under a fifth in headroom, " + winding.length + " winding down.</span>";
  } else {
    v.classList.add("clear");
    p.innerHTML = "<strong>Nothing we buy runs out inside the " + state.lead +
      "-week window on this basis.</strong>" +
      "<span class=\"sub\">" + watch.length + " with under a fifth in headroom, " + winding.length +
      " winding down. Switch the demand basis to stress-test.</span>";
  }

  var hs = rows.filter(function (x) { return !x.c.quiet; })
    .map(function (x) { return Math.max(-1.2, Math.min(3, x.c.headroom)); });
  var lo = Math.min.apply(null, [-1.2].concat(hs));
  var hi = Math.max.apply(null, [1.5].concat(hs));
  var pct = function (h) { return ((Math.min(Math.max(h, lo), hi) - lo) / (hi - lo)) * 100; };
  var zero = pct(0);

  document.getElementById("bars").innerHTML = rows.map(function (x) {
    var r = x.r, c = x.c;
    var sub = r.item + " · " + (r.stockedBy === "THEM" ? "THEM-stocked" : "Lamick, we buy") +
              (r.note ? " · " + r.note : "");
    if (c.quiet) {
      return "<div class=\"bar\"><div class=\"nm\">" + r.name + "<small>" + sub + "</small></div>" +
        "<div class=\"track\"><span class=\"zero\" style=\"left:" + zero + "%\"></span></div>" +
        "<div class=\"val\" style=\"color:var(--dormant)\">no demand<small>" +
        fmt(num(r.onHand)) + " " + r.unit + " held</small></div></div>";
    }
    var a = Math.min(zero, pct(c.headroom)), b = Math.max(zero, pct(c.headroom));
    var col = "var(--" + c.status + ")";               // text
    var fill = "var(--" + c.status + "-mark)";          // the bar itself
    return "<div class=\"bar\"><div class=\"nm\">" + r.name + "<small>" + sub + "</small></div>" +
      "<div class=\"track\"><span class=\"zero\" style=\"left:" + zero + "%\"></span>" +
      "<span class=\"fill\" style=\"left:" + a + "%;width:" + Math.max(b - a, 1.2) + "%;background:" + fill + "\"></span></div>" +
      "<div class=\"val\" style=\"color:" + col + "\">" +
      (c.status === "retiring" && c.transfer > 0 ? "→ " + fmt(c.transfer)
        : (c.gap < 0 ? "−" : "+") + fmt(Math.abs(c.gap))) + " " + r.unit +
      "<small>" + (c.status === "retiring"
        ? (c.transfer > 0 ? "transfers to successor" : "stock covers it")
        : (c.headroom * 100).toFixed(0) + "% headroom") + "</small></div></div>";
  }).join("");

  document.getElementById("ticks").innerHTML =
    "<span>runs dry</span><span>exactly covered</span><span>" + (hi * 100).toFixed(0) + "% spare</span>";

  document.getElementById("tbody").innerHTML = rows.map(function (x) {
    var r = x.r, c = x.c;
    var tag = c.quiet ? "<span class=\"tag t-dormant\">No demand</span>"
      : c.status === "retiring" ? "<span class=\"tag t-retiring\">Winding down</span>"
      : c.status === "late" ? (r.stockedBy === "THEM"
          ? "<span class=\"tag t-late\">THEM to order</span>"
          : "<span class=\"tag t-late\">Order now</span>")
      : c.status === "watch" ? "<span class=\"tag t-watch\">Tight</span>"
      : "<span class=\"tag t-ok\">Covered</span>";
    var scale = (r.leadWeeks != null ? r.leadWeeks : state.lead) / BASE_LEAD;

    var head = "<tr class=\"head\" data-id=\"" + r.item + "\">" +
      "<td class=\"item\">" + r.name + "<small>item " + r.item + (r.note ? " · " + r.note : "") + "</small></td>" +
      "<td>" + (r.stockedBy === "THEM" ? "THEM (Maruto)" : "MP (Lamick)") + "</td>" +
      "<td class=\"n\">" + fmt(num(r.onHand)) + " " + r.unit + "</td>" +
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
      "<td>" + tag + "</td></tr>";

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

    return head + "<tr class=\"drill\" data-for=\"" + r.item + "\" hidden><td colspan=\"13\">" +
      "<div class=\"drillbox\">" + nlHtml + rtHtml + woHtml + soHtml + fcHtml + nbHtml + "</div></td></tr>";
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

renderStatic();
renderNotes();
render();
})();
