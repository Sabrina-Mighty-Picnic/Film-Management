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
| `substituteGroups[]` | items that feed one line and are therefore one buying decision |
| `trackers[].ledger` | this month's deliveries and shipments for consignment stock — **append, never replace** |
| `notes[]`, `sourceNotes` | the written cards — **these are last month's words, re-read them** |
| `glossary` | only when the vocabulary itself changes |

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
  To order inside the next 8 weeks:
    NOW      22k m  1129 Lamick Opaque White CPET — the backup blank
    by       21k m  1042 HF Red Pepper 1oz
    tracker 1123 Bacon Jam 1oz printed film: no ledger entries yet

  Worst-case basis, 16-week lead:
    4 short   3 tight   11 covered   5 winding down   5 no demand
```

Errors stop the build (a film with two rows, a quantity that is not a number, a
negative position). Warnings do not, but they are the ones worth reading — the most
useful is when the work order lines you pasted do not add up to the `onWorkOrders`
figure on the film row, which means one of the two pulls is stale.

### 4. Look at it, then publish it

Open `dist/index.html` in a browser. There are two ways to share it.

**Vercel (a live page at your own URL).** `vercel.json` configures the deploy, so a
fresh import needs no settings changed:

| Setting | Value | Set by |
| --- | --- | --- |
| Framework preset | Other | `vercel.json` |
| Install command | none — this project has no dependencies | `vercel.json` |
| Build command | `node src/build.mjs --all` | `vercel.json` |
| Output directory | `dist` | `vercel.json` |

Without that file Vercel looks for a `public/` directory, does not find one, and the
deploy fails with *No Output Directory named "public" found* — which is the usual
first error on a repository like this one. If you already created the project and it
failed, redeploy after this file lands, or set the three values above by hand under
**Settings → Build & Deployment**.

Every push to the connected branch rebuilds and redeploys. `/` is the newest month and
each month also keeps its own URL, e.g. `/film-coverage-2026-09`.

**A Vercel deployment is public to anyone with the link.** This page names suppliers,
customers, order volumes and lead times. Turn on **Settings → Deployment Protection**
(Vercel Authentication, or a password) before sharing the URL.

**Claude artifact (private by default).** The copy at the URL in `dashboard.json` is
private until you share it from the page's own share menu. To refresh it, ask Claude
Code in this repository:

> Republish `dist/index.html` to the artifact URL in `dashboard.json`.

Republishing to that same URL means the link you have shared never changes.

## What the page does

Three tabs. Each one has its own URL — `#coverage`, `#tracker`, `#reference` — so you
can link someone straight to the one you mean.

**Coverage** — the working tab.

- **Verdict** — how many films we buy run out before a new order could land.
- **What to order** — the only panel that says *do this*: every film needing an order
  inside the next eight weeks, how much, and the date to place it by. "Order now" means
  the order-by date has already passed. Films held off-site are flagged rather than
  quoted, because our NetSuite position for them reads zero by design.
- **Controls** — demand basis (work orders / + sales orders / + forecast / recent
  builds / worst case) and the lead time in weeks. A film with its own `leadWeeks`,
  like the 4-week backup blank 1129, is always judged on its own clock. Everything
  above and below these controls follows them.
- **Runway** — five tiles counting the month (short, tight, covered, winding down,
  no demand), then a timeline. Each bar runs from today to the day that film runs dry,
  with a pin at the last date an order still lands in time, and a vertical rule at
  today plus the lead time: **a bar ending left of that rule cannot be saved by
  ordering now.** Rows are sorted by the order you have to place soonest. **Click a
  tile to see only those films**; the timeline and the detail table both follow it.
  Only short and tight are drawn on arrival — the rest are behind "Show N more".
  Headroom as a percentage still exists, in the detail table, where comparing films
  measured in metres, millimetres and each needs a ratio rather than a date.
- **Printed film, and what it becomes** — each film being retired, when it runs dry,
  and the date by which its blank has to be ordered. Folded shut; the summary line
  says how many are already past their switch-by date.
- **Detail** — folded shut too. Six plain columns by default (film, stock, demand,
  free position, order, status) with **Every column** restoring the full thirteen, and
  the orders behind any film one click down.

Nothing is removed by any of this — it is all one click away. The working view is
about two screens instead of five.

**Tracker** — film we bought that somebody else holds. A running log of deliveries in
and shipments out, with the balance, the usage rate and the weeks of cover falling out
of it. This is the only record of that stock: it is not in our NetSuite on-hand, so
nothing else on the page can see it.

**Reference** — what the words mean, where each number comes from, and the written
commentary on the month. Nothing here needs reading to use the Coverage tab; it is
there for when somebody asks what "headroom" or "winding down" actually means.

Two conventions worth knowing, because they are what make the numbers add up:

- Coverage uses **on hand plus on order**, not NetSuite's *available*. Available nets
  out what open work orders have committed, and those work orders exist to fill the
  same sales orders already counted as demand — netting both takes the demand off twice.
- A film being **run out is never short**. We are not reordering it, so demand beyond
  the stock left transfers to its successor rather than becoming a purchase order.

## Brand

The page follows *MIGHTY PICNIC_BrandGuide_V2* (2023): Bone `#FCF2E4` ground, Royal
Blue `#2E2B84` text, Vibrant Pomegranate `#E63D33` accents, the full palette as the
rule under the masthead, and Quicksand throughout — Bold uppercase with wide tracking
for headings, Medium for body copy, exactly as the guide sets it.

Every colour is a custom property at the top of `src/template.html`, with the brand
hex codes named. Change one there and it changes everywhere.

The logo in the masthead is the real mark, carried inside the page as a **CSS mask**
rather than a picture — so it is pomegranate on bone in light mode and bone on royal
blue in dark mode from one file, and a built page still shows it when emailed or opened
straight off a disk with no network. The browser-tab icon is the first arch glyph of
the monogram, which is the part that still reads at 16px.

| File | What it is |
| --- | --- |
| `assets/mighty-picnic-logo.webp` | the supplied artwork — the source of truth |
| `src/logo-mask.png` | generated: white silhouette on transparency, used as the mask |
| `src/favicon.png` | generated: the arch glyph on bone |
| `bin/make-logo.html` | open it in a browser to regenerate both from the artwork |

To change the logo, drop the new artwork in `assets/` and either open
`bin/make-logo.html` and save the two downloads over the files above, or just ask
Claude Code to regenerate them.

One deliberate departure: the status scale. Short is pomegranate and tight is gold,
both darkened enough to stay legible on bone, and winding down is royal blue. Covered
is a green the brand palette does not carry, because "on plan" has to read instantly
and the palette has no other colour that says it. Every status also carries a word, so
the colour is never the only signal.

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
assets/               the supplied logo artwork
bin/make-logo.html    regenerate the logo mask and favicon from that artwork
vercel.json           deploy config — build command and output directory
dashboard.json        the published artifact URL
```

## Requirements

Node 18 or newer. No dependencies, no install step, no network.
