---
name: markonverter-ozon-extension-qa
description: Load and verify the Markonverter Chrome MV3 extension end to end in Chromium. Use when changing Ozon content scripts, pickup-point capture, private API calls, currency comparison, extension storage, options UI, or when live Ozon behavior must be checked and automation may hit Ozon antibot.
---

# Markonverter Ozon Extension QA

## Workflow

1. Run the local checks first:

```bash
npm run typecheck
npm test
npm run build
```

2. Launch a persistent Chromium context with `dist/` as an unpacked extension. Use Playwright through `node_repl` when available. If the bundled Playwright browser is missing, run `npx playwright install chromium`; if the Playwright package revision and downloaded browser revision differ, pass the downloaded Chromium executable through `executablePath`.

Use these launch arguments:

```js
[
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
  "--no-first-run",
  "--no-default-browser-check"
]
```

3. Wait for the extension service worker before seeding storage:

```js
const sw = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
```

Then write `chrome.storage.local["markonverter.settings"]`. Do this after the service worker has initialized; the `onInstalled` handler can otherwise race and restore empty default settings.

4. Try the real Ozon product URL first. If Ozon shows its antibot or "no connection" page, record that live Ozon was blocked and continue with the fake-Ozon regression harness below. Do not claim real Ozon API success from the fake harness.

## Fake-Ozon Regression Harness

Intercept an `https://ozon.kz/product/fake-product-2229282395/` route and return simple product HTML with `h1` and `[data-widget="webPrice"]`. Intercept `https://ozon.kz/api/**` and return JSON shaped like Ozon composer responses.

Always cover these browser-visible states:

- No pickup points: panel says no Ozon pickup points are configured and shows `Save point`.
- Current-address reuse: two saved points exist, but API responses confirm only `kz-456`; the RU row must be `Unavailable`, not a duplicated KZ price.
- Confirmed two-point success: API response confirms the requested id for each point; the panel shows different converted prices, delta from cheapest, and delivery text if present.
- Non-Ozon page: no Markonverter panel is injected.

For the reuse regression, seed:

```js
{
  defaultCurrency: "RUB",
  ratesToRub: { RUB: 1, KZT: 0.17 },
  pickupPoints: [
    { id: "ru", name: "Moscow pickup", marketplace: "ozon", country: "RU", currency: "RUB", externalLocationId: "ru-123" },
    { id: "kz", name: "Astana pickup", marketplace: "ozon", country: "KZ", currency: "KZT", externalLocationId: "kz-456" }
  ]
}
```

The reused-location API response should echo the requested id under a request-like field but confirm only the current KZ delivery address:

```js
{
  requestEcho: { deliveryAddressOid: requested, url: req.url() },
  delivery: { selectedAddressOid: "kz-456", deliveryTime: "Tomorrow, 10:00-18:00" },
  widgetStates: { webPrice: JSON.stringify({ price: "100 000 KZT" }) }
}
```

Expected visible result: Moscow is unavailable with a concise warning that Ozon did not confirm the pickup point; Astana shows `17 000,00 RUB`, original `100 000 KZT`, and delivery time.

## Signoff

Before saying the extension works, verify:

- `npm run typecheck`, `npm test`, and `npm run build` pass.
- The extension service worker is present.
- Screenshots or visible text confirm the reuse regression and the two-point success scenario.
- Live Ozon status is stated separately: verified if the real page loaded, blocked if Ozon returned antibot/403.
- The browser context is closed unless the user asked to keep it open.
