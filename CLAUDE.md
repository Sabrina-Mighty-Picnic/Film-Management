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

## Deploying

`vercel.json` sets the build command (`node src/build.mjs --all`) and output directory
(`dist`). A Vercel deploy that fails with *No Output Directory named "public" found*
means that file is missing or was not picked up. Do not move the build output to
`public/` to work around it.

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
