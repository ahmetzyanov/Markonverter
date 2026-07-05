# TODO

## Deferred from the 2026-07-05 review

Found during the full-project review but deliberately not done in that pass
(each is a behavior-sensitive change that deserves its own verified task):

- Split `src/content/app.ts` (~3.4k lines, ~7 subsystems, ~29 module-level
  mutable globals). Why: the hidden coupling through shared globals already
  produced two real bugs fixed in the review (confirmation dialogs killed by
  background re-renders, stale-run writes to `latestSettings`), and the pickup
  name matching/scoring logic (~300 lines of pure string code) is untestable
  while it lives next to DOM code. Extract incrementally, in value order:
  pickup-matching (pure, testable) → delivery-menu assist (~900 self-contained
  lines) → sweep state machine (~350 self-contained lines). Run `npm run
  qa:ozon` plus a live check after each step.
- Reduce private-API request volume. Why: activation tries 12 session-mutating
  request variants with no early exit after confirmation, a failing mutating
  price fetch can issue ~50 sequential requests per point, and discovery fires
  15 requests per product page (5 modal paths x 3 endpoint styles). This is
  the most likely self-inflicted cause of `LIVE_OZON_BLOCKED` antibot blocks.
- Drop or guard the positional label-pairing fallback in
  `src/marketplaces/ozon/pickup-capture.ts` (`labels[i] -> entries[i]` when
  counts differ, score 85). Why: if Ozon renders selector rows in a different
  order than the captured JSON array, pickup name A is saved against pickup id
  B and the user reads a price under the wrong point's name.
- Stop emitting pickup candidates whose `externalLocationId` is a weak
  city/region id (`cityId`, `geoId`, `regionId`). Why: a saved geoId point is
  "confirmed" by nearly every response for that city, so its price rows verify
  against a non-pickup location.
- Make `upsertPickupPoint` / `upsertManualQuote` return a discriminated result
  instead of silently returning unchanged settings on limit/unknown-id drops.
  Why: background replies `{ok: true}` either way, so the UI can report
  "saved" for a write that never happened.
- Replace whole-object `SAVE_SETTINGS` from the options page with per-field
  operations. Why: the `storage.onChanged` refresh added in the review shrinks
  the clobber window but cannot close it; a content-script write landing
  between an options click and its save is still lost.

## Ozon PVZ Names

- Investigate a safe first-load address resolution path for saved Ozon pickup
  points that currently appear as `Ozon pickup <uuid>`. The current cause is
  that Ozon often exposes the pickup id before exposing a nearby trusted
  title/subtitle/address for the same id. Do not solve this by borrowing the
  page-level current delivery text; that can assign one visible address to
  unrelated saved UUIDs.
