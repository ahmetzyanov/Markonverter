<div align="center">

<img src="../src/assets/icon-128.png" alt="Markonverter logo" width="112" height="112" />

# Markonverter

**Compare an Ozon product's price across all your saved pickup points — right on the product page.**

[![License: MIT](https://img.shields.io/badge/License-MIT-005BFF.svg?style=flat-square)](../LICENSE.md)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-F1117E.svg?style=flat-square)](../src/entrypoints/)
[![Platform](https://img.shields.io/badge/Chrome%20%7C%20Chromium-005BFF.svg?style=flat-square&logo=googlechrome&logoColor=white)](#load-in-chrome)
[![TypeScript](https://img.shields.io/badge/TypeScript-005BFF.svg?style=flat-square&logo=typescript&logoColor=white)](../tsconfig.json)

[What it does](#what-it-does) · [Build](#build) · [Load in Chrome](#load-in-chrome) · [Pickup point setup](#pickup-point-setup)

Русская версия: [README.md](../README.md)

</div>

---

Markonverter is not affiliated with, endorsed by, or sponsored by Ozon. It uses
Ozon product pages from the user's own browser session and may make automated
pickup-point price requests to Ozon's undocumented internal APIs. Those requests
can hit Ozon anti-bot checks or rate limits on the user's own account; that is a
Terms of Use risk of this approach, not an extension malfunction.

## What it does

- Injects a compact comparison panel on Ozon product pages.
- Opens the product-page panel automatically and remembers whether it is expanded or collapsed.
- Captures verified product prices for configured Ozon pickup points when a product page opens.
- Saves the currently selected Ozon delivery point from the product page panel.
- Lets you choose and delete saved pickup points directly in the product-page panel.
- Shows pickup points detected from Ozon page/network data when Ozon loads them.
- Adds Markonverter save controls near Ozon's delivery selection UI when it is visible.
- Uses product-specific captured prices for saved Ozon pickup points.
- Automatically captures the visible product price when the current Ozon delivery
  point or selected delivery row clearly matches a saved Markonverter point.
- Tries read-only Ozon price requests first, then falls back to guarded
  sequential pickup activation and restores the originally selected point.
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
4. Select the generated `dist/` directory.
5. Open an Ozon product page and add pickup points from Ozon's delivery selector or the Markonverter panel.

## Pickup point setup

Recommended flow:

1. Open an Ozon product page.
2. Open Ozon's delivery selector so Ozon loads pickup-point rows.
3. Press `Add` next to the exact pickup point in the Ozon selector, or use `Save` in Markonverter's detected pickup list.
4. Rows already stored in Markonverter show `Saved` instead of another add action.

Markonverter keeps up to 4 saved Ozon pickup points. When a product page opens,
each selected saved row first tries a verified Ozon price request that does not
change the current delivery point. If Ozon only prices the active delivery
point, Markonverter checks saved points sequentially through Ozon's address
activation flow, saves product-specific captured quotes, and then asks Ozon to
restore the point that was selected when the page opened. If Ozon does not
confirm a requested point, the row stays `Unavailable` instead of reusing another
point's price.
If Ozon confirms the pickup point but says the product is not delivered to that
region, Markonverter shows an orange warning on that pickup-point row and keeps
the page on a pickup point where the product is available when one was found.

Each pickup point stores:

- name
- marketplace
- country
- currency
- Ozon location id

Current-point matching also watches Ozon's compact address bar, because live
product pages may show the opened pickup point as only a short street/house
label rather than a full delivery card. Use `Capture current` on a row as the
manual fallback when automatic capture cannot be verified.

Use the checkbox in each product-page row to choose which saved Markonverter points are compared. The same panel shows new detected pickup points when Ozon exposes them through the visible page or network responses. Those detected points can be saved into Markonverter from their own rows.

When Ozon's delivery selector is open, Markonverter shows selector-level status and adds `Add` / `Saved` controls next to visible pickup-point rows. Use row-level `Delete` buttons in Markonverter to remove stale or wrong pickup points without opening the settings page.

## Ozon API note

The extension records relevant Ozon same-origin JSON payloads from the trusted
page session for debugging and replay fixtures. Product-page comparison tries
non-mutating price requests first. Addressbook selection endpoints are used only
as a guarded fallback for saved rows, and the original selected point is restored
after the sequence when Markonverter can identify it.

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
diagnostic copy status, automatic two-point capture with restoration, manual
two-point comparison, saved-point limit handling, inline selection, and row
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
