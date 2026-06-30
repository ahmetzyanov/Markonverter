# AGENTS.md

## Project Snapshot

Markonverter is a Chrome/Chromium Manifest V3 extension for comparing Ozon
product prices across saved pickup points. Source code lives in `src/`, tests in
`tests/`, and the loadable extension is built into `dist/`.

## Working Rules

- Keep changes focused on the user's requested scope.
- Preserve unrelated local work. Inspect the worktree before editing and do not
  revert changes you did not make.
- Prefer existing project patterns and small modules over broad rewrites.
- When source behavior changes, run the relevant checks:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
- Treat `dist/` as build output. Update it only when the task requires a
  loadable extension build or when source changes must be reflected there.

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
