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

## 2026-07-06

- Ozon pickup capture no longer emits candidates keyed by weak city/region ids
  (`cityId`, `geoId`, `regionId`, plus `_`/`oid`/`uid` variants) — a point
  saved under such an id "verifies" against nearly every response for the
  city. `locationId` stays as a weak key.
- `upsertPickupPoint` / `upsertManualQuote` now return a discriminated
  `SettingsWriteResult` (`saved: true` | `saved: false, reason:
  "invalid"|"limit"`). Background maps dropped writes to
  `{ok: false, reason}` instead of replying `{ok: true}` with unchanged
  settings; the content panel shows the localized limit / not-saved message.
- app.ts split, step 1 of 3: extracted the pure pickup-matching string logic
  (~250 lines: `findSavedPickupPointForVisibleDelivery`,
  `scoreVisiblePickupMatch`, `pickupMatchTokens`,
  `matchDetectedPickupCandidateToRow`, label/display-name helpers) into
  `src/marketplaces/ozon/pickup-matching.ts`. No behavior change; the
  `latestPickupCandidates` global is now passed as a parameter at the three
  call sites. New unit tests pin the matching behavior. Remaining steps:
  delivery-menu assist, then the sweep state machine.
- TODO decision still open: the positional `labels[i] -> entries[i]`
  counts-differ pairing fallback in pickup-capture is covered by a test
  ("pairs visible selector labels when Ozon appends a non-PVZ address id after
  pickup rows"), so dropping it regresses an intended scenario; guarding it
  needs a design call.
- First automated Chrome Web Store release shipped: v0.2.0 published via
  `.github/workflows/release.yml` on tag push, with all four `CHROME_*` repo
  secrets configured. Release procedure documented in
  [maps/release.md](maps/release.md); v0.1.0 had been uploaded by hand.
- Research: no-reload pricing of all saved PVZ (replace the visible reload
  sweep). Findings, no code change:
  - History: silent background `select_address` activation was reverted
    (41f123a) because it desynced page JS from the server session; the reload
    sweep (option 2) is the current design. `TODO(option 3)` in
    `src/content/app.ts` sketches a guarded silent-activation path.
  - Open empirical gap: a *bare* `page/json/v2?url=<product>&deliveryAddressOid=<id>`
    GET (no `select_address` call) was never tested in isolation — in the old
    code it only ran after activation (`includeLocationCandidates` is gated
    behind `allowSessionMutatingLocationActivation`). Nobody knows whether it
    (a) returns a price computed for that non-active point, and (b) mutates the
    session. If (a) without (b), a no-reload compare is a small change.
  - Automated verification is currently impossible: with refreshed Arc
    cookies+localStorage the *page* loads (`LIVE_OZON_OK`) but every composer
    API fetch from a Playwright context (persistent or not, with or without
    the webdriver flag) returns a 403 challenge page. Note `LIVE_OZON_OK`
    proves page+panel load only, not composer-API reachability.
  - The isolated test must run in the user's real browser: 4 read-only
    requests — baseline product `page/json/v2` (selected id + price),
    read-only `/modal/addressbook?set_sm=1&page_changed=true` (collect other
    ids), product `page/json/v2` with `&deliveryAddressOid=<other id>`
    (check confirmation + price), baseline again (check mutation), restoring
    via `select_address` only if mutated.
  - Probe result (real Arc session, console, ozon.kz product): the bare
    `deliveryAddressOid` GET is **inert** — response identical to baseline
    (same selected ids, same `webPrice`), target id not confirmed, session not
    mutated. No stateless per-point pricing via that GET. Probe #2: composer
    POST with `deliveryAddressOid` body returns **404**; entrypoint-api GET
    with the param is inert like the composer GET. Conclusion: **Ozon has no
    read-only per-point pricing path** — the price is always computed for the
    session's active delivery address. A no-reload compare therefore requires
    session mutation (option 3); "simple price loading" is not achievable.
  - If the bare param is inert/mutating, the fallback design is option 3
    (activate → API price read → restore → confirm restore), now more viable
    than at revert time because `fetchOzonSelectedLocationId` gives a reliable
    restore target; main risks stay: native selector desync during the window,
    and antibot request volume (see TODO "Reduce private-API request volume").
- Implemented option 3: silent Ozon price sweep in `src/content/app.ts`
  (`runOzonSilentPriceSweep`), tried before the visible reload sweep, which
  stays as the fallback for anything left unpriced. Per pending point:
  `select_address` activation + confirmed private price read
  (`allowSessionMutatingLocationActivation`), then restore of the original
  point read from `fetchOzonSelectedLocationId`, with one resync
  `location.reload()` only when the restore cannot be confirmed. Guards, all
  shaped by the 41f123a desync revert and an Opus gate review: never starts
  (and stops mid-run) when the native delivery selector is open, waits up to
  30s for it to close before restoring, aborts on `runId` staleness (SPA
  navigation) and then skips the resync reload since the new page already
  reflects the mutated session, and runs once per product per tab session via
  `markonverter.ozonSilentSwept.v1:<productId>` (requires persistable
  sessionStorage so a failed-restore reload cannot loop). Known ceilings: a
  server-side failed restore can land the user on the last-swept point, and a
  selector dismissed after the 30s timeout can leave a bounded desync until
  the user's own selection resets it. Verified: typecheck, 95 unit tests,
  `qa:ozon` (BROWSER_QA_OK), live `LIVE_OZON_OK` on the ozon.kz product URL
  (ozon.ru redirect was antibot-blocked that run).

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

- Full-project review pass (bug fixes + structure cleanup):
  - Pickup-id confirmation in `private-api.ts` now requires token boundaries
    (`textContainsLocationId`); a response mentioning id `123456` no longer
    confirms requested id `12345`. Price ambiguity guard now compares the best
    candidate against every tied-score candidate, not just the second one, and
    `parsePrice` rejects JSON-looking strings so serialized widget blobs cannot
    concatenate into a bogus "verified" amount.
  - `background.ts` serializes all settings writes through a promise queue
    (`mutateSettings`); concurrent tab/sweep saves no longer lose updates.
    Currency-rate refresh re-reads current settings before writing.
  - Options page listens to `storage.onChanged` and refreshes its snapshot, so
    "Save" there no longer clobbers quotes/points captured by content scripts
    while the page was open. `SETTINGS_KEY` moved to `shared/settings.ts`.
  - `exchange-rates.ts` keeps the fetch timeout armed through the body read;
    a provider that stalls after headers can no longer hang `GET_SETTINGS`
    (and thus the product panel) forever.
  - Ozon sweep refuses to start when `sessionStorage` cannot persist state
    (probe write/read/remove), preventing an infinite reload loop in privacy
    modes. Page probe clones only relevant fetch responses and skips
    `xhr.responseText` for non-text `responseType`. Content script latches
    "extension context invalidated" and stops its 1s recheck timer instead of
    throwing forever after an extension reload.
  - Panel confirmations are no longer dismissed by background re-renders;
    renders are deferred until the user answers. Delivery-assist
    MutationObserver is debounced (100 ms) instead of syncing per mutation.
  - Removed the speculative marketplace registry, the unreachable Wildberries
    placeholder adapter, and the unused `fetchPrice`/`formatError` adapter
    surface; `content/app.ts` now imports `isOzonProductPage` /
    `getOzonProductIdentity` directly from `marketplaces/ozon`. The
    `MarketplaceId` union and stored-data handling for `wildberries` points
    stay for data compatibility.
  - `ratesToRub.RUB` is pinned to 1 (it is the base of the rate table; any
    other value silently rescaled all conversions). The "1 RUB in RUB" input
    was removed from options — divergence from the previous options layout is
    deliberate: the field could only hold one valid value.
  - `qa-live-ozon.mjs --keep-open` no longer deletes the temporary profile out
    from under the still-running browser. Fixture records keep their stored
    `responseTruncated` flag across storage round-trips.
