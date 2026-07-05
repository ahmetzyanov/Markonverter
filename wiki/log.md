# Wiki Log

Use this file for short dated entries about durable project decisions, wiki
updates, and non-trivial implementation changes.

## 2026-06-30

- Created the project-local LLM wiki scaffold with a root map, log, and maps
  area.
- Added root agent instructions in `AGENTS.md`, including the rule to follow
  `DESIGN.md` for design work.
- Stabilized Ozon delivery-selector row actions by anchoring controls to
  normalized pickup-point cards, isolating their CSS from Ozon button styles,
  and skipping the Ozon "add address" control.
- Merged saved pickup-point management into the price rows: removed the separate
  `Points` toggle, show detected Ozon candidates only when unsaved, and avoid
  per-row pending badges in the Ozon delivery selector.
- Added automatic Ozon pickup-point name resolution: generic id labels can be
  replaced by addressbook labels for the same external id, including saved
  points whose names were auto-generated from UUIDs.
- Tightened pickup-point label extraction so `select_address` ids can use nearby
  HTML/JSON address text instead of staying as `Ozon pickup <uuid>`.
- Added best-effort automatic Ozon pickup-point activation before each saved
  point's product price fetch, with sequential checks and strict response
  confirmation retained to prevent current-address price reuse.
- Extended Ozon pickup activation to accept internal selected-address aliases
  only when they come from a response that also confirms the saved pickup id;
  request echoes remain untrusted.
- Allowed Ozon product prices to use the immediately preceding confirmed
  address selection when the product response has no selected-location id, while
  still rejecting product responses that explicitly confirm a different point.
- Blocked Ozon modal service metadata from becoming pickup-point names; JSON
  fragments with `layoutId`, `pageType`, `ruleId`, `referer`, or empty `url`
  and internal API labels such as `api.composer-post-addressbook` now fall back
  to the generic id label unless a real address label is present.
- Hardened bad-name repair for Ozon pickup points that were already saved with
  modal metadata, URL-encoded fragments, or `Удалить`, and made Markonverter
  controls in Ozon's delivery selector consume their own clicks so they do not
  pass through to Ozon row handlers.
- Rejected bare Ozon pickup row headers such as `Пункт Ozon •` as pickup-point
  names; these temporary labels now wait for a real address or fall back to
  `Ozon pickup <id>`, without borrowing a sibling address from the same modal
  JSON payload.
- Refactored the source layout around stable responsibilities: MV3 entrypoints
  moved to `src/entrypoints/`, content-script behavior moved under
  `src/content/`, Ozon marketplace internals moved under
  `src/marketplaces/ozon/`, and tests now mirror shared and marketplace areas.
- Added a minimalist Markonverter extension icon source under `src/assets/` and
  wired Chrome manifest icon sizes into the loadable extension build.

## 2026-07-01

- Updated Ozon saved-pickup activation to try the product-scoped
  `select_address` modal form with `src_main=<product path>` and
  `page_changed=true` before older fallbacks, matching real product-page
  addressbook traffic more closely while preserving strict location
  confirmation.
- Added a fake-Ozon browser QA harness (`npm run qa:ozon`) so agents can verify
  the unpacked MV3 extension end to end without trying to bypass Ozon antibot
  responses. The harness intercepts product/API traffic locally and keeps live
  Ozon reachability as a separate status.
- Added a panel-level Ozon fixture recorder that stores bounded real
  same-session Ozon network payloads from the page probe in `chrome.storage`
  and exposes `Copy` / `Clear` controls for turning trusted manual Ozon sessions
  into replay fixtures.
- Inspected a trusted manual Ozon fixture export from a real product page and
  used its delivery-widget shape to block `priceBadge.size` metadata such as
  `SIZE_400` from being parsed as a product price. That export did not include
  `select_address`, `deliveryAddressOid`, or PVZ ids, so full multi-PVZ replay
  still requires recording the delivery/addressbook modal interaction.
- Disabled automatic Ozon addressbook/PVZ activation in the product-page UI.
  Real fixture evidence showed the old auto-price path could switch the user's
  selected Ozon PVZ and reload the product page, while reliable multi-PVZ auto
  pricing never materialized. Manual `Capture current` remains the safe price
  path.
- Added safe current-point auto-capture: when the visible Ozon delivery summary
  clearly matches exactly one saved Markonverter pickup point, the extension
  saves the visible product price as that point's product-specific manual quote
  without sending Ozon any address-selection request.
- Blocked Ozon's `Редактировать` action text from becoming a saved pickup-point
  name, added automatic repair for already-saved Ozon points with unsafe action
  labels, and covered the recovery path in the fake-Ozon browser harness.
- Improved Ozon pickup-name resolution for generic `Ozon pickup <uuid>` labels:
  current delivery widgets now contribute structured address/id evidence, and a
  single saved generic point may be renamed from the visible delivery address
  without sending Ozon a PVZ-selection request.
- Fixed a PVZ name-corruption path where network/API candidate extraction could
  use page-level current delivery `textHint` as the name for an echoed
  `select_address` id. Saved-name repair now also refuses to apply one
  non-generic candidate label to multiple different Ozon ids.
- Restored safe `Refresh PVZ` address resolution for selector lists whose API
  payload exposes ordered ids while the open selector exposes ordered visible
  labels. Pairing now uses selector/addressbook item arrays instead of whole
  API response text, so selected-address echoes before the list cannot shift or
  block the mapping. The repair also handles real selector lists where Ozon
  appends a non-PVZ address id after PVZ rows.
- Replaced product-panel browser confirmation dialogs with inline panel
  confirmations for manual capture, saved-PVZ deletion, and fixture clearing.
  Chrome can suppress repeated native dialogs after "do not ask again", which
  makes destructive buttons look broken because `confirm()` auto-cancels.
- Trimmed Ozon selector service text such as `Срок хранения заказа` from
  visible PVZ row names before saving or repairing pickup-point labels.
- Added automatic read-only Ozon PVZ name refresh on product-page load for
  saved points whose names are still generic UUID labels. The refresh uses
  product-context addressbook discovery and still avoids `select_address` /
  `select_location`, so it updates labels without changing the selected Ozon
  delivery point.
- Made the Ozon product-page panel size to the price-card container it is
  injected into, with compact row/header layout triggered by the container
  width rather than only by the browser viewport.
- Fixed the first-load PVZ name refresh to match the real manual flow: when
  background addressbook discovery is not enough, Markonverter opens the Ozon
  delivery selector once, refetches read-only addressbook data while selector
  row labels are visible, and repairs generic saved labels from that combined
  evidence.
- Used captured real Ozon fixtures for product `2103540263` to add the missing
  read-only `/modal/addressbook?set_sm=1&page_changed=true` discovery endpoint
  and parse `commonAddressBook` rows that expose `addressBookId` plus nested
  `elements[].text` address labels.

## 2026-07-02

- Dropped automatic saved-PVZ price lookup again after it changed the selected
  Ozon pickup point on page reload. Price capture is focused on the currently
  visible/opened Ozon PVZ: saved rows show product-specific captured quotes or
  remain unavailable with current-page capture guidance.
- Added a separate live-Ozon smoke probe (`npm run qa:ozon:live`) for checking
  a real product page with the unpacked extension. It accepts explicit cookie or
  Playwright storage-state exports from a trusted browser session and reports
  Ozon 403/no-connection blocks separately from fake-harness regressions.
- Stored the working Ozon live-QA session in local ignored files:
  `.env.ozon.local` points to `.secrets/ozon-cookies.txt`. Future agents should
  use the paths only and avoid printing or committing cookie contents.
- Fixed current/opened PVZ price capture on live Ozon reloads. The real product
  page exposed the opened point through a small `addressBookBarWeb` widget with
  only `ул. Вахитова, 174б`, which the previous visibility filter ignored.
  Current-delivery capture now accepts compact address widgets, the fake harness
  covers the street/house-only case, and live QA has
  `OZON_QA_CAPTURE_CHECK=1` for the save-clear-reload capture path.
- Fixed CBR/NBK XML rate parsing so the KZT/RUB reader selects the exact
  currency item block instead of spanning from the first currency entry to the
  target one. Saved implausible KZT-to-RUB rates such as `53.96` are now
  normalized back to the safe default until a fresh provider update succeeds.
- Simplified saved-PVZ rows in the product panel: removed product-panel
  comparison checkboxes, the `Add current` header button, misleading
  country/currency metadata under saved names, and visible delivery/capture
  metadata under prices. Compare selection now lives on the settings page;
  saved-row deletion is a hidden hover/focus action with reserved layout space
  so rows do not jump on hover.
- Removed manual pickup-point creation from the settings page. Ozon points are
  now added from the product-page delivery selector, while settings keep saved
  point comparison, ordering, and deletion controls.
- Added extension localization with Russian as the default language. Chrome
  manifest strings live in `_locales/`, while runtime UI strings use
  `src/shared/i18n.ts` so options and the Ozon panel can honor the saved
  `settings.language` preference, including `auto` browser-language detection.
- Moved unsaved Ozon PVZ candidates below saved pickup rows and made that
  candidate list collapsible. It defaults expanded until at least two Ozon
  pickup points are saved, then defaults collapsed while keeping a manual
  expand/collapse override for the current product page.
- Stabilized fake-Ozon QA around the new localization layer by seeding an
  explicit Russian language preference, checking the settings-page language
  switch, using the language-independent comparison-state button in options, and
  accepting both Russian and English RUB formatting in price assertions.

## 2026-07-03

- Added project-local skill `markonverter-ozon-live-check` with an Arc cookie
  refresh script at
  `.codex/skills/markonverter-ozon-live-check/scripts/export_arc_ozon_cookies.py`.
  The script exports only Ozon cookies from Arc using macOS `Arc Safe Storage`
  and rewrites the gitignored `.secrets/ozon-cookies.txt` file without printing
  cookie values.
- Refreshed Arc Ozon cookies successfully (`count=26`, zero decrypt failures)
  and reran `npm run qa:ozon:live`. The live probe still returned
  `LIVE_OZON_BLOCKED` after importing cookies, for both the saved `ozon.ru`
  product URL and the same path on `ozon.kz`, so current evidence points to
  Ozon/browser/network blocking rather than stale local cookies.
- After re-login in Arc, refreshed cookies again (`count=27`) and found that
  Ozon also needed Arc localStorage state for the SSO/domain redirect path.
  Added storage-state export to `markonverter-ozon-live-check`, generated
  `.secrets/ozon-arc-storage-state.json`, tightened the live block detector to
  avoid hidden-text false positives on real product pages, and verified
  `LIVE_OZON_OK status=200 panel=attached` with the unpacked extension.

## 2026-07-04

- Replaced the unrelated dark gstack `DESIGN.md` with Markonverter-specific
  Ozon-derived design rules: light compact surfaces, Ozon blue primary actions,
  restrained magenta, neutral borders, and price-card-width panel layouts.
- Redesign scope includes the options page, injected Ozon product panel,
  delivery-selector helper controls, and extension icon assets.
- Added a saved `debug` setting, defaulting to `false`. Debug mode now gates the
  product-panel Ozon fixture controls, unavailable-row `Copy details`, and
  page-probe network fixture storage.
- Changed product-panel collapse so the header remains the same, including the
  settings and collapse controls, while only the body content is hidden.
- Reintroduced automatic saved-PVZ price capture under a stricter contract:
  Markonverter first tries a verified non-mutating Ozon price request, then
  falls back to sequential `select_address` activation only when needed, saves
  product-specific captured quotes, and restores the originally selected Ozon
  point when it can identify it. Saved Ozon pickup points are capped at 4 to
  bound the activation/restore loop.
- Replaced that background `select_address` activation with a visible price
  sweep. Pricing a non-active PVZ silently changed the user's active Ozon
  delivery address, desyncing the page from the server so the native PVZ button
  jumped to the next point instead of opening the picker. The sweep now switches
  the address and reloads the product page onto each saved point in turn (state
  in `sessionStorage`), records its confirmed price, then reloads back to the
  original point — or, when the original point cannot deliver the product, to an
  available one. Comparison pricing no longer mutates the session at all, so the
  native selector behaves normally. The sweep runs once per tab session per
  product; a guarded silent-activation path is left as a TODO (option 3).
- Made the sweep return to the exact pickup point it started on. The original
  point is read from Ozon's own selected-address state (`fetchOzonSelectedLocationId`)
  rather than guessed from the DOM, and the original page URL is remembered. When
  visiting a pickup point flips the Ozon domain (e.g. an `ozon.ru` Kazan product
  to `ozon.kz`), the return first navigates back to the original URL and then
  reselects the original point there, since the private API can only switch the
  active address same-origin.

## 2026-07-05

- Hid the secondary original-price label in saved-PVZ product rows when the
  original pickup-point currency already matches the default comparison
  currency. Cross-currency rows still show both the converted comparison price
  and the source-currency price.
- Fixed product-panel width inside wide Ozon price cards by removing the
  ordinary-panel 398px cap; that cap now applies only to floating fallback
  panels.
- Added an orange saved-PVZ warning for Ozon responses that confirm a pickup
  point but say `Товар не доставляется в ваш регион`. That state no longer
  offers `Capture current`, and the lookup flow restores an available pickup
  point when one was priced successfully.
