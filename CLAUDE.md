# Working in this repository

This repo builds one thing: the Mighty Picnic film coverage dashboard. A month of
numbers goes into `data/<YYYY-MM>.json`, `npm run build` turns it into
`dist/film-coverage-<YYYY-MM>.html`, and `dist/index.html` mirrors the newest month.

Read `README.md` for the workflow and `data/SCHEMA.md` for every field before editing
a data file.

## The monthly update

When asked to update, refresh, or start a new month:

1. `node bin/new-month.mjs <YYYY-MM> --as-of <YYYY-MM-DD>` — the as-of date is the day
   the NetSuite positions were pulled, not today. Every runout and switch-by date on
   the page counts forward from it.
2. Fill in `data/<YYYY-MM>.json` from whatever the user supplied (a NetSuite export, a
   pasted table, a spreadsheet). Put the numbers in the data file — never in `src/`.
3. `npm run build -- <YYYY-MM>` and read the output. Fix every warning or explain in
   your reply why it is expected. Warnings about work order lines not adding up to
   `onWorkOrders` almost always mean one of the two pulls is stale — say so rather
   than quietly adjusting a number to make the warning go away.
4. Tell the user what changed against last month: which films moved between short,
   tight and covered, what the suggested orders are now, and anything new that
   appeared or disappeared. Compare against the previous `data/*.json`, which is still
   in the repo.
5. Republish the artifact to the URL in `dashboard.json`, if one is recorded, so the
   link the user shares does not change.

## Brand

The styling follows *MIGHTY PICNIC_BrandGuide_V2* (2023) and lives entirely in the
custom properties at the top of `src/template.html`: Bone `#FCF2E4`, Royal Blue
`#2E2B84`, Vibrant Pomegranate `#E63D33`, Raspberry `#D6195B` / `#E95F9D`, Gold
`#F8A914`, Yellow `#F4D99E`, Lavender `#E0B8D8`; Quicksand for all type, Bold
uppercase with wide tracking for headings.

- Change colours only in that token block, never inline in `dashboard.js`. The page
  uses `--<status>-mark` for a fill and `--<status>` for text on that status.
- Keep both themes working. Every token is redefined for dark mode twice — under
  `prefers-color-scheme` and under `[data-theme="dark"]` — and both copies must match.
- Any new colour needs 3:1 against its surface for a mark and 4.5:1 for small text.
  The dataviz skill ships `scripts/validate_palette.js`, which exports `contrast()`.
- The masthead logo is `src/logo-mask.png`, inlined by the build as a CSS mask so it
  recolours per theme; the tab icon is `src/favicon.png`. **Both are generated** from
  `assets/mighty-picnic-logo.webp` — never hand-edit them, and never add a second
  colour variant. `bin/make-logo.html` holds the recipe: knock the background out to
  alpha, trim, clean the alpha so it compresses, scale, and for the icon crop the
  first arch glyph. Regenerate by running that page's script in headless Chromium.
- Keep the built page self-contained. Images belong inline as data URIs, not as
  separate files a copy of the HTML could be separated from.

## Deploying

`vercel.json` sets the build command (`node src/build.mjs --all`) and output directory
(`dist`). A Vercel deploy that fails with *No Output Directory named "public" found*
means that file is missing or was not picked up. Do not move the build output to
`public/` to work around it.

## The consignment tracker

`trackers[]` logs film we bought that a co-packer holds and manages — currently the
Bacon Jam film at FFW. It is not in our NetSuite on-hand, so this ledger is the only
record of it.

- **Append to the ledger, never rebuild it.** It is cumulative across months, and
  `bin/new-month.mjs` deliberately carries it over untouched.
- Every entry needs a date, a type, a quantity and a reference. Types are `received`,
  `used`, `count` and `adjustment`; a `count` is what the holder reports and overrides
  the running balance, with the difference showing as a variance.
- The balance, the usage rate and the weeks of cover are derived. Never store them.
- **Do not "fix" that zero by putting their stock into `onHand`.** The position stays as
  NetSuite has it; `trackerCover()` answers the order question from the ledger instead.
  A window the balance covers needs no order, so the film leaves What to order and
  counts as covered — in the tiles, the headline and the build summary alike.

## Printing plates

`plates.register[]` is the supplier's plate list, mapped to our items by hand. A plate
lapses **on a date rather than with use**, and renewing one is a charge.

- **The expiry on its own is not the answer.** What matters is whether the film's next
  order-by date falls the wrong side of it, which is what `plateOutlook()` works out.
  Express it as dates and weeks like everything else — never as a count of days left.
- **A retiring film's plate needs no renewal**, because nothing will be printed from it
  again. That is the one state on the page that says don't spend, so do not let it be
  reported for a plate that still covers something live: a plate is needed if *any*
  item it covers is still being bought.
- **The register is the supplier's, and it goes stale.** It carries over untouched each
  month with its own `asOf`. Re-pull it rather than editing expiries, and never put a
  date to a plate the register gives as expired without one.
- **Plate fees are ours on Lamick film only.** Maruto plates, and anything run on
  THEM's own film, are not ours to track — their absence from the register is the design,
  not a gap, and the build says nothing about them. Only a film whose `supplier` is unset
  draws a question, because we cannot tell which case it is.
- Mapping register names to our items is the one hand step. The build checks it: an
  unknown item, two plates on one item, or a **Lamick** film being consumed with no
  plate and no `blank` flag all warn.
- **We hold no plate prices.** Say when a renewal falls due, never what it costs.

## Tolling at THEM

**THEM own the blank. We own the BA film.** Those are two different films and getting
them the wrong way round makes the page wrong about who buys what.

- **Ours:** 929, 1003, 127, 937, 1090, 1092 — and every Lamick film at FFW, 1094 and
  1129 included. All of it is a purchasing decision of ours.
- **Who supplies it, who runs it and whose decision it is are three separate facts.**
  937 is bought from Maruto, produced at THEM, and ours to order: `supplier` Maruto,
  `producedAt` THEM, `stockedBy` MP. Film being made at THEM does not make it theirs —
  only film run on *their blank* is.
- **Lamick and Maruto are different suppliers**, so one plate register cannot cover
  both. `films[].supplier` records it where there is evidence — the film's own name, or
  its presence in a register — and is **left unset otherwise**. The plate check then
  asks the right question: a missing row is only a gap for a film that register's
  supplier makes, and for a film with no supplier recorded it asks whose plate it is.
- **THEM's:** their blank. **Anything run in blank film at THEM is on their film and
  inside the tolling rate**, so its work orders carry no film line, it sits on no bill of
  materials, and we do not worry about purchasing it. That is the standing rule, not a
  case-by-case call.
- 1003 is in the middle of crossing over: ours while it runs down, not reordered, and
  THEM-owned once it is gone — at which point the Ketchup SKU moves to blank.
- `stockedBy` says whose purchasing decision a film is, not where the stock sits.
  Checking a film's own note or the transitions panel is not a substitute for asking:
  the ownership of these five was wrong in the data for months before anybody noticed.

- `noFilmWorkOrders[].reason` keys into `noFilmReasons`. Set it only where a reason has
  been stated; a row without one is listed first, tagged *not explained*, and the build
  warns. A work order drawing film nobody can account for is worth chasing.
- A product moving onto blank at THEM **leaves our data entirely** — strike its sales
  order lines from the film it used to draw and add them to nothing. Do not move them
  onto 1094: that is our blank at FFW, not theirs.
- A one-off is not the rule. Fish Sauce normally runs at FFW on our blank and was sent
  to THEM by mistake, so it carries its own reason and is expected back.

**A `BA` prefix means the film is ours.** That is the rule, and it is what separates a
pair of otherwise identical names: `BA Mirin .5oz` draws 929, while `Mirin .5oz` is run
at THEM on their own blank and draws nothing of ours. Same for `BA Worcestershire 1oz`
against `Worcestershire 1oz`, and `HF Peanut Butter 1.15oz` against `Peanut Butter
1.15oz`.

- **Never match these names loosely.** Stripping a prefix, or normalising punctuation
  far enough to collapse a pair, attributes one product's volume to the other's film.
  The build errors — not warns — if a prefixed product and its bare twin ever map to the
  same film, and refuses to write the page.
- **A `BA` product carrying no film line is an exception and has to name itself.** "It
  is at THEM" is the rule for the plain-named products, not an account of why a `BA`
  product left our film, so a reason used on one must be marked `baException` in
  `noFilmReasons` and the build warns when it is not. Two hold today: both Dijon
  mustards switched off BA Repeat onto blank at THEM, and BA Ketchup's foil has run out
  and is not being reordered, so THEM's own foil runs down and then it goes to blank.
- Film THEM **own and bill us for** is not the same as film inside the tolling rate.
  The foil behind BA Ketchup and plain Peanut Butter is a cost even though it is not our
  stock, so it carries its own reason rather than the blanket one.
- **THEM's film is not ours to track, but it is ours to measure.** There is no position,
  no runway and no order-by date for it — only how much we get through, which is what
  `annualUsage` is for.

## Annual usage

`annualUsage` is twelve months of assembly builds: **what was actually drawn**, as
against every other number here, which is a position or a forecast. It will not tie to
the positions, and it is not meant to.

- 1003 sits in it although it left `films[]`, so the row carries `retired: true` and
  its own `name` and `unit` — nothing else in the data holds them any more.
- **Blank is the one film with two owners, so it has its own panel.** Ours is the FFW
  line, 1094 with 1129 behind it, and the figure that matters is the pair together —
  reading either alone understates the draw. THEM's carries no film line and no BOM, so
  there is no quantity of it anywhere in our records: `blankAtThem` holds **units built**
  and says so. Never convert those to metres; we hold no pitch for their blank.
- A product that switched onto their blank part-way through the year spent most of it on
  our film, where it is already counted. Say so on the row rather than letting the two
  be added up.
- It is a snapshot with its own window, like the plate register. Re-pull it with the
  positions rather than carrying stale figures forward; the build warns when its window
  ends before `meta.asOf`, and when a film with a live build rate has no row in it.
- Quantities stay in each film's own unit and are **never added together**. The "a week"
  column divides by the window, so a window that is not a year makes it wrong — the
  build warns if it is not roughly twelve months.
- Still no prices. Volume answers "how much"; it does not answer "what did it cost".



## Keeping it digestible

The coverage tab is deliberately quiet on arrival: only the films needing a decision
are drawn, the detail table shows six of its thirteen columns, and the transition and
detail panels are folded shut. Everything else is one click away, never removed.

- A new panel goes in folded (`<details class="panel">`) unless it tells somebody to
  do something. What to order is the exception, and it stays first.
- A new column goes in the wide table, not the narrow one. The narrow six answer
  "is this a problem and what do I do"; the rest are the working out.
- The status tiles carry the month's real counts — they ignore the tile filter and the
  no-demand checkbox on purpose, so the numbers do not move when you click one.

## Runway, not ratios

The user's language is time. Express everything as weeks, dates and slack — **never as
"headroom" or a percentage**. Cover is weeks of runway; the decision is the order-by
date; the gap is weeks of slack. A quantity still belongs where it is a quantity (stock,
demand, the order itself).

## Pooled items

There are two different relationships, and confusing them makes the page wrong.

**`substituteGroups[]` — one film, two items.** TJS Honey printed is 127 per each at
THEM and 1095 per metre at FFW. One stock facing one demand, so it is pooled into one
runway, converting with each member's `perUnit`. The members keep their own rows in the
data and appear in the drill-down.

**`lines[]` — a default and a backup.** 1094 and 1129 are **not** pooled: 1094 is the
default on a 16-week lead, 1129 is relief on a four-week lead, ordered only when 1094
will be late. Two decisions. What the default inherits is the line's whole draw.

- **A backup never earns a suggested order of its own.** `backupIdle()` keeps it off
  the reorder list while the default is still ordering on schedule, and lets it back on
  the moment the default goes past its own order-by date. Film held precisely so it does
  not have to be ordered every month must not be asked for every month.
- It carries its own **Backup** status rather than reading short, because a tile that
  counts an action nobody is being asked to take sends the reader looking for a row that
  is not there.

**Never read `compute().status` in a renderer.** It is the verdict on our own position,
and twice now the page has learnt that short on our own position is not always a
decision — a co-packer's ledger covers one film, a backup is relief we are not buying.
Every surface reads `statusKey()` for the key and `statusLabel()` for the word and the
colour, so they cannot drift. Six places had to be found and fixed one at a time:
the tiles, the headline, What to order, the runway chart's labels, **the runway chart's
own decide-or-fold split**, and the detail table's status pill. The last two were found
only because the chart was still saying "order now" for a film the order list had
already dropped. `c.status` is legitimate only inside `statusKey()` itself and where the
question is genuinely about the retiring computation, such as the transfer arrow.

- **A split build rate is the trap the line model exists for.** 1094 at 3,129 m/wk and
  1129 at 3,341 are one line drawing 6,470. Never read one member's rate as the line's.
- Never pool items that are bought separately, however alike they look, and never
  separate items that are one stock.
- A retiring film's draw transfers to its `successorItem` on the date its own stock
  runs out. That date is derived; do not hardcode it. Cross-unit handovers need
  `successorPerUnit` or the step is left out and the build warns.
- **A retiring film needs a `transitions[]` row, not just the flag.** Without one the
  handover is paced by the trailing build rate alone, and a film nobody has built lately
  has a rate of zero — which used to drop the step silently, leaving the successor's
  runway short of a draw that is certainly coming. It is reported as unsized now and the
  build names it. 1090 and 1092 stand there today.
- **The step's basis is whichever candidate won, not the row's `rateBasis`.** A film with
  a stated projection can still be paced by its open orders: 1087 is, and the step said
  "Misfits projection" while using a number the projection never produced.
- Four films now run out into the blank — 1087, 1106, 1108 and 1053 — so **1094 inherits
  in stages**, not all at once. Read its drill-down rather than any single rate.

## Estimated impressions

Quantities can be shown in packs as well as film. The pack size comes from the film's
open sales order lines (`filmQty / units`) — observed, and blended across the order mix
where a film runs several SKUs.

- **Never guess a pack size.** A film with no sales orders and no `filmPerImpression`
  shows nothing, and that is correct. Set the field only where a figure is stated in
  the data, and say in the commit where it came from.
- A blended factor moves with the order mix, so it is an estimate and is always
  labelled as one. Do not present impressions as an exact count.

**Waste: 2% is the standard, and a buffer on top belongs to one film, not the page.**

- **Bills of materials allow 2%**, confirmed. So an **observed** factor, blended from
  `filmQty / units`, already has waste in it — it measures 2.0% above the plate pitch on
  every film where both figures exist (1037, 1038, 1108). Never take anything further
  off it.
- A **stated** `filmPerImpression` is the plate's own geometry and allows nothing, so it
  is reported gross unless the film carries its own `lossBuffer`.
- `films[].lossBuffer` is a **planning** buffer for one film, with a `lossBufferNote`
  saying why. Only 1123 has one: Bacon Jam runs more particulates than the rest and is
  planned at 5%. **Do not promote it to a page-wide default** — I made that mistake and
  it quietly cut 5% off the Jamaican Jerk yield, which has no such problem.
- The build warns if a stated factor is more than 0.5% above its plate pitch, because
  that means an observed figure has been written into a field treated as gross.
- **No buffer touches the draw.** `successorPerUnit` and the transfer rates are film
  actually consumed, so a handover date must not move when a buffer changes. Only the
  yield question — how many impressions this film gives — takes one.

## Rules

- **Numbers live in `data/`, never in `src/`.** If a figure is hardcoded in a `src/`
  file, that is a bug.
- **Never invent a figure.** A number that was not supplied stays 0, or the field is
  left out, and you say which ones are missing. A forecast row that does not exist on
  the FILM tab is a gap worth reporting, not a gap to fill in.
- **Quantities are in each item's own stock unit** — m, mm or ea. Do not convert
  between them, and flag any row that looks denominated in the wrong one (a plan row
  in units against a film stocked per metre is a recurring one).
- **The demand tiers nest.** `soNotYetWO` is only the sales order demand with no work
  order raised yet; `forecastBeyond` is only the plan beyond both. Double-counting
  here is the easiest way to make the page wrong.
- **The note cards carry over untouched from the previous month.** They are prose about
  last month's numbers. Every month, re-read them against the new figures and tell the
  user which ones no longer hold — do not leave a stale card standing silently.
- **Keep the coverage maths in `src/coverage.cjs`.** The page and the build script both
  use it, which is what makes the build's printed summary trustworthy.
- Commit the built `dist/` files along with the data change, so a month can be opened
  straight from the repository.
