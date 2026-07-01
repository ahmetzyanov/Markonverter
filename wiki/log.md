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
