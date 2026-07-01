# Project Map

## Purpose

Markonverter helps compare an Ozon product price across saved pickup points from
a browser extension panel.

## Main Areas

- `src/entrypoints/`: manifest-loaded background, content, page-probe, and options entrypoints.
- `src/assets/`: extension visual assets copied into the loadable bundle.
- `src/content/app.ts`: product-page controller and Ozon comparison workflow.
- `src/content/panel/`: product-page panel presentation assets.
- `src/content/page/`: product-page parsing helpers, such as visible price extraction.
- `src/entrypoints/options.ts` and `src/entrypoints/options.html`: extension settings UI.
- `src/marketplaces/`: marketplace registry and per-marketplace implementation folders.
- `src/marketplaces/ozon/`: Ozon adapter, private product-price API, and pickup-point capture logic.
- `src/shared/`: shared types, settings, comparison, validation, currency, and
  exchange-rate helpers.
- `tests/`: Vitest coverage grouped by shared behavior and marketplace integration.
- `scripts/qa-fake-ozon.mjs`: Playwright browser harness that loads `dist/` as
  an unpacked MV3 extension and serves fake Ozon product/API responses for
  end-to-end regression checks.
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
  falling back to `Ozon pickup <id>`. In JSON modal payloads, do not climb to a
  parent scope containing multiple pickup ids just because a sibling has an
  address label.
- Do not use whole Ozon modal JSON objects as pickup-point labels. Service
  metadata such as `url`, `layoutId`, `layoutVersion`, `pageType`, `ruleId`,
  and `referer`, plus internal source labels such as
  `api.composer-post-addressbook`, are not pickup-point names; keep the generic
  label until a real address/title/subtitle is found.
- Treat already-saved Ozon names made from modal metadata, URL-encoded
  fragments, UI actions such as `Удалить` / `Редактировать`, or bare row headers such as
  `Пункт Ozon •` as unsafe temporary labels. They may be replaced automatically
  by a real address label or the canonical `Ozon pickup <id>` fallback.
- Markonverter controls injected into the Ozon delivery selector must consume
  their own pointer, click, and keyboard events before Ozon row handlers see
  them. Saved badges still intercept clicks so a click on the badge does not
  select a pickup point or reload the Ozon page.
- Product-page price rows must not automatically select saved Ozon pickup
  points through `select_address`, `select_location`, or addressbook modal
  endpoints. That old auto-price path can change the user's real selected PVZ
  and reload the Ozon product page. Manual `Capture current` is the supported
  price path for saved points without a product-specific manual quote.
- Safe automation is allowed only in the opposite direction: when Ozon already
  shows a selected delivery point and visible product price, Markonverter may
  auto-save that visible price for the single saved point whose name/id evidence
  clearly matches the visible delivery summary.
- Generic saved labels such as `Ozon pickup <uuid>` may be upgraded from the
  visible current delivery block only when there is a single saved generic Ozon
  point, or when the same current DOM/API object exposes both the id and address
  text. Do not assign one visible address to multiple saved ids.
- Initial UUID labels happen when Ozon exposes a pickup id through
  `select_address`, `deliveryAddressOid`, or similar fields before exposing a
  nearby title/subtitle/address for that same id. Keep the generic label in that
  state; do not use unrelated page-level current delivery text as the address.
- Network/API response `textHint` is context for relevance and country inference,
  not pickup-name evidence. A real pickup name must come from the response body,
  URL-local HTML text, or a same-row/current-widget DOM source that also exposes
  the id.
- Keep any session-mutating Ozon address activation behind an explicit internal
  opt-in; do not call it from the product-page UI by default.
- Some Ozon product responses confirm an internal selected-address id instead of
  the saved `select_address` id. Accept those aliases only if the activation
  response also confirms the saved id; never trust aliases that appear only in
  request echo, URL, href, query, debug, or tracking fields.
- Automated browser QA should use `npm run qa:ozon` when live Ozon returns 403,
  antibot, or no-connection pages. The fake-Ozon harness is allowed to prove
  extension behavior against controlled HTML and JSON, but its result is not
  proof that live Ozon private APIs are reachable.
- Real Ozon replay fixtures should come from a trusted manual browser session:
  the page probe records relevant Ozon network responses, the content script
  stores a bounded buffer under `markonverter.ozonFixtures`, and the product
  panel's `Ozon fixtures` row can copy or clear that local buffer.
- A product-page-only real fixture can be insufficient for price/PVZ replay.
  A captured `webDelivery` widget may include address text and delivery dates
  but no `select_address`, `deliveryAddressOid`, or PVZ id. Its `priceBadge`
  metadata is delivery presentation state, not a product price; do not parse
  strings such as `SIZE_400` as prices.

## Structure Notes

- Keep MV3-loaded files in `src/entrypoints/`; `scripts/build.mjs` maps these
  source files back to the stable `dist/*.js` and `dist/options.html` names.
- Keep extension icons in `src/assets/`; the build copies them to `dist/assets/`
  for `manifest.json` icon references.
- Keep marketplace-specific Ozon code under `src/marketplaces/ozon/` instead of
  adding more top-level marketplace files.
- Keep content-script helpers under `src/content/` by responsibility. The
  product-page controller owns orchestration; pure page parsing and panel
  presentation should stay in subfolders.
