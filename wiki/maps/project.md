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
- `src/shared/i18n.ts` and `src/_locales/`: runtime UI translations plus Chrome
  manifest localization. The saved `settings.language` preference defaults to
  Russian and may be set to `auto` for browser-language detection.
- `tests/`: Vitest coverage grouped by shared behavior and marketplace integration.
- `scripts/qa-fake-ozon.mjs`: Playwright browser harness that loads `dist/` as
  an unpacked MV3 extension and serves fake Ozon product/API responses for
  end-to-end regression checks.
- `scripts/qa-live-ozon.mjs`: explicit live-Ozon smoke probe that loads `dist/`
  against a real product URL and can import a user-provided Ozon cookie or
  Playwright storage-state export.
- `dist/`: generated extension bundle loaded into Chrome/Chromium.

## Design Anchor

The root `DESIGN.md` is the design source for Markonverter. It is derived from
Ozon BrandLab and the extension's Ozon product-page context: light compact
surfaces, Ozon blue primary actions, restrained semantic state colors, and
price-card-width layouts. Do not reintroduce the old dark industrial/amber
dashboard look.

## Ozon Content UI

- Delivery-selector row actions should be drawn only for rows with an identified
  pickup-point id. Do not add per-row pending badges; use the assist status for
  loading state instead.
- The product-page panel should avoid repeating the same pickup point across
  separate saved, detected, and price lists. Saved points are comparison rows
  in the product panel; compare-selection belongs in the extension settings
  page. Destructive saved-row deletion may exist in the product panel only as a
  hover/focus action with reserved layout space so row dimensions do not jump.
  The detected list is only for unsaved Ozon candidates.
- Settings must not expose manual pickup-point creation or raw Ozon id entry.
  New Ozon pickup points should be captured from the product-page delivery
  selector so labels and ids come from the same visible Ozon context.
- When Ozon first exposes only a pickup-point id, content-script discovery should
  prefer later addressbook labels for the same id and silently update saved
  points only if their current name is an auto-generated id label.
- On product-page load, saved Ozon points with generic id labels should trigger
  read-only addressbook discovery, including product-context `/modal/addressbook`
  requests, so addresses can replace UUID labels without opening the selector
  manually. This discovery must not include `select_address`,
  `select_location`, or other saved-PVZ activation parameters.
- If background discovery still leaves generic saved labels, the content script
  may open the Ozon delivery selector once for that product/id set, then rerun
  read-only addressbook discovery while the visible selector rows are present.
  This mirrors the safe manual sequence of opening the selector and pressing
  `Refresh PVZ`; it must not click a PVZ row or select a saved point.
- Real Ozon addressbook refresh traffic can use
  `/modal/addressbook?set_sm=1&page_changed=true` and return
  `commonAddressBook` widget state rows where the pickup id is `addressBookId`
  and the address is stored in nested `elements[].text`. Treat that as first
  class PVZ label evidence.
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
- Product-page price rows must not activate saved Ozon pickup points through
  session-mutating addressbook endpoints. Saved rows should display only
  product-specific captured quotes or remain unavailable with current-page
  capture guidance. Do not reintroduce automatic saved-PVZ price lookup without
  fresh live fixtures and an explicit user decision.
- The injected product-page panel is nested under Ozon's price widget and must
  fit inside that price-card container. Prefer container-width CSS over widening
  Ozon's own layout.
- When Ozon already shows a selected delivery point and visible product price,
  or the delivery selector exposes a selected/current PVZ row, Markonverter may
  auto-save that visible price for the single saved point whose id/name evidence
  clearly matches. This is the supported price capture path.
- Live Ozon product pages may expose the opened pickup point through a compact
  `addressBookBarWeb` widget whose visible text is only a street/house label.
  Current-point capture must accept that smaller widget while keeping stricter
  visibility checks for modal/list row detection.
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
- The only safe exception is an opened selector list where an API/network
  payload exposes two or more ordered `select_address` ids and the visible
  selector text exposes the same number of unique ordered `Пункт Ozon № ...`
  labels. In that case labels may be paired by order only from the
  selector/addressbook item array, not from the whole API body. If current
  delivery text or a selected-address echo appears before the selector list,
  ignore it for this pairing. If Ozon appends extra non-PVZ address ids, match
  by visible Ozon point number where possible and only fall back to prefix order
  for the remaining clearly numbered PVZ labels.
- Keep session-mutating Ozon address activation out of the product-page price
  row flow. Request echoes, URL params, hrefs, debug fields, and tracking data
  are not confirmation for current-price capture.
- Some Ozon product responses confirm an internal selected-address id instead of
  the saved `select_address` id. Accept those aliases only if the activation
  response also confirms the saved id; never trust aliases that appear only in
  request echo, URL, href, query, debug, or tracking fields.
- Automated browser QA should use `npm run qa:ozon` when live Ozon returns 403,
  antibot, or no-connection pages. The fake-Ozon harness is allowed to prove
  extension behavior against controlled HTML and JSON, but its result is not
  proof that live Ozon private APIs are reachable.
- Live Ozon reachability checks should use `npm run qa:ozon:live -- --url ...`.
  If a fresh automated profile is blocked, rerun only with an explicit trusted
  cookie or storage-state export from the user; do not scrape normal browser
  profiles silently and do not present a 403/no-connection page as an extension
  failure.
- Use `OZON_QA_CAPTURE_CHECK=1 npm run qa:ozon:live` when debugging current-PVZ
  price capture against real Ozon. It saves the current detected PVZ in the test
  browser profile, clears only the captured quote, reloads the product page, and
  asserts that the opened PVZ price is captured again automatically.
- This checkout may have local-only live QA secrets in `.env.ozon.local`, which
  points `OZON_QA_COOKIES` at `.secrets/ozon-cookies.txt`. These files are
  gitignored and must not be committed, printed, or copied into docs. When
  present, run `set -a; source .env.ozon.local; set +a; npm run qa:ozon:live`.
- For live Ozon checks, first refresh those cookies from Arc with
  `rtk python3 .codex/skills/markonverter-ozon-live-check/scripts/export_arc_ozon_cookies.py`.
  The script reads only Ozon rows from Arc's cookie DB through the macOS
  `Arc Safe Storage` keychain item and writes the gitignored cookie file. If the
  refreshed-cookie probe still returns `LIVE_OZON_BLOCKED`, report Ozon/browser
  blocking separately from extension behavior.
- Cookie-only import may be insufficient after Ozon SSO/domain redirects. Also
  refresh Arc localStorage with
  `rtk node .codex/skills/markonverter-ozon-live-check/scripts/export_arc_ozon_storage_state.mjs`.
  It writes `.secrets/ozon-arc-storage-state.json`, which `.env.ozon.local`
  should expose through `OZON_QA_STORAGE_STATE`.
- Real Ozon replay fixtures should come from a trusted manual browser session:
  the page probe records relevant Ozon network responses, the content script
  stores a bounded buffer under `markonverter.ozonFixtures`, and the product
  panel's `Ozon fixtures` row can copy or clear that local buffer.
- The saved `settings.debug` flag defaults to `false`. Only debug mode should
  show the product-panel `Ozon fixtures` row, show unavailable-row `Copy
  details`, or store page-probe network fixtures.
- Product-panel confirmations should be inline UI, not native browser
  `confirm()` dialogs. Chrome can suppress repeated page dialogs after the user
  opts out, causing later destructive actions such as fixture clearing to
  auto-cancel.
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
