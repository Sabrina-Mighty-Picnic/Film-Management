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

return { compute: compute, fmt: fmt, num: num };
});
