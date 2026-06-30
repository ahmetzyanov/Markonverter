# Markonverter

Chrome/Chromium Manifest V3 extension for comparing an Ozon product price across saved pickup points.

## What it does

- Injects a compact comparison panel on Ozon product pages.
- Opens the product-page panel automatically and remembers whether it is expanded or collapsed.
- Compares configured Ozon pickup points automatically when a product page opens.
- Saves the currently selected Ozon delivery point from the product page panel.
- Lets you choose and delete saved pickup points directly in the product-page panel.
- Shows pickup points detected from Ozon page/network data when Ozon loads them.
- Adds Markonverter save controls near Ozon's delivery selection UI when it is visible.
- Falls back to product-specific captured prices when Ozon refuses to verify a saved point through its private product API.
- Copies per-point diagnostics for failed Ozon API attempts.
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
3. Press `Save point` in the Markonverter panel header.
4. Repeat for each RU/KZ point you want to compare.

When the selected point is saved from the product page, Markonverter also captures the visible product price for that product and point. If a saved row still says `Unavailable`, select that point in Ozon and use `Capture current` on the row. Captured prices are shown with a timestamp and are only reused for the same product and saved point.

The settings page still allows manual editing. Each pickup point stores:

- name
- marketplace
- country
- currency
- Ozon location id

The extension does not change the selected delivery point automatically. It captures the currently selected Ozon point from page state/network data after you choose it.

Use `Points` in the product-page panel to choose which saved Markonverter points are compared. The same panel shows `Detected on Ozon` when Ozon exposes pickup points through the visible page or network responses. Those detected points can be saved into Markonverter from the panel.

When Ozon's delivery selector is open, Markonverter also tries to inject `Save to Markonverter` and `Show detected PVZ` buttons near that selector. Use row-level `Delete` buttons to remove stale or wrong pickup points without opening the settings page.

## Ozon API note

The extension calls Ozon same-origin JSON endpoints from the extension content script and passes the configured pickup location id. It only accepts a price when the response also confirms the requested location id. Ozon private API payloads are not stable public contracts, so a failed endpoint, missing location confirmation, or ambiguous price appears as a per-pickup-point error in the page panel instead of changing the user's visible delivery point.

Some Ozon address-book ids are only confirmed by Ozon after the user selects that point in the page session. Markonverter keeps the strict confirmation check to avoid showing the current address price under the wrong saved point. Use `Capture current` as the safe fallback for those rows, and `Copy details` when debugging a failed point.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
