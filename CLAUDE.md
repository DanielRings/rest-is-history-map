Project goals get set in the opening conversation, not in this file.

## Tooling

### Python
1. Python 3.14
2. **uv** for all package and interpreter management; never touch system Python
3. Deps in `pyproject.toml`; `uv.lock` committed; these are the source of truth
4. `.python-version` pins the interpreter; uv downloads it if absent
5. Per-project `.venv/` at repo root, gitignored, auto-created by uv
6. In a Conductor worktree, run `uv sync` inside the worktree.
7. ruff for format and lint; mypy strict; pytest for tests
8. Installable package layout; no `PYTHONPATH` hacks

### JavaScript / TypeScript
1. pnpm; lockfile committed
2. Vite for dev server and build
3. TypeScript strict; no implicit `any`
4. ESLint + Prettier
5. Vitest for unit tests; Playwright for end-to-end UI tests

### Cross-cutting
1. Pre-commit hooks run formatters, linters, and contract validation
2. GitHub Actions runs the full lint + test matrix on every push
3. Pin language versions: `.python-version`, `.nvmrc`
4. For polyglot projects, define the inter-component contract (JSON Schema, OpenAPI, protobuf) as a first-class artifact and validate on both sides

## Workflow

1. Before writing code, propose a design in ~10 lines. Wait for human approval and iterate before implementing.
   Propose design covering:
   - File structure and data flow
   - Architecture decisions: name alternatives (e.g., SQL vs NoSQL), recommend one with reasoning
   - Whether the change affects an inter-component contract
   - Flag any choice that depends on requirements you don't yet have
   - Edge cases you plan to handle, and any you're treating as out of scope
   - Open questions about the requirements
2. Write the implementation
3. Add 1–3 sanity tests for each function
4. Maintain one end-to-end test per major component exercising the full pipeline
5. Run before reporting:
   - Python: `uv run ruff format`, `uv run ruff check --select=E,F,W,I,N,B,UP,RUF,D`, `uv run mypy`, `uv run pytest`
   - Frontend: `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`
   - Contracts: validate sample fixtures against their schemas
6. Don't claim "done" — say "ready for review"

## Hard Rules — Never Do

1. Never return default or fallback values to mask unexpected input — raise/throw instead
2. Never use mutable default arguments or shared mutable module-level state
3. Never use bare `except:` clauses or empty `catch {}` blocks
4. Never use wildcard imports (`from x import *`, `import * as _`)
5. Never let tests hit the network, real caches, or external services; use fixtures, `tmp_path`, mocks, or route stubs
6. Never leave commented-out or dead code; git remembers
7. Never add a dependency without first checking whether the stdlib or existing deps cover it
8. Never name a Python file the same as a stdlib module (`csv.py`, `json.py`, `email.py`, `time.py`, `random.py`, `string.py`)
9. Never name a TS module after a node builtin (`fs.ts`, `path.ts`, `url.ts`) or shadow a global at module scope
10. Never change an inter-component contract without updating its schema, fixtures, and both sides in the same commit
11. Never commit secrets, API keys, scraped raw payloads, or large binaries
12. Never retry a failing quality gate more than 3 times; stop and report instead

## Hard Rules — Always Do

1. Seed every source of randomness
2. Type-hint every function signature (Python + TS, both strict)
3. Google-style docstring on every Python function; TSDoc on every exported TS symbol. Configure ruff with `[tool.ruff.lint.pydocstyle] convention = "google"`
4. Inspect inputs before coding against them — read a sample, check dtypes, count nulls
5. Turn the user's example input/output into a test
6. Grep for existing utilities before writing a new helper
7. Match the patterns of the file you're editing, even if you'd write it differently from scratch
8. For tasks spanning multiple components, propose the order of changes upfront (usually: contract → producer → fixture → consumer)
9. Choose canonical representations once (one date format, one ID scheme, one unit system) and use them everywhere

## Communication

1. State assumptions explicitly; surface tradeoffs
2. Ask if uncertain — especially about input shape, units, and edge cases
3. Don't hide confusion behind plausible-looking code
