# TODO

## Ozon PVZ Names

- Investigate a safe first-load address resolution path for saved Ozon pickup
  points that currently appear as `Ozon pickup <uuid>`. The current cause is
  that Ozon often exposes the pickup id before exposing a nearby trusted
  title/subtitle/address for the same id. Do not solve this by borrowing the
  page-level current delivery text; that can assign one visible address to
  unrelated saved UUIDs.
