# TODO

## Deferred from the 2026-07-05 review

Found during the full-project review but deliberately not done in that pass
(each is a behavior-sensitive change that deserves its own verified task):

- Split `src/content/app.ts` (~3.3k lines left, ~29 module-level mutable
  globals). Why: the hidden coupling through shared globals already produced
  two real bugs fixed in the review (confirmation dialogs killed by background
  re-renders, stale-run writes to `latestSettings`). Extract incrementally,
  in value order; run `npm run qa:ozon` plus a live check after each step.
  - DONE 2026-07-06: pickup-matching extracted to
    `src/marketplaces/ozon/pickup-matching.ts` (~19 pure string functions:
    visible-delivery matching/scoring, row-to-candidate matching, label
    extraction, display names). The `latestPickupCandidates` global became a
    parameter; covered by `tests/marketplaces/ozon/pickup-matching.test.ts`.
  - NEXT: delivery-menu assist (~900 self-contained lines) → sweep state
    machine (~350 self-contained lines, `OZON_SWEEP_*` block).
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

## Lint Gate: File/Function Size

No eslint config exists in this repo today, so nothing currently enforces file
or function size. `src/content/app.ts` (~3.3k lines) is the live proof this is
missing.

- Parameters: file soft limit 300 lines / hard fail 500 (blank lines and
  comments excluded); function limit 50 lines; cyclomatic complexity <= 10;
  max 4 params per function. These are the standard `max-lines` /
  `max-lines-per-function` / `complexity` / `max-params` defaults, not a
  project-specific invention.
- Ratchet, not big-bang: files already over 500 lines today
  (`src/content/app.ts` 3294, `src/marketplaces/ozon/pickup-capture.ts` 896,
  `src/marketplaces/ozon/private-api.ts` 796, `src/content/panel/styles.ts`
  600) need an explicit allowlist/exception so the gate doesn't fail on day
  one. Shrink the allowlist as the `app.ts` split (tracked above) lands.
- Implementation: a standalone `scripts/check-file-size.mjs` (line-count only,
  zero deps) wired into `npm test`/CI is enough for this rule alone. Only add
  a full eslint config if other lint rules are wanted too — don't add the
  dependency just for line counts.

## No-Reload PVZ Price Compare (option 3)

- Researched and DONE 2026-07-06 (see wiki/log.md): Ozon has **no read-only
  per-point pricing path** — `deliveryAddressOid` as composer/entrypoint GET
  param is ignored, as POST body returns 404 — so the silent sweep
  (`runOzonSilentPriceSweep` in `src/content/app.ts`) activates each pending
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
