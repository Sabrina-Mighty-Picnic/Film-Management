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

`{ wo, date, product, qty }` — open work orders carrying no film line, because THEM
bundle film into tolling. Rendered as a table inside the note card with
`"table": "noFilmWorkOrders"`.

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

Add `successorPerUnit` when the two are held in different units — how much of the
retiring film's unit makes one of the successor's. Without it the step is left out and
the build warns, rather than silently adding metres to each.

A film can also carry manual `incoming` entries, `{ fromWeek, rate, source, note }`, for
a transfer with no retiring film behind it. `fromWeek: null` means agreed but
unscheduled: it is listed on the page and deliberately left out of the dates.

