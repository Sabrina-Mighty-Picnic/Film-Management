# Film coverage dashboard

A monthly view of printed film: when each one runs out, what replaces it, and whether
the blank is ordered in time. One JSON file per month, one build step, one HTML page.

- **The numbers live in `data/<YYYY-MM>.json`.** Nothing else needs touching month to month.
- **The look and the maths live in `src/`.** They do not change when the numbers do.
- **The built page lands in `dist/`.** `dist/index.html` is always the newest month.

## Updating it each month

In Claude Code, from this repository, the whole job is one message. For example:

> Start the October snapshot from September. Here is the NetSuite
> `aggregateitemlocation` export, the open work order lines, the open sales orders and
> the FILM tab. Fill in `data/2026-10.json`, rebuild, and tell me what changed.

Claude will run the steps below. You can equally run them yourself.

### 1. Start the month

```bash
node bin/new-month.mjs 2026-10 --as-of 2026-10-14
```

Copies the newest data file to `data/2026-10.json`, keeping the structure — film list,
names, units, who stocks each one, retiring flags, per-item lead times, the transition
panel, the source table, the note cards — and blanking every position and order line.
A figure you forget to refresh is more dangerous as a stale number than as a zero.

Add `--keep-numbers` if you would rather edit last month's figures in place.

### 2. Fill in the numbers

Edit `data/2026-10.json`. `data/SCHEMA.md` says what every field means and where in
NetSuite it comes from. In short:

| Part of the file | What goes in it |
| --- | --- |
| `films[]` | one row per film: on hand, on order, committed, backordered, work order demand, sales orders not yet on a work order, forecast beyond both, weekly build rate |
| `workOrderLines[]` | every open work order film line — these populate the drill-downs |
| `salesOrderLines{}` | open sales orders by film |
| `forecastMonths{}` | the FILM tab rows by film |
| `noFilmWorkOrders[]` | open work orders carrying no film line at all |
| `transitions[]` | each printed film being run out: stock in hand and the weekly draw |
| `notes[]`, `sourceNotes` | the written cards — **these are last month's words, re-read them** |

### 3. Build

```bash
npm run build              # newest month
npm run build -- 2026-10   # a specific month
npm run check              # validate without writing anything
```

The build validates first and refuses to write if anything is actually wrong. It then
prints what the page will say, so you can sanity-check before opening it:

```
2026-09  16 September 2026  (28 films)
  Worst-case basis, 16-week lead:
    4 short   3 tight   11 covered   5 winding down   5 no demand
    SHORT  1129 Lamick Opaque White CPET — 4,139 m short, suggested order 22k m
    TIGHT  1042 HF Red Pepper 1oz — 7% headroom
```

Errors stop the build (a film with two rows, a quantity that is not a number, a
negative position). Warnings do not, but they are the ones worth reading — the most
useful is when the work order lines you pasted do not add up to the `onWorkOrders`
figure on the film row, which means one of the two pulls is stale.

### 4. Look at it, then share it

Open `dist/index.html` in a browser. The shared copy lives at the URL in
`dashboard.json`. To refresh it, ask Claude Code in this repository:

> Republish `dist/index.html` to the artifact URL in `dashboard.json`.

Republishing to that same URL each month means the link you have shared never changes.
Artifacts are private until you share them from the page's own share menu.

## What the page does

- **Verdict** — how many films we buy run out before a new order could land.
- **Printed film, and what it becomes** — each film being retired, when it runs dry,
  and the date by which its blank has to be ordered.
- **Controls** — demand basis (work orders / + sales orders / + forecast / recent
  builds / worst case) and the lead time in weeks. A film with its own `leadWeeks`,
  like the 4-week backup blank 1129, is always judged on its own clock.
- **Cover to <date>** — headroom per film against the chosen basis.
- **Detail** — every figure, with the orders behind it one click down.
- **Notes** — the written commentary, straight from the data file.

Two conventions worth knowing, because they are what make the numbers add up:

- Coverage uses **on hand plus on order**, not NetSuite's *available*. Available nets
  out what open work orders have committed, and those work orders exist to fill the
  same sales orders already counted as demand — netting both takes the demand off twice.
- A film being **run out is never short**. We are not reordering it, so demand beyond
  the stock left transfers to its successor rather than becoming a purchase order.

## Layout

```
data/2026-09.json     the month's numbers and words — the only file that changes monthly
data/SCHEMA.md        every field, and where it comes from in NetSuite
src/coverage.cjs      the coverage maths, shared by the page and the build script
src/dashboard.js      rendering — reads the data, draws the page
src/template.html     the shell and all the styling
src/build.mjs         validate, report, write dist/
bin/new-month.mjs     start next month from this one
dist/                 the built pages, one per month
```

## Requirements

Node 18 or newer. No dependencies, no install step, no network.
