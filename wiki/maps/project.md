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
- When Ozon first exposes only a pickup-point id, content-script discovery should
  prefer later addressbook labels for the same id and silently update saved
  points only if their current name is an auto-generated id label.
- If Ozon exposes a pickup-point id through `select_address` in HTML or JSON,
  parse nearby link text, subtitle, title, address, or similar fields before
  falling back to `Ozon pickup <id>`.
- Product-page price checks for saved Ozon pickup points run sequentially. Each
  check first tries Ozon's address-book `select_address` modal endpoint for that
  saved location id, then accepts a product price only when the product response
  confirms the same id. Keep this strict check to avoid showing a reused current
  address price under the wrong saved point.
- Some Ozon product responses confirm an internal selected-address id instead of
  the saved `select_address` id. Accept those aliases only if the activation
  response also confirms the saved id; never trust aliases that appear only in
  request echo, URL, href, query, debug, or tracking fields.
