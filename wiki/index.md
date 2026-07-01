# Markonverter Wiki

This is the project-local LLM wiki. Use it for durable context that should
survive across agent sessions.

## Entry Points

- [Wiki log](log.md)
- [Knowledge maps](maps/README.md)
- [Project map](maps/project.md)

## Current Project Shape

- Chrome/Chromium Manifest V3 extension.
- Extension entrypoints: `src/entrypoints/`
- Content-page behavior: `src/content/`
- Marketplace adapters and integrations: `src/marketplaces/`
- Shared domain helpers: `src/shared/`
- Tests mirror source areas under `tests/`
- Loadable extension build: `dist/`
- Design system: `DESIGN.md`

## Maintenance Rule

Keep this page as the root map. When adding a durable wiki note, link it here or
from one of the maps linked here.
