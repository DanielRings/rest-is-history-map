# Rest Is History — Map + Timeline Browser

An interactive static site for browsing *The Rest Is History* episodes by
present-day country and historical period. Aimed at the podcast's Discord
community; mobile-first.

## Status

**W0** — contract and skeleton only. No pipeline implementation, no UI yet.
Subsequent workspaces fill in:

- **W1** — Python pipeline (RSS → pending stubs → assembled `episodes.json`)
- **W2** — TypeScript frontend (MapLibre + timeline + filter)
- **W3** — CI, GitHub Pages deploy, weekly RSS refresh workflow
- **W4** — first real run: tag ~500 episodes, ship.

See `CLAUDE.md` for project conventions.

## Repo layout

```
schema/episodes.schema.json         # canonical contract
data/samples/episodes.sample.json   # shared test fixture (matches the schema)
data/samples/rss.sample.xml         # recorded RSS for pipeline tests
data/episodes/{guid}.yaml           # human-tagged source of truth
data/pending/{guid}.yaml            # pipeline-generated stubs awaiting tagging
data/episodes.json                  # pipeline output (committed)
pipeline/                           # Python package (uv + pyproject)
frontend/                           # Vite + TypeScript (pnpm)
```

## Develop

### Python pipeline

Requires `uv` (which manages Python 3.14 automatically).

```sh
uv sync                                    # install deps and create .venv
uv run pytest                              # run contract + unit tests
uv run ruff format
uv run ruff check --select=E,F,W,I,N,B,UP,RUF,D
uv run mypy
```

### Frontend

Requires `pnpm` and Node (see `.nvmrc`).

```sh
cd frontend
pnpm install
pnpm run dev                               # http://localhost:5173
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

## Tagging workflow (will fully apply once W1 lands)

1. `uv run rih-pipeline refresh` — fetches the RSS feed (URL in `RIH_RSS_URL`)
   and writes a `data/pending/{guid}.yaml` stub for each new episode.
2. Tag each pending stub by hand or with Claude Code: fill in `countries`,
   `year_start`, `year_end`, `date_precision`, `kind`, `topics`,
   `historical_figures`, optional `series_id`/`series_part`, and `access`.
3. Move the file from `data/pending/` to `data/episodes/`.
4. `uv run rih-pipeline build` — assemble, validate, and emit
   `data/episodes.json`.
5. `cd frontend && pnpm run build` — produce the static site for deploy.

The tagged YAMLs in `data/episodes/` are the source of truth and survive every
pipeline re-run.

## Secrets

- `RIH_RSS_URL` — the Supporting Cast feed URL (Club, with auth token).
  Stored as a GitHub Actions secret and in a local gitignored `.env` file.
  Never committed.
