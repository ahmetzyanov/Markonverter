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
- Uses product-specific captured prices for saved Ozon pickup points.
- Automatically captures the visible product price when the current Ozon delivery
  point clearly matches a saved Markonverter point.
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

## Project structure

- `src/entrypoints/`: Manifest-loaded extension scripts and `options.html`.
- `src/content/`: Ozon product-page controller, panel styling, and page parsing helpers.
- `src/marketplaces/`: Marketplace adapter registry plus per-marketplace implementation folders.
- `src/shared/`: Cross-entrypoint types, validation, settings, currency, and comparison helpers.
- `tests/`: Vitest coverage mirrored by shared and marketplace areas.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `/Users/gogla/PycharmProjects/markonverter/dist`.
5. Open an Ozon product page and add pickup points from Ozon's delivery selector or the Markonverter panel.

## Pickup point setup

Recommended flow:

1. Open an Ozon product page.
2. Open Ozon's delivery selector so Ozon loads pickup-point rows.
3. Press `Add` next to the exact pickup point in the Ozon selector, or use `Detected on Ozon` in the Markonverter `Points` panel.
4. Rows already stored in Markonverter show `Saved` instead of another add action.

When `Add current` appears in the Markonverter panel, it saves the detected current point and also captures the visible product price for that product and point. If a saved row still says `Unavailable`, select that point in Ozon and wait for the product page price; Markonverter will capture it automatically when the visible delivery block clearly matches the saved point. Use `Capture current` on the row as the manual fallback. Captured prices are shown with a timestamp and are only reused for the same product and saved point.

The settings page still allows manual editing. Each pickup point stores:

- name
- marketplace
- country
- currency
- Ozon location id

The extension does not change the selected Ozon delivery point while comparing rows. Automatic selection through Ozon's addressbook endpoints was disabled because it can change the real selected PVZ in the browser session and reload the product page.

Use `Points` in the product-page panel to choose which saved Markonverter points are compared. The same panel shows `Detected on Ozon` when Ozon exposes pickup points through the visible page or network responses. Those detected points can be saved into Markonverter from their own rows.

When Ozon's delivery selector is open, Markonverter shows selector-level status and adds `Add` / `Saved` controls next to visible pickup-point rows. Use row-level `Delete` buttons in Markonverter to remove stale or wrong pickup points without opening the settings page.

## Ozon API note

The extension records relevant Ozon same-origin JSON payloads from the trusted page session for debugging and replay fixtures, but the product-page UI no longer uses Ozon addressbook selection endpoints for automatic price lookup.

Automatic selection was unreliable and could change the user's current Ozon pickup point. Markonverter keeps visible-page capture as the safe path: select the point in Ozon, wait for the visible product price, then let Markonverter auto-capture that price for the matching saved point. Use `Capture current` if the point cannot be matched automatically, and `Copy details` when debugging a failed point.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Browser QA without live Ozon

Ozon can return 403 or an antibot/no-connection page to automated browser
sessions. Do not treat that as an extension regression and do not weaken pickup
point confirmation to make live automation pass.

Use the fake-Ozon browser harness for agent-run regression checks:

```bash
npm run qa:ozon
```

The harness loads `dist/` as an unpacked MV3 extension in Chromium, serves a
fake `https://www.ozon.kz/product/fake-product-2229282395/` page, and intercepts
`https://*.ozon.kz/api/**` before the network. It verifies the panel, detected
pickup saving, disabled automatic lookup guidance, visible current-point
auto-capture, manual capture fallback, diagnostic copy status, manual two-point comparison, inline selection, and
row deletion. Live Ozon reachability should be reported separately when checked.

## Recording real Ozon fixtures

For real replay data, load the current `dist/` extension in the trusted browser
profile where Ozon works, open an Ozon product page, and use Ozon normally:
open delivery selection, choose or view pickup points, and wait for prices. The
Markonverter panel records relevant Ozon `composer-api`, `entrypoint-api`,
delivery, address, pickup, and geo responses locally. Use `Copy` in the panel's
`Ozon fixtures` row to copy the bounded fixture JSON, or `Clear` to remove the
local capture buffer.
