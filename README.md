# Markonverter

Chrome/Chromium Manifest V3 extension for comparing an Ozon product price across manually configured pickup points.

## What it does

- Injects a compact comparison panel on Ozon product pages.
- Compares configured Ozon pickup points automatically when a product page opens.
- Converts prices between RUB and KZT.
- Uses RUB as the default comparison currency.
- Keeps marketplace support behind adapters so Wildberries can be added later.

## Build

```bash
npm install
npm run build
```

The loadable extension is written to `dist/`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `/Users/gogla/PycharmProjects/markonverter/dist`.
5. Open the extension settings and add Ozon pickup points.

## Pickup point setup

Each pickup point needs:

- name
- marketplace
- country
- currency
- Ozon location id

The first version does not discover Ozon pickup points automatically. The `Ozon location id` must be supplied manually.

## Ozon API note

The extension calls Ozon same-origin JSON endpoints from the extension content script and passes the configured pickup location id. It only accepts a price when the response also confirms the requested location id. Ozon private API payloads are not stable public contracts, so a failed endpoint, missing location confirmation, or ambiguous price appears as a per-pickup-point error in the page panel instead of changing the user's visible delivery point.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
