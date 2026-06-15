# W4 — First Real Run

## Live
- **URL**: https://danielrings.github.io/rest-is-history-map/
- **PR**: https://github.com/DanielRings/rest-is-history-map/pull/8
- **Branch**: `DanielRings/w4-first-real-run` → `main`

## What shipped

| | |
|---|---|
| Episodes tagged | **941 / 941** |
| Countries covered | 80 unique ISO3 codes |
| Top 5 countries | GBR (366), USA (133), FRA (102), DEU (86), ITA (84) |
| Schema validation | clean |
| `data/episodes.json` | ~1 MB indented, served at `/data/episodes.json` |

### By kind

| kind | count |
|---|---|
| historical | 651 |
| themed | 213 |
| interview | 42 |
| live | 20 |
| meta | 15 |

### By date_precision

| precision | count |
|---|---|
| year | 301 |
| decade | 129 |
| century | 91 |
| era | 420 |

### Confidence

- **High** (specific year + clear geography): roughly half the historical episodes — single-year events like Hastings 1066, JFK 1963, Trafalgar 1805 etc. Concentrated in `date_precision: year` (301 eps).
- **Low** (intentional, per "don't fabricate"): RIHC bonus chats / Q&A livestreams / themed listicles → `countries: []`, broad year range, `kind: themed` or `meta`. **138 episodes are non-geographic** (countries=[]). **242 episodes have a year span > 200 years** (mostly multi-empire surveys and ages — Bronze Age, Roman Empire generic, etc.).

## How tagging ran

- Subagent fan-out, batches of 30, shared instructions in `.cache/tagging-instructions.md` (gitignored).
- Started on Sonnet for the first wave. Sonnet quota exhausted partway, so waves 3–6 ran on Haiku — faster (~2 min/batch vs ~7 min on Sonnet) and at this judgment volume the quality drop was acceptable for "title + description only" tagging.
- Six waves total over ~1 hour. Quality issues required two systematic post-tagging passes:
  1. **YAML-quote corruption**: early agents used `Write` and lost the doubled-apostrophe escapes in single-quoted descriptions. 68 files broke. Programmatic fix (`.cache/fix_broken_yaml.py`) re-spliced the agent's tag block into the original stub. Instructions updated to mandate `Edit` (which preserves the description byte-for-byte). No further corruption.
  2. **Schema bounds**: out-of-range years (Ice Age `-66 million`, Paleolithic `-400,000`), inverted ranges, year-0, non-ISO3 codes (`SCT`, `HWI`, `COR`, `YUG`, `WAF`, `ASI`, `CAR`, `TCH`). Bulk-fixed via a single Python pass post-tagging.

## Frontend changes

- `frontend/src/main.ts` now `await loadEpisodes(\`${import.meta.env.BASE_URL}data/episodes.json\`)` instead of compile-importing the sample fixture.
- New `frontend/scripts/copy-data.mjs` runs as a pnpm `prebuild`/`predev` hook — copies `../data/episodes.json` into `frontend/public/data/` so Vite ships it in `dist/` and the deploy workflow needs no changes.
- e2e tests intercept `**/data/episodes.json` with `page.route()` and serve the 13-episode sample fixture, keeping their existing GUID-specific assertions deterministic regardless of real data churn.
- W0 sample YAMLs relocated to `data/samples/yaml/` for the pipeline end-to-end test.

## Disputed-border findings

`frontend/src/map/disputed.ts` listed Western Sahara, Crimea, Taiwan, Kashmir, Israel/Palestine for W4 spot-check. With real data:

| iso3 | episodes | NE rendering | finding |
|---|---|---|---|
| `UKR` | 12 | Crimea included in Ukraine | OK; no Crimea-specific episodes that needed RUS |
| `IND` | 8 | Kashmir split into IN/PK admin subfeatures | OK at zoom levels we render |
| `ISR` | 7 | separate from PSE | tagged ISR for "ancient Israel/Judah" + modern state |
| `PSE` | 2 | separate from ISR | both Jesus/Jewish-Revolt episodes co-tagged ISR+PSE per instructions |
| `ESH` | 0 | separate from MAR | no real Western Sahara episodes — no signal yet |
| `TWN` | 0 | separate from CHN | no real Taiwan-specific episodes — no signal yet |

No mid-run failures from `main.ts:72-77`'s hard-throw on missing-from-NE codes (we cleaned those up post-tagging, but it would have surfaced cleanly if they'd reached the runtime).

## Perf

- `data/episodes.json` is ~1 MB indented, ~250 kB gzipped.
- Frontend build output: `index.js` 835 kB (228 kB gzip). Above Vite's 500 kB warn threshold — bulk is MapLibre. No splitting attempted in this PR (out of scope).
- Local smoke at 941 episodes: instant initial render; no jank on hover/click/timeline-scrub at full window or sub-windows. Pre-indexing by ISO3 (`main.ts:79-87`) keeps popup hydration O(matches).
- No timing measurements committed — added to follow-ups if jank surfaces.

## Anomalies / surprises

- The Sonnet quota wall mid-tagging was the biggest disruption. Haiku rescued the run; for the next refresh wave (~weekly cadence), defaulting subagents to Haiku makes sense.
- 15 stragglers — all RIHC bonus chats and themed livestreams — kept partial-tagging through agent retries (agents recognized them as themed but failed to commit a year range). Tagged uniformly by the main agent with a single bulk template (`kind: themed`, `countries: []`, era 1900-2024). Pragmatic but not perfect.
- Schema's `year_end >= year_start + 1` cross-rule is implicit; agents occasionally inverted them on multi-period episodes ("History as Entertainment" etc.). Caught by post-pass swap.
- Several agents tagged Hawaii as `HWI`, Scotland as `SCT`, Corsica as `COR`, etc. — not recognized by Natural Earth. The instructions file now has explicit examples; for future runs the prompt should add a "no subnational codes" rule.

## Follow-ups (out of scope for W4)

- Backfill `apple` / `spotify` / `youtube` URLs (RSS provides them; pipeline doesn't ingest them today).
- Audit the 138 non-geographic episodes — some are arguably geographic and would benefit from re-tagging (e.g. some "RIHC: X" episodes about specific countries got dropped to `[]` on autopilot).
- Consider controlled vocab for `topics` (currently free text — `["french revolution", "revolutions", …]` etc.).
- Code-split MapLibre out of the main bundle to drop below Vite's 500 kB warning.
- Add a `performance.now()` instrumentation for `loadEpisodes` + first `recompute()` and surface in console.
