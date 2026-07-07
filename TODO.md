# TODO

## Deferred from the 2026-07-05 review

Found during the full-project review but deliberately not done in that pass
(each is a behavior-sensitive change that deserves its own verified task):

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
- Replace whole-object `SAVE_SETTINGS` from the options page with per-field
  operations. Why: the `storage.onChanged` refresh added in the review shrinks
  the clobber window but cannot close it; a content-script write landing
  between an options click and its save is still lost.

## No-Reload PVZ Price Compare (option 3)

- Researched and DONE 2026-07-06 (see wiki/log.md): Ozon has **no read-only
  per-point pricing path** — `deliveryAddressOid` as composer/entrypoint GET
  param is ignored, as POST body returns 404 — so the silent sweep
  (`runOzonSilentPriceSweep` in `src/content/ozon-sweep.ts`) activates each pending
  point, takes the confirmed price read, and restores the original point; the
  visible reload sweep remains the fallback for anything left unpriced.
- Remaining follow-up: the antibot request volume of activation-based pricing
  is now on the primary path — the "Reduce private-API request volume" item
  above got more urgent, not less.

## Ozon PVZ Names

- Investigate a safe first-load address resolution path for saved Ozon pickup
  points that currently appear as `Ozon pickup <uuid>`. The current cause is
  that Ozon often exposes the pickup id before exposing a nearby trusted
  title/subtitle/address for the same id. Do not solve this by borrowing the
  page-level current delivery text; that can assign one visible address to
  unrelated saved UUIDs.
