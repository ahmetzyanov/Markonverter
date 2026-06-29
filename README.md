# Markonverter

Chrome/Chromium Manifest V3 extension for comparing an Ozon product price across saved pickup points.

## What it does

- Injects a compact comparison panel on Ozon product pages.
- Compares configured Ozon pickup points automatically when a product page opens.
- Saves the currently selected Ozon delivery point from the product page panel.
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
5. Open an Ozon product page and save pickup points from the injected Markonverter panel.

## Pickup point setup

Recommended flow:

1. Open an Ozon product page.
2. Select the delivery point in Ozon itself.
3. Press `Save point` in the Markonverter panel header, or click the Markonverter toolbar icon.
4. Repeat for each RU/KZ point you want to compare.

The settings page still allows manual editing. Each pickup point stores:

- name
- marketplace
- country
- currency
- Ozon location id

The extension does not change the selected delivery point automatically. It captures the currently selected Ozon point from page state/network data after you choose it.

## Ozon API note

The extension calls Ozon same-origin JSON endpoints from the extension content script and passes the configured pickup location id. It only accepts a price when the response also confirms the requested location id. Ozon private API payloads are not stable public contracts, so a failed endpoint, missing location confirmation, or ambiguous price appears as a per-pickup-point error in the page panel instead of changing the user's visible delivery point.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
