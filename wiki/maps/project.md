# Project Map

## Purpose

Markonverter helps compare an Ozon product price across saved pickup points from
a browser extension panel.

## Main Areas

- `src/content.ts`: product-page UI and content-script behavior.
- `src/options.ts` and `src/options.html`: extension settings UI.
- `src/marketplaces/`: marketplace adapters and Ozon-specific integration.
- `src/shared/`: shared types, settings, comparison, validation, currency, and
  exchange-rate helpers.
- `tests/`: Vitest coverage for shared behavior and marketplace integration.
- `dist/`: generated extension bundle loaded into Chrome/Chromium.

## Design Anchor

Use `DESIGN.md` as the source of truth for UI and visual design decisions.

## Ozon Content UI

- Delivery-selector row actions should be drawn only for rows with an identified
  pickup-point id. Do not add per-row pending badges; use the assist status for
  loading state instead.
- The product-page panel should avoid repeating the same pickup point across
  separate saved, detected, and price lists. Saved points are managed from their
  comparison rows, and the detected list is only for unsaved Ozon candidates.
