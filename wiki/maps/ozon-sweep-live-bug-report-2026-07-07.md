# Live bug report: Ozon auto price sweep — reload loop + prices never captured (2026-07-07)

Reproduced on real Ozon with the user's exact production config (instrumented
Playwright probe, dist/ unpacked extension, fresh Arc cookies, temp profile).
Probe script (session scratchpad): `sweep-probe.mjs`; raw logs `run1.log`/`run2.log`.

## User complaints

1. Prices often do not auto-populate.
2. Auto-pricing triggers a long reload cycle: ~5 reloads, 15+ seconds per page.

Both reproduced.

## Reproduction setup

- Settings: user's real config — 1 saved pickup point
  `Буинск, ул. Вахитова, 174Б`, `externalLocationId =
  daa6eeff-8093-429a-9fee-9c73e5ef6036` (an **addressbook address UUID**,
  comment: "Captured from api.composer-addressbook-/modal/addressbook"),
  `manualQuotes` emptied so the sweep triggers.
- Run 1: bicycle product 2103540263 (ozon.ru). Run 2: monitor 3733836597.

## Measured results

| metric | run 1 | run 2 |
|---|---|---|
| page reloads | 4 | 3 |
| time first load → settled panel | ~23 s | ~22 s |
| captured quotes at end | **0** | **0** |
| extension API requests during visit | 216 | 95 |
| of them select_address activations | 60 | 24 |
| HTTP 403 responses | 0 | **89 of 95** |
| final panel | «Недоступно: Ozon не подтвердил этот ПВЗ…» | «…HTTP 403; …HTTP 403» (raw error shown to user) |

Run-1 sweep timeline (t from navigation):
- t≈9s silent sweep starts → 12 `select_address=daa6eeff…` requests
  (GET/POST × composer/entrypoint × 3 modal variants); responses keep
  `location.current` unchanged → activation never confirmed.
- t≈14s restore step activates `select_address=17858` (an **area id**, see
  root cause 1) — also unconfirmed → handoff to reload sweep with
  `originalActive="17858"`, `pending=["daa6eeff…"]`.
- t≈18.6s reload #2 (switch attempt), capture unconfirmed → `retriedHead`.
- t≈22.4s reload #3 (retry), unconfirmed again → return stage 2.
- t≈25.8s reload #4 (return), finalize; panel settles at t≈26.6s with
  "Недоступно", zero quotes.

Because nothing is ever captured and the swept marks live in per-tab
sessionStorage, **the whole cycle repeats for every product page in every new
tab session** — this is the user-perceived "~5 reloads / 15+ s per page".

## Root causes (evidence-backed)

### 1. ID-space mismatch: addressbook UUID vs what Ozon echoes (primary)

Ozon composer/entrypoint responses expose the selected location only as:

```
location.current.areaid = 17858                                   (city/area id)
location.current.fias   = 58e5a396-77c4-4ab6-b235-afe364c0580f    (FIAS id of Буинск)
location.current.uid    = 58e5a396-77c4-4ab6-b235-afe364c0580f
```

The saved point's id `daa6eeff-…` (addressbook address id) **never appears in
any selected-location path**, even though that address is the active one.
Consequences:

- `fetchOzonSelectedLocationId` returns `17858` (or null) →
  `originalActive ≠ point.externalLocationId` → the extension always believes
  the saved point is not active → sweep always runs, on every product.
- Price confirmation in `fetchOzonPrivatePrice` requires the response to echo
  `daa6eeff…` at a location path → never true → "response did not confirm
  requested pickup point" → **no price is ever recorded via the API path**.
- The sweep "restore" step calls `select_address=17858` — passes an area id
  where an address id is expected; also never confirms, which is what forces
  the silent-sweep → reload-sweep handoff (extra reloads).
- This also matches the existing warning in the extension-qa skill:
  addressbook `select_address` ids are not usable as product-price selectors.

### 2. Reload-sweep state machine multiplies reloads on a doomed confirmation

With confirmation impossible (cause 1), each product visit costs:
1 initial load + 1 switch reload + 1 `retriedHead` retry reload + 1–2 return
reloads = **3–5 loads, ~20–25 s**, ending in zero captured prices. The retry
and return stages assume confirmation failure is transient; here it is
structural, so every stage is wasted work.

### 3. Request flood trips Ozon antibot → session-wide HTTP 403

One product visit fired 216 extension API calls (60 of them select_address
activation variants: 4 endpoints × 3 modal variants × silent sweep + reload
stops + restore). In run 2 (same IP/cookies, minutes later) **89 of 95
requests returned 403 from t≈5 s**, including plain composer page reads; the
panel then shows the raw error text "HTTP 403" to the user. So after a few
product pages the extension's own traffic can get the session flagged and
*all* auto-pricing (and detected-point discovery) goes dark — a second,
independent reason for "prices don't populate".

### 4. Visible-price auto-capture has no match to fall back on

On the settled final page the delivery-summary selector set
(`[data-widget*="delivery"], [data-widget*="address"],
[href*="/modal/addressbook"]`) yielded **zero visible text chunks** (widget
lazy-loaded/absent, and in run 2 the page was in the 403-degraded state), so
`findSavedPickupPointForVisibleDelivery` never matched and
`autoCaptureCurrentVisibleQuote` never fired. The user's two pre-existing
quotes (3013 ₽, 5351 ₽, deliveryText "ул. Вахитова, 174б") show the visible
path works only when the delivery widget is actually rendered.

## Minor observations

- Panel is briefly removed during Ozon SPA hydration ("Mismatching
  childNodes(server) vs. VNodes(client)" console warning) and re-attached by
  panel recovery — visible flicker, no functional loss.
- Test-harness note: seeding `chrome.storage.local` right after SW start can
  be overwritten by `onInstalled`'s `ensureSettings` (known QA-skill race);
  probe now writes-verifies-rewrites.

## Debug-relevant fix directions (not applied)

- Identity: store/accept the id aliases Ozon actually echoes
  (`location.current.uid`/fias/areaid) alongside the addressbook id, or
  resolve the addressbook id → confirmed alias once at save time; treat
  "saved point matches current fias/area" as active-point confirmation.
- Cost control: cap activation candidates (one endpoint × one modal variant
  first, escalate only on failure); a doomed id (never-confirming) should be
  remembered per session to skip retry+return reloads.
- 403: back off on first 403 and surface a human-readable "Ozon временно
  блокирует запросы" instead of raw error text.

## Fix status (2026-07-07)

Implemented (causes 2 & 3 — mechanical, no schema/trust changes):

- `activateOzonPickupLocation` / `fetchOzonPrivatePrice` / `fetchOzonSelectedLocationId`
  now break out of their candidate loop immediately on the first HTTP 403, and
  `activateOzonPickupLocation` also stops as soon as one candidate confirms
  (previously it always burned all 12 candidates regardless).
  `src/marketplaces/ozon/private-api.ts`.
- A session-wide 60s throttle (`markOzonSweepThrottled`/`isOzonSweepThrottled`
  in `src/content/ozon-sweep-session.ts`) is set on the first 403 seen by
  either sweep and checked before starting a new sweep, so a blocked session
  stops hammering Ozon instead of repeating the full reload cycle.
- A per-tab-session "doomed" mark (`markOzonPickupActivationDoomed`/
  `isOzonPickupActivationDoomed`) is recorded the first time a point's
  activation fails to confirm after full escalation (silent sweep) or after
  the reload-sweep's retry also fails. Doomed points are filtered out of
  every subsequent sweep attempt in that tab session — the addressbook-UUID
  case in this report no longer repeats the 3-5 reload dance on every later
  product page, only once per tab session.
- The raw `"...: HTTP 403; ..."` text no longer reaches the panel: a
  dedicated `OZON_REQUESTS_THROTTLED_MESSAGE` error is thrown and rendered
  via a new `panelOzonThrottled` i18n string ("Ozon временно блокирует
  запросы, попробуйте позже.") in `src/content/panel/sections.ts`.
- Tests: `tests/marketplaces/ozon/private-api.test.ts` (403 short-circuit +
  throttled error, confirm-early-break) and new
  `tests/content/ozon-sweep-session.test.ts` (doomed/throttle helpers).
  `npm run typecheck`, `npm test` (108 passed), `npm run build` all clean.
- An Opus review pass on the first version of this fix caught two real bugs,
  both fixed in the same commit: (1) the silent sweep was marking a point
  doomed on *any* non-region failure, including transient network errors —
  now gated behind a new `isOzonPickupNotConfirmed` check so only a genuine
  "Ozon never confirmed this pickup point" failure dooms it; (2) a 403 mid-run
  only stopped *new* sweeps from starting, not the sweep already in progress
  — the silent-sweep loop and the reload-sweep's `continueOzonPriceSweep` now
  both check the throttle flag and abandon remaining pending points
  immediately instead of continuing to reload/retry through them.

Not implemented — still needs a decision, not a guess:

- **Root cause 1 (id-space mismatch)** is the one that actually gets prices
  to populate for this exact user config. Fixing it means extending
  `PickupPoint` with a persisted alias id (areaid/fias/uid) and picking how
  to learn it — analysis during this pass found the obvious approach
  (persist the `aliases` `activateOzonPickupLocation` already discovers)
  cannot work for this case: Ozon's `select_address` response for this
  addressbook id never echoes any relationship to the resulting areaid/fias
  at all, so there is nothing in that response to learn from. A real fix
  needs either a reverse address→fias/areaid lookup at save time (endpoint
  not yet identified) or piggybacking on `findSavedPickupPointForVisibleDelivery`'s
  already-working fuzzy text match to opportunistically record an alias when
  a point is confirmed active by name/comment — which changes the
  price-confirmation trust boundary and needs explicit sign-off.
- **Root cause 4** (visible-price auto-capture finds no delivery-widget text
  on the settled page) is a separate DOM-selector live-diagnosis task.

## Fix status (2026-07-08) — root cause 1 landed

Signed off by the user ("land a fix"); implemented via the
visible-match-piggyback option above:

- `PickupPoint.locationAliasIds` (persisted, `src/shared/types.ts`) stores the
  area-level ids Ozon actually echoes for a point's address (areaid/fias/uid).
  Normalized in `src/shared/validation.ts`: only id-shaped values (numeric or
  UUID — a stray city slug must not confirm price reads), deduped, capped at 4.
- Learning (`learnOzonLocationAliasForActivePoint` in
  `src/content/ozon-quote-capture.ts`): the one trusted moment is right after
  `autoCaptureCurrentVisibleQuote` fuzzy-matched the visible delivery text to
  a saved point and got a valid quote. One `fetchOzonSelectedLocationId` read,
  attempted once per point per page load and only while the point has no
  aliases. `canLearnOzonLocationAlias` (pure, `pickup-matching.ts`) refuses an
  id already owned by another saved point, so two same-city points cannot
  cross-confirm. Learning clears the point's session doom mark.
- Confirmation: `fetchOzonPrivatePrice` accepts `pickupLocationAliasIds` for
  response confirmation only (never as extra request candidates — they are
  area ids, useless as activation parameters and would multiply requests).
  The per-row read in `app.ts` and both sweep reads pass them. Trust boundary
  note: alias confirmation is city/area-level; Ozon prices are per city
  cluster, so this is the correct granularity for price capture.
- Active-point recognition: both sweeps resolve Ozon's selected id through
  `findOzonPickupPointByLocationId`/`ozonPointMatchesLocationId`, so a point
  saved under an addressbook UUID is recognized as already active and is
  never swept onto; sweep state stores the selectable addressbook UUID as
  `originalActive`, and the restore/return stage comparisons are alias-aware.

Live verification (instrumented Playwright probe, real Ozon, same replica
UUID as this report; results split across runs because Ozon lazy-hydrates
the delivery widget and antibot-flags the automated profile over time):

- Alias learning fired live and persisted `locationAliasIds=["17858"]` — the
  exact areaid this report recorded for Буинск.
- With the alias known, the next product page captured its quote in ~5.5 s
  with 0 select_address activations and no extra reloads.
- Pre-learning worst case is now bounded: silent sweep runs one candidate
  escalation in place (12-13 requests, 0 page reloads — restore verified via
  the selected-id read), dooms the point for the tab session, later pages
  skip it. Previously 3-5 reloads and ~60 activations per product page.
- 403 handling from the 2026-07-07 fix confirmed live: sweep stopped after
  1 activation on the first 403 and the panel showed the localized
  "Ozon временно блокирует запросы" message.
- `npm run typecheck`, `npm test` (115), `npm run build`, `npm run qa:ozon`,
  and `npm run qa:ozon:live` (LIVE_OZON_OK, panel attached) all green.

Root cause 4 (delivery widget text often absent until hydration) remains
open, but is now only a latency issue for *first-time* learning: once any
page has matched the point visibly, every later page is priced through the
alias-confirmed API read without needing delivery text at all.

## Fix status (2026-07-08, second pass) — sweep-time learning

User live-tested the two-point config (Astana active + saved {Буинск,
Астана}) and Buinsk still ended «Недоступно» after
reload→Буинск→reload→Буинск→Астана. Gap in the first pass: learning lived
only in the visible-delivery auto-capture path, which is disabled while a
sweep runs (`captureCurrentVisibleQuoteFromLatestSettings` bails on
`isOzonSweepBusy() || loadOzonSweepState()`) — but a point that is not the
user's own active point is *only ever active mid-sweep*, so its alias could
never be learned; the confirmation then failed forever and the `retriedHead`
retry produced the double reload.

Second-pass fix (`learnOzonAliasAfterSweepActivation` in
`src/content/ozon-sweep.ts`, decision logic pure in
`chooseOzonSweepLearnedAlias`): the sweep itself just issued select_address
for the point, so when the reported selected id verifiably moved off the
sweep's origin and no other saved point owns it, it is learned as the
point's alias and the same price read confirms through it. Applied to both
the silent sweep's not-confirmed branch (learn → retry read in place → only
doom when the selection never moved) and the reload sweep's capture stop
(first stop resolves → no retry reload). Reload-sweep pending additionally
skips already-quoted points (kept in `priced` for the finish target).

Live two-point probe (real ozon.kz session, replica of the active point
under a never-echoed UUID + the real Буинск UUID): Buinsk alias `17858`
learned mid-sweep, 37 973 ₽ captured in ~20 s, exactly one activation, no
double reload, 0×403; active-point replica captured 229 688 KZT + alias
`40723` via the visible path; panel showed both rows with delta. Probe
artifact: its fake replica UUID is not selectable, so the return leg ended
on ozon.ru/Буинск — real addressbook UUIDs restore fine (session verified
back on Астана, areaid 40723, afterwards).
