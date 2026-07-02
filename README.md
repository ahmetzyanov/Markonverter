# Markonverter

Chrome/Chromium Manifest V3 extension for comparing an Ozon product price across saved pickup points.

## What it does

- Injects a compact comparison panel on Ozon product pages.
- Opens the product-page panel automatically and remembers whether it is expanded or collapsed.
- Shows captured prices for configured Ozon pickup points when a product page opens.
- Saves the currently selected Ozon delivery point from the product page panel.
- Lets you choose and delete saved pickup points directly in the product-page panel.
- Shows pickup points detected from Ozon page/network data when Ozon loads them.
- Adds Markonverter save controls near Ozon's delivery selection UI when it is visible.
- Uses product-specific captured prices for saved Ozon pickup points.
- Automatically captures the visible product price when the current Ozon delivery
  point or selected delivery row clearly matches a saved Markonverter point.
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
3. Press `Add` next to the exact pickup point in the Ozon selector, or use `Save` in Markonverter's detected pickup list.
4. Rows already stored in Markonverter show `Saved` instead of another add action.

When `Add current` appears in the Markonverter panel, it saves the detected current point and also captures the visible product price for that product and point. Saved rows do not switch Ozon to other pickup points. If a row still says `Unavailable`, select/open that point in Ozon, wait for the visible product price, and Markonverter will try to capture it for the matching saved point. Use `Capture current` on the row as the manual fallback. Captured prices are shown with a timestamp and are only reused for the same product and saved point.

The settings page still allows manual editing. Each pickup point stores:

- name
- marketplace
- country
- currency
- Ozon location id

The extension does not switch through saved Ozon delivery points while showing comparison rows. It only captures the visible product price for the currently selected/opened Ozon point when that point can be matched safely.
Current-point matching also watches Ozon's compact address bar, because live product pages may show the opened pickup point as only a short street/house label rather than a full delivery card.

Use the checkbox in each product-page row to choose which saved Markonverter points are compared. The same panel shows new detected pickup points when Ozon exposes them through the visible page or network responses. Those detected points can be saved into Markonverter from their own rows.

When Ozon's delivery selector is open, Markonverter shows selector-level status and adds `Add` / `Saved` controls next to visible pickup-point rows. Use row-level `Delete` buttons in Markonverter to remove stale or wrong pickup points without opening the settings page.

## Ozon API note

The extension records relevant Ozon same-origin JSON payloads from the trusted page session for debugging and replay fixtures. Product-page comparison does not use Ozon addressbook selection endpoints to activate saved points.

Current-price capture remains strict: request echoes, URLs, and tracking/debug fields are not enough to match a point. If Markonverter cannot match the visible Ozon point to a saved point, it leaves the row `Unavailable` instead of reusing the current address price for another row. Use `Capture current` when automatic current-point capture cannot be verified, and `Copy details` when debugging a failed point.

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
pickup saving, visible current-point auto-capture, manual capture fallback,
diagnostic copy status, manual two-point comparison, inline selection, and row
deletion. Live Ozon reachability should be reported separately when checked.

## Live Ozon smoke probe

Use a separate live probe when an agent needs to prove that a real Ozon product
page loads and the unpacked extension injects its panel:

```bash
OZON_QA_URL="https://www.ozon.kz/product/..." npm run qa:ozon:live
```

Fresh automated profiles can still get Ozon's 403/no-connection page. To reuse
a trusted browser session deliberately, export Ozon cookies or Playwright
storage state and pass it to the probe:

```bash
OZON_QA_URL="https://www.ozon.kz/product/..." \
OZON_QA_COOKIES="/path/to/ozon-cookies.json" \
npm run qa:ozon:live
```

`OZON_QA_COOKIES` accepts Cookie-Editor JSON, Playwright `storageState` JSON,
Netscape `cookies.txt`, or a plain `Cookie:` header file. Use
`OZON_QA_STORAGE_STATE` for a Playwright storage state file when localStorage
should be imported too. The command reports `LIVE_OZON_OK`,
`LIVE_OZON_BLOCKED`, or `LIVE_OZON_PANEL_MISSING` and keeps that status separate
from fake-harness regression results.

To verify the real current-PVZ capture path, enable the capture check:

```bash
OZON_QA_CAPTURE_CHECK=1 npm run qa:ozon:live
```

That live check uses the test browser profile to save the current detected PVZ,
clear only the captured quote, reload the product page, and assert that the
opened PVZ price is captured again automatically.

## Recording real Ozon fixtures

For real replay data, load the current `dist/` extension in the trusted browser
profile where Ozon works, open an Ozon product page, and use Ozon normally:
open delivery selection, choose or view pickup points, and wait for prices. The
Markonverter panel records relevant Ozon `composer-api`, `entrypoint-api`,
delivery, address, pickup, and geo responses locally. Use `Copy` in the panel's
`Ozon fixtures` row to copy the bounded fixture JSON, or `Clear` to remove the
local capture buffer.
