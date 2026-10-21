# The monthly data file

One file per month, `data/<YYYY-MM>.json`. Everything the dashboard shows comes from
here — every number and every sentence. Prose fields may contain inline HTML
(`<strong>`, `<em>`, `&nbsp;`); everything else is plain text or numbers.

Quantities are always in **the item's own stock unit** — metres for the newer Lamick
films, millimetres for the older Maruto ones, each for the per-unit items. The
dashboard never converts between them, so a row denominated in the wrong unit is the
single easiest way to make the page lie.

---

## `meta`

| Field | Meaning |
| --- | --- |
| `period` | `YYYY-MM`, matching the filename |
| `org` | shown in the browser tab title |
| `title`, `subtitle` | the masthead |
| `asOf` | `YYYY-MM-DD`. **Every date on the page counts forward from this**, so a wrong date moves every runout and switch-by date |
| `asOfLabel` | how that date is written in the masthead |
| `asOfLines` | extra lines under it |
| `defaultLeadWeeks` | where the lead-time box starts, normally 16 |
| `baseLeadWeeks` | the lead the forecast tier is denominated in. Change it only if the FILM plan window changes |
| `transitionsHeading`, `transitionsSub`, `sourcesHeading`, `sourcesSub` | panel headings |
| `footer` | the closing paragraph |

## `films[]` — one row per film

The table, the bars and the verdict all come from here.

| Field | Where it comes from |
| --- | --- |
| `item` | NetSuite item number, as a string. Must be unique |
| `name` | how it reads on the page |
| `stockedBy` | `"MP"` (we buy it, Lamick) or `"THEM"` (they stock it, Maruto) |
| `unit` | `"m"`, `"mm"` or `"ea"` |
| `onHand`, `onOrder`, `committed`, `backordered` | NetSuite `aggregateitemlocation` |
| `onWorkOrders` | film on open work orders at Released or In Process. Should equal the `workOrderLines` for this film |
| `soNotYetWO` | open sales order demand with no work order raised yet, converted to film through the finished good's current BOM revision. **Only the part not already on a work order** — the tiers nest |
| `forecastBeyond` | FILM tab demand beyond both, over `baseLeadWeeks`. Scales with the lead-time box |
| `weeklyBuildRate` | assembly builds, trailing weeks |

Optional:

| Field | Effect |
| --- | --- |
| `leadWeeks` | judge this film on its own lead rather than the box. 1129 uses 4 |
| `retiring` | not being reordered: it can never read short, and demand beyond the stock left shows as transferring to `successor` |
| `successor` | what replaces it. Required in practice whenever `retiring` is set |
| `expediting` | a retiring film with live backorders — reads amber rather than grey |
| `noBom` | no BOM revision points at this item; says so in the drill-down |
| `note` | one line under the name, in the table and the bars |
| `nextInLineNote` | a paragraph at the top of the drill-down, for stock bought for a move that has not happened yet |
| `supplier` | who makes the film — `Lamick`, `Maruto`. **Record it only where there is evidence**: the film's own name, or its presence in a register. Load-bearing, because plate fees are ours on Lamick film only, so the plate check stays silent for any other supplier |
| `producedAt` | where the film is consumed, when that is not the obvious site. 937 is ordered via Maruto and produced at THEM. Shown in the Inventory tab's note |
| `lossBuffer` | a planning buffer for this film alone, with `lossBufferNote` saying why. Never page-wide — see **`films[].lossBuffer`** |
| `blank` | unprinted film, so no printing plate exists and none is expected. Stops the plate check reporting it as a gap |
| `siblingOrder` | an order for the same film sitting on a differently-denominated item that cannot be pooled. Takes `item`, `qty`, `unit`, `ref` and a `note`. Flagged on the order card and in the build summary; never folded into the runway |

### How a film is judged

Stock is `onHand + onOrder`. Demand depends on the basis chosen on the page:

| Basis | Demand |
| --- | --- |
| Work orders | `onWorkOrders` |
| + sales orders | `onWorkOrders + soNotYetWO` |
| + forecast | the above `+ forecastBeyond` scaled to the lead time |
| Recent builds | `weeklyBuildRate × lead` |
| Worst case | the largest of the last three |

Stock minus demand is the free position; divided by demand it is the headroom.
Below zero reads **Order now**, under 20% reads **Tight**, otherwise **Covered**. The
suggested order is the shortfall plus one further lead time at the same rate.

## `transitions[]` — the printed-film timeline

| Field | Meaning |
| --- | --- |
| `item`, `name`, `stockedBy`, `unit` | as in `films` |
| `onHand` | stock of the printed film |
| `weeklyRate` | how fast it is being drawn. `0` draws a flat rail with a label instead of dates |
| `rateBasis` | where that rate came from, e.g. `"recent builds"` |
| `successor`, `buyer`, `decided` | what replaces it, who buys it, whether it is settled |
| `bomAction` | the BOM work the switch needs |
| `holding` | no draw yet, and that is fine — printed stock to run down first (green) |
| `stranded` | no draw and nothing left using it (grey) |

Runout is `onHand / weeklyRate` weeks out; switch-by is that less the lead time.

## `workOrderLines[]`

`{ wo, date, status, product, film, qty, backordered }` — `film` is the item number
and must match a row in `films`. These fill the work order drill-down, and the build
warns when they do not add up to that film's `onWorkOrders`.

## `salesOrderLines{}`

Keyed by item number: `{ product, customer, units, due, orders, filmQty }`, where
`units` is finished goods, `orders` is how many sales orders are rolled into the line,
and `filmQty` is the film it converts to.

## `forecastMonths{}`

Keyed by item number: `{ month, qty }` — the FILM tab rows as they read, with the unit
written into `qty` (`"31,063 m"`), because the tab mixes units.

## `forecastNotes{}`

Keyed by item number: a sentence shown instead of "no row on the FILM tab", for a film
whose forecast is derived some other way.

## `noFilmWorkOrders[]`

`{ wo, date, product, qty, reason }` — open work orders carrying no film line.
Rendered as a table inside the note card with `"table": "noFilmWorkOrders"`.

`reason` is a key into `noFilmReasons`, a map of key to
`{ label, baException? }`. **Set it only where a reason has actually been stated.** A row
with no reason is listed first and tagged *not explained*, and the build warns, because a
work order drawing film nobody can account for is a gap worth chasing rather than a
convention to assume. The build also warns if a `reason` has no entry, or no `label`.

`baException: true` marks a reason that accounts for a **`BA` product** carrying no film
line. A `BA` prefix means the film is ours, so such a row is an exception to the rule and
has to name itself: the build warns if a `BA` product uses a reason without the flag.
"It is at THEM" is the rule for the plain-named products, not an explanation of why a
`BA` product left our film.

## `sources[]` and `sourceNotes[]`

The provenance panel: `{ column, source, firmness }` rows, then paragraphs under it.

## `notes[]` — the commentary cards

```json
{
  "title": "The primary blank has 11 weeks against a 16-week lead",
  "flag": true,
  "body": ["a paragraph", ["a bullet", "another bullet"], "a closing paragraph"],
  "table": "noFilmWorkOrders"
}
```

`flag` draws the red left border. A string in `body` is a paragraph, an array is a
bullet list. `table` is optional and currently only understands `noFilmWorkOrders`.

**These carry over from last month untouched.** They are the part of the dashboard
that goes quietly out of date, so re-read them every month against the new numbers.

## `glossary` — the Reference tab's vocabulary

```json
[{ "group": "The five statuses",
   "terms": [{ "term": "Tight", "def": "Covered, but with under 20% headroom." }] }]
```

Each group renders as a card. A term here also becomes the hover tooltip on any status
tag whose label matches it, so keeping the wording identical to the tag ("Order now",
"Tight", "Covered", "Winding down", "No demand", "THEM to order") is what wires them up.

## `trackers[]` — film we bought that somebody else holds

For consignment stock: film we paid for, sitting at a co-packer who manages it. It is
not in our NetSuite on-hand, so nothing else on this page knows it exists — this log is
the only record.

| Field | Meaning |
| --- | --- |
| `item` | the film's item number. Matching a row in `films` cross-links the two, so the coverage row carries a "held at …, see Tracker" note |
| `name`, `unit` | as in `films` |
| `heldBy` | who physically holds it, e.g. `"FFW"` |
| `ownedBy` | the ownership line shown beside the heading |
| `purpose` | why this log exists, in a sentence |
| `reorderAt` | optional. A balance at or below this reads red |
| `ledger[]` | the running log, below |

### `ledger[]`

One line per event, each `{ date, type, qty, ref, note }`. `date` is `YYYY-MM-DD`,
`ref` is the PO or shipment number, `note` is optional.

| `type` | Effect on the balance |
| --- | --- |
| `received` | adds — film delivered to them |
| `used` | subtracts — film consumed, from what shipped |
| `count` | **sets** the balance to `qty` — what they report holding. The difference against the running balance shows as a variance |
| `adjustment` | adds `qty`, which may be negative — scrap, transfers, corrections |

The balance, the weekly usage rate and the weeks of cover are all derived; do not store
them. The usage rate comes from the span between the first and last `used` entries, so
two shipments are needed before it can say anything.

**The ledger is cumulative.** `bin/new-month.mjs` carries it over untouched — append the
new month's entries rather than starting again.

## Optional ordering fields on a film

| Field | Effect |
| --- | --- |
| `rollSize` | the supplier's roll size in the item's unit. The suggested order rounds up to whole rolls and the panel shows how many |
| `minOrder` | the supplier's minimum. A suggested order below it is raised to it |

Neither is populated yet. Add them and the What to order panel starts quoting orders you
can actually place.

## `substituteGroups[]` — items that are one buying decision

Two films that feed the same line are not two decisions. A group pools them: the
working views (What to order, the runway, the detail table) show the group in place of
its members, and the members keep their own rows in the data and appear in the group's
drill-down.

| Field | Meaning |
| --- | --- |
| `id` | the group's own key, e.g. `"ffw-blank"` |
| `name` | how it reads on the page |
| `items` | two or more item numbers, all held in the **same unit** — the build refuses to pool metres with each |
| `orderItem` | which member you actually raise the purchase order against. Its lead time is the group's lead time, and the order panel names it |
| `note` | why these are one decision, shown under the name |

Positions, demand tiers and build rates are summed. This matters most where a backup
item is substituted at build time: the line's real draw is split across both items, so
neither reads the true rate on its own.


## `lines[]` — a default film and its backup

Two films on one line that are **not** interchangeable to buy. The default carries the
line; the backup has its own, usually shorter, lead and is ordered only when the
default will not arrive in time.

| Field | Meaning |
| --- | --- |
| `defaultItem` | the film you normally order. It is judged at the **whole line's draw** — the sum of every member's build rate — because any week a backup was in the machine is a week the default would otherwise have supplied |
| `backupItems` | judged on their own stock and their own `leadWeeks`, and labelled as relief rather than supply |
| `note` | the rule, in a sentence |

This is the fix for a split build rate. 1094 reads 3,129 m/wk and 1129 reads 3,341 only
because the draw moved between them; the line runs at 6,470. Without the line, 1094
looks like it has 46 weeks of runway when it has 22.

## `successorItem` — where a retiring film's draw goes

On a film with `retiring: true`, `successorItem` names the film that inherits its draw.
The successor's runway then **steps down on the date the retiring film runs out**, which
is derived rather than guessed: the retiring film's stock divided by the rate it is
being consumed at (the `transitions` rate where there is one, because a trailing build
rate can be near zero for a SKU nobody has built lately).

Add `successorPerUnit` when the two are held in different units: **how much of the
successor's unit one of the retiring film's unit becomes**. The retiring film's weekly
rate is multiplied by it, so the step arrives denominated in the successor's unit. 880
hands over to 1152 at `0.110011` — one jerk impression is 0.110011 m of film, stated as
9.09 impressions per metre. Without it the step is left out and the build warns, rather
than silently adding metres to each.

A film can also carry manual `incoming` entries, `{ fromWeek, rate, source, note }`, for
a transfer with no retiring film behind it. `fromWeek: null` means agreed but
unscheduled: it is listed on the page and deliberately left out of the dates.


## `annualUsage` — what was drawn over twelve months

```json
"annualUsage": {
  "from": "2025-10-21",
  "to": "2026-10-20",
  "source": "assembly builds in NetSuite over the trailing twelve months",
  "films": [
    { "item": "929", "name": "BA Repeat 75mm (Maruto)", "unit": "mm",
      "stockedBy": "THEM", "qty": 217293632, "builds": 62 },
    { "item": "1003", "name": "BA Repeat Foil 75mm (Maruto)", "unit": "mm",
      "stockedBy": "THEM", "qty": 30258568, "builds": 14, "retired": true,
      "note": "We no longer buy it..." }
  ]
}
```

Consumption, not coverage. A row's `unit` and `stockedBy` must match the film's, and the
build errors on a unit mismatch — a metre figure under a `mm` film is off by a thousand.
A row for a film not in `films[]` needs `retired: true` plus its own `name` and `unit`,
since nothing else in the data carries them.

`blankAtThem[]` is `{ product, units, note }` — products run on THEM's blank over the
same window, in **units built**, because their blank carries no film line and no BOM and
there is no quantity of it in our records. Never convert these to film; we hold no pitch
for it.

Rendered as a folded panel on the Inventory tab, with a derived per-week column, plus an
open panel for blank film: ours summed across the FFW line (`films[].blank`) against
THEM's units.


## The Inventory tab

Built entirely from `films[]`, with no data of its own: every item, in its own stock
unit, sorted by name. It is the "what have we got" view, where the coverage tab is the
"what do I do" one, so it shows the items the coverage tab leaves out — no-demand film,
the backup, and items that no bill of materials draws.

**Stock is on hand plus on order**, the same figure the rest of the page judges a film
on. Committed and backordered sit beside it and are never subtracted: committed stock is
already counted inside the work order demand, and subtracting it double-counts.

Status is the film's standing on the coverage tab, so a pooled member carries its
group's. The backup is the one exception — it reads *Backup* rather than its raw status,
because *Past order-by* on film that is deliberately not reordered is misleading.


## `films[].lossBuffer` — a planning buffer for one film

A fraction, with `lossBufferNote` saying why that film needs one. **Per film, never
page-wide.** Only 1123 carries one (0.05): Bacon Jam runs more particulates than the
rest. Bills of materials allow 2% as standard, so nothing else needs a buffer.

`impressionBasis()` marks each factor `gross: true` or `false`. A stated
`filmPerImpression` is gross — the plate's own geometry — and takes the film's buffer if
it has one. A factor blended from `filmQty / units` is observed from what builds drew and
already carries the 2%, so it takes nothing. `impressions(qty, basis, film)` applies
this; `impressionNote(basis, film)` says which happened, and the drill-down prints it.

A buffer applies to **yield only**. `successorPerUnit` and the transfer rates are film
actually consumed, so a handover date never moves when a buffer changes.


## `plates` — printing plate expiries

A printed film is run from a plate the supplier holds. A plate lapses **on a date rather
than with use**, and renewing one is a charge, so the question is never how long is left
on its own but whether the next order falls the wrong side of it.

```json
"plates": {
  "source": "MPC_TLK_FILMS, the Taisei Lamick plate register",
  "asOf": "2026-08-18",
  "termMonths": 12,
  "register": [
    { "plate": "FILM- HF Cherry 1oz", "item": "1038", "widthMm": 200, "pitchMm": 65,
      "expires": "2027-07-28" },
    { "plate": "FILM- HF Plum Spread 1oz", "item": "1040", "widthMm": 200, "pitchMm": 65,
      "expires": null, "expired": true }
  ]
}
```

`plates.supplier` names whose register this is and `plates.scope` says what that covers.
Plate fees are ours on that supplier's film only, so a film from elsewhere having no row
is the design rather than a gap, and the build stays quiet about it.

`item` is ours, not the supplier's — the register names films its own way, so the mapping
is made once, by hand, and checked by the build. `alsoItems` adds the other items one
plate covers, for a film we hold in more than one item. A plate against a
`substituteGroups` id covers every member. `expires: null` with `expired: true` is how the
register gives a lapsed plate with no date; **never put a date to one**.

The state each film gets:

| State | Meaning |
| --- | --- |
| `expired` | lapsed. A renewal rides the next order, whenever that is |
| `lapsing` | lapses inside `plateHorizon` weeks (8 by default), so the charge lands whatever the ordering does |
| `lapses-first` | lapses before this film's own order-by date, so that order carries a renewal |
| `ok` | the next order is inside the plate's life |
| `not-needed` | every item it covers is retiring — nothing will be printed from it again |
| `no-film` | no item holds it any more |
| `none` | no plate against this film |

`not-needed` is the one worth reading closely: it is the only state that says *don't*
spend. A plate is needed if **any** item it covers is still being bought, so the jerk
plate counts as needed even though 880 is retiring, because 1152 is not.

The build warns when a plate covers an unknown item, when two plates cover the same one,
and when a film that is being consumed has no plate and is not marked `blank`.


## `filmPerImpression` — saying a quantity in packs

How much film makes one impression (one pack). It lets the page show stock and orders
in impressions beside the metres.

It is normally **not needed**: the page derives it from the film's own open sales order
lines, which carry both `units` and `filmQty`, so the factor is observed. Where a film
runs several SKUs, as the blank does, the derived figure is blended across the current
order mix and moves with it.

Set it explicitly only where the data states it and there are no sales orders to read —
`1095` at `0.051` and `1090` at `0.06633` both come from those films' own notes. **A film
with neither shows no estimate**, which is the intended behaviour: a guessed pack size
would put a wrong number in front of a buyer.

