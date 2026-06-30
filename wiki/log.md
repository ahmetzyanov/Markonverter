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
