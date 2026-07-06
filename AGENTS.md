# AGENTS.md

## Project Snapshot

Markonverter is a Chrome/Chromium Manifest V3 extension for comparing Ozon
product prices across saved pickup points. Source code lives in `src/`, tests in
`tests/`, and the loadable extension is built into `dist/`.

## Working Rules

Adapted from Karpathy's four LLM-coding-pitfall rules.

### Think before coding
- State assumptions explicitly. If a task is genuinely ambiguous or
  behavior-changing, name the ambiguity and ask instead of guessing silently.
- If a simpler approach exists than the one implied by the request, say so.

### Simplicity first
- Minimum code that solves the problem. No speculative abstractions, flags, or
  config for values that don't actually vary.
- Prefer existing project patterns and small modules over broad rewrites.

### Surgical changes
- Keep changes focused on the user's requested scope.
- Preserve unrelated local work. Inspect the worktree before editing and do not
  revert changes you did not make.
- Don't "improve" adjacent code, comments, or formatting outside scope; if you
  notice unrelated dead code, mention it instead of deleting it.

### Goal-driven execution
- When source behavior changes, run the relevant checks:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
- Where practical, turn vague tasks into a verifiable criterion (failing test
  before the fix, passing test after).
- Treat `dist/` as build output. Update it only when the task requires a
  loadable extension build or when source changes must be reflected there.

## Ozon Live QA

- Deterministic browser regression coverage is `npm run qa:ozon`.
- Real Ozon reachability is checked separately with `npm run qa:ozon:live`.
- This checkout may have local-only live QA env/cookies in `.env.ozon.local`
  and `.secrets/ozon-cookies.txt`. These files are gitignored secrets: use the
  paths only, do not print their contents, and do not commit them.
- To run the saved live check: `set -a; source .env.ozon.local; set +a; npm run qa:ozon:live`.

## Routing Contract

The main agent owns requirements, architecture, integration, and final judgment.

- Use subagents for read-only repository mapping and evidence gathering, using
  an `explorer`-style role when that helps keep discovery parallel and bounded.
- Use subagents for exact mechanical cleanup in named files, using a
  `cleaner`-style role when the edits are fully specified.
- Use subagents for bounded implementation from a tight specification, using an
  `implementer`-style role when the write boundaries and acceptance criteria are
  clear.
- Use subagents for selective review of risky or unfamiliar diffs, using a
  `gate`-style role when focused second-pass judgment reduces integration risk.
- Use subagents for other tasks that can be optimized by parallel, bounded
  delegation without weakening the main agent's ownership of the outcome.

Every delegation names scope, write boundaries, done criteria, and expected
evidence. Do not delegate tiny tasks or work that is inherently serial.

## Local LLM Wiki

Maintain a project-local LLM wiki in `wiki/`.

- `wiki/index.md` is the main map and should link to durable project knowledge.
- `wiki/log.md` is the dated change and decision journal.
- `wiki/maps/` stores knowledge maps for subsystems, flows, integration notes,
  and important operational assumptions.
- When you discover durable context that future agents should reuse, add it to
  the nearest wiki map and link it from `wiki/index.md`.
- For non-trivial changes, add a concise dated entry to `wiki/log.md`.
- Keep wiki notes factual and concise. Do not turn transient debugging output
  into permanent documentation unless it explains a real decision or invariant.

## Design Work

When changing UI, visual styling, interaction details, copy hierarchy, spacing,
or any user-facing layout, read and follow `DESIGN.md` first. If a design choice
must diverge from `DESIGN.md`, document the reason in the change or in the local
wiki log.
