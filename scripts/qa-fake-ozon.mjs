#!/usr/bin/env node

import { chromium } from "playwright";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const extensionPath = path.join(repoRoot, "dist");
const fakeOzonOrigin = "https://www.ozon.kz";
const productUrl = `${fakeOzonOrigin}/product/fake-product-2229282395/`;
const settingsKey = "markonverter.settings";
const panelStateKey = "markonverter.panelState";
const timeoutMs = 12_000;

const fakePoints = {
  ru: {
    id: "ru",
    externalLocationId: "ru-123",
    name: "Moscow pickup",
    country: "RU",
    currency: "RUB",
    priceText: "9 000 ₽",
    deliveryText: "Today, 18:00-20:00"
  },
  kz: {
    id: "kz",
    externalLocationId: "kz-456",
    name: "Astana pickup",
    country: "KZ",
    currency: "KZT",
    priceText: "100 000 ₸",
    deliveryText: "Tomorrow, 10:00-18:00"
  }
};

const routeState = {
  scenario: "empty"
};
const routeStats = {
  apiHits: 0,
  productHits: 0,
  locationSelectionRequests: 0,
  lastApiUrls: [],
  lastLocationSelectionUrls: [],
  lastGoto: null
};

if (!existsSync(path.join(extensionPath, "manifest.json"))) {
  throw new Error("dist/manifest.json is missing. Run npm run build before fake Ozon QA.");
}

const userDataDir = mkdtempSync(path.join(tmpdir(), "markonverter-fake-ozon-"));
let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1365, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });
  context.setDefaultTimeout(timeoutMs);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: fakeOzonOrigin });
  await installFakeOzonRoutes(context);

  const worker = await waitForExtensionWorker(context);
  const extensionId = new URL(worker.url()).host;
  console.log(`Loaded Markonverter extension ${extensionId}`);

  const page = context.pages()[0] || (await context.newPage());
  await installFakeOzonRoutes(page);
  await page.goto("data:text/html,<h1>Non-Ozon QA page</h1>");
  await assertNoPanel(page, "non-Ozon page");

  await verifyDetectedPickupSave(page, worker);
  await verifyCurrentAddressReuseRegression(page, worker);
  await verifyCorruptedEditNameRecovery(page, worker);
  await verifyStreetOnlyCurrentSummaryCapture(page, worker);
  await verifySelectorIdsOnlyNameResolution(page, worker);
  await verifyGenericUuidNameResolution(page, worker);
  await verifyManualTwoPointSuccess(page, worker);

  console.log("BROWSER_QA_OK fake Ozon regression harness passed");
} finally {
  await context?.close().catch(() => undefined);
  rmSync(userDataDir, { recursive: true, force: true });
}

async function installFakeOzonRoutes(browserContext) {
  await browserContext.route(/^https:\/\/(?:www\.)?ozon\.kz\/api\//, async (route) => {
    routeStats.apiHits += 1;
    routeStats.lastApiUrls.push(route.request().url());
    routeStats.lastApiUrls = routeStats.lastApiUrls.slice(-5);
    if (requestedLocationFromRequest(route.request())) {
      routeStats.locationSelectionRequests += 1;
      routeStats.lastLocationSelectionUrls.push(route.request().url());
      routeStats.lastLocationSelectionUrls = routeStats.lastLocationSelectionUrls.slice(-5);
    }
    const response = fakeOzonApiResponse(route.request());
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(response)
    });
  });

  await browserContext.route(/^https:\/\/(?:www\.)?ozon\.kz\/product\//, async (route) => {
    routeStats.productHits += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: fakeProductHtml()
    });
  });

  await browserContext.route(/^https:\/\/(?:www\.)?ozon\.kz\/(?!api\/|product\/)/, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "text/plain; charset=utf-8",
      body: "fake Ozon route not implemented"
    });
  });
}

async function waitForExtensionWorker(browserContext) {
  const existing = browserContext.serviceWorkers().find((worker) => worker.url().endsWith("/background.js"));
  if (existing) {
    return existing;
  }
  const worker = await browserContext.waitForEvent("serviceworker", { timeout: timeoutMs });
  if (!worker.url().endsWith("/background.js")) {
    throw new Error(`Unexpected extension service worker: ${worker.url()}`);
  }
  return worker;
}

async function verifyDetectedPickupSave(page, worker) {
  routeState.scenario = "empty";
  await seedStorage(worker, settingsWithPickupPoints([]));
  await openFakeProduct(page, "empty");

  await waitForPanelText(page, /No Ozon pickup points configured\./, "empty settings state");
  await waitForPanelText(page, /Астана|Astana pickup/, "detected fake Ozon pickup point");
  await waitForPageText(page, /PVZ visible/, "delivery selector helper");

  await clickPanelButton(page, "Save");
  await waitForPanelText(page, /Saved: |Saved and captured current price|Checking 1 pickup points|Auto captured current price/, "detected pickup save status");
  await page.locator('[data-markonverter-pvz-action].is-saved').waitFor({ timeout: timeoutMs });

  const settings = await readSettings(worker);
  assert(settings.pickupPoints.some((point) => point.externalLocationId === fakePoints.kz.externalLocationId), "detected pickup was saved");
}

async function verifyCurrentAddressReuseRegression(page, worker) {
  routeState.scenario = "reuse";
  await seedStorage(worker, settingsWithPickupPoints([fakePoints.ru, fakePoints.kz]));
  const locationSelectionRequestsBefore = routeStats.locationSelectionRequests;
  await openFakeProduct(page, "reuse");

  await waitForPanelText(page, /Moscow pickup/, "Moscow row");
  await waitForPanelText(page, /Astana pickup/, "Astana row");
  await waitForPanelText(page, /17[\s\u00a0]*000,00[\s\u00a0]*₽/, "current KZ point auto-captured from visible page");
  await waitForPanelText(page, /Auto captured current price|Captured /, "auto capture status");
  await waitForPanelText(page, /Unavailable/, "unavailable row before manual capture");
  await waitForPanelText(page, /Open or select this pickup point in Ozon.*Capture current/i, "current PVZ capture guidance");
  assert(
    routeStats.locationSelectionRequests === locationSelectionRequestsBefore,
    `saved-row comparison sent Ozon location-selection requests: ${JSON.stringify(routeStats.lastLocationSelectionUrls)}`
  );

  let settings = await readSettings(worker);
  assert(settings.manualQuotes["2229282395:kz"], "current KZ point was auto-captured without pressing Capture current");

  await clickPanelButton(page, "Copy details");
  await waitForPanelText(page, /Copied pickup-point diagnostics|Could not copy diagnostics/, "diagnostics copy status");

  await clickPanelButton(page, "Capture current");
  await waitForPanelText(page, /Capture visible price\?/, "inline capture confirmation");
  await clickPanelButton(page, "Capture price");
  await waitForPanelText(page, /Captured current page price for Moscow pickup|Captured /, "manual capture status");

  settings = await readSettings(worker);
  assert(settings.manualQuotes["2229282395:ru"], "manual quote was stored for the unavailable Moscow row");
}

async function verifyCorruptedEditNameRecovery(page, worker) {
  routeState.scenario = "reuse";
  await seedStorage(
    worker,
    settingsWithPickupPoints([
      { ...fakePoints.ru, name: "Редактировать" },
      { ...fakePoints.kz, name: "Редактировать" }
    ])
  );
  await openFakeProduct(page, "edit-name-recovery");

  await waitForPanelText(page, /17[\s\u00a0]*000,00[\s\u00a0]*₽/, "auto capture after edit-name repair");
  const text = await panelText(page);
  assert(!text.includes("Редактировать"), `Ozon edit button text leaked into pickup-point names. Current panel text:\n${text}`);

  const settings = await readSettings(worker);
  assert(settings.pickupPoints.every((point) => point.name !== "Редактировать"), "corrupted saved pickup names were not repaired");
  assert(settings.manualQuotes["2229282395:kz"], "current KZ point was auto-captured after edit-name repair");
}

async function verifyStreetOnlyCurrentSummaryCapture(page, worker) {
  routeState.scenario = "street-only-current-summary";
  await seedStorage(worker, settingsWithPickupPoints([{ ...fakePoints.kz, name: "Буинск, ул. Вахитова, 174Б" }]));
  await openFakeProduct(page, "street-only-current-summary");

  await waitForPanelText(page, /17[\s\u00a0]*000,00[\s\u00a0]*₽/, "street-only current summary auto-capture");

  const settings = await readSettings(worker);
  assert(
    settings.manualQuotes["2229282395:kz"],
    "street-only current delivery summary did not auto-capture the saved current pickup point"
  );
}

async function verifySelectorIdsOnlyNameResolution(page, worker) {
  routeState.scenario = "selector-ids-only";
  await seedStorage(
    worker,
    settingsWithPickupPoints([
      { ...fakePoints.ru, name: `Ozon pickup ${fakePoints.ru.externalLocationId}` },
      { ...fakePoints.kz, name: `Ozon pickup ${fakePoints.kz.externalLocationId}` }
    ])
  );
  await openFakeProduct(page, "selector-ids-only");

  await waitForPanelText(page, /Буинск, ул\. Вахитова, 174Б/, "RU selector id auto-resolved from common addressbook row");
  await waitForPanelText(page, /Астана, пр-кт Улы Дала, 31/, "KZ selector id auto-resolved from common addressbook row");

  const settings = await readSettings(worker);
  assert(
    settings.pickupPoints.some(
      (point) => point.externalLocationId === fakePoints.ru.externalLocationId && /Буинск/.test(point.name)
    ),
    "RU generic saved pickup name was not repaired from selector refresh"
  );
  assert(
    settings.pickupPoints.some(
      (point) => point.externalLocationId === fakePoints.kz.externalLocationId && /Астана/.test(point.name)
    ),
    "KZ generic saved pickup name was not repaired from selector refresh"
  );
  assert(
    settings.pickupPoints
      .filter((point) => [fakePoints.ru.externalLocationId, fakePoints.kz.externalLocationId].includes(point.externalLocationId))
      .every((point) => !/Срок хранения заказа/i.test(point.name)),
    "selector refresh leaked Ozon storage-period text into saved pickup names"
  );
}

async function verifyGenericUuidNameResolution(page, worker) {
  routeState.scenario = "reuse";
  await seedStorage(
    worker,
    settingsWithPickupPoints([
      { ...fakePoints.kz, name: `Ozon pickup ${fakePoints.kz.externalLocationId}` }
    ])
  );
  await openFakeProduct(page, "generic-name-resolution");

  await waitForPanelText(page, /Астана|Astana pickup/, "generic UUID pickup name resolved to an address label");
  const settings = await waitForSettingsCondition(
    worker,
    (current) =>
      current.pickupPoints.some(
        (point) => point.externalLocationId === fakePoints.kz.externalLocationId && !point.name.startsWith("Ozon pickup ")
      ),
    "generic saved pickup name repaired"
  );
  assert(
    settings.pickupPoints.some((point) => point.externalLocationId === fakePoints.kz.externalLocationId && !point.name.startsWith("Ozon pickup ")),
    "generic saved pickup name was not repaired"
  );
}

async function verifyManualTwoPointSuccess(page, worker) {
  routeState.scenario = "success";
  await seedStorage(worker, settingsWithPickupPoints([fakePoints.ru, fakePoints.kz], manualQuotesForFakePoints()));
  await openFakeProduct(page, "success");

  await waitForPanelText(page, /Moscow pickup/, "Moscow manual row");
  await waitForPanelText(page, /Astana pickup/, "Astana manual row");
  await waitForPanelText(page, /9[\s\u00a0]*000,00[\s\u00a0]*₽/, "Moscow captured price");
  await waitForPanelText(page, /17[\s\u00a0]*000,00[\s\u00a0]*₽/, "Astana captured converted price");
  await waitForPanelText(page, /Captured /, "manual capture label");
  const text = await panelText(page);
  assert(!text.includes("Unavailable"), "manual quote scenario should not show unavailable rows");

  await toggleFirstPanelCheckbox(page);
  await waitForPanelText(page, /Not compared|Comparison points updated/, "inline comparison toggle");
  await waitForPanelText(page, /Delete/, "row delete action");

  await clickPanelButton(page, "Delete");
  await waitForPanelText(page, /Delete pickup point\?/, "inline delete confirmation");
  await clickPanelButton(page, "Delete point");
  await waitForPanelText(page, /Deleted: Moscow pickup|Deleted: Astana pickup/, "row delete status");

  const settings = await readSettings(worker);
  assert(settings.pickupPoints.length === 1, `expected one pickup point after delete, got ${settings.pickupPoints.length}`);
}

async function openFakeProduct(page, label) {
  const url = `${productUrl}?qa=${encodeURIComponent(label)}&t=${Date.now()}`;
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded"
  });
  routeStats.lastGoto = {
    target: url,
    pageUrl: page.url(),
    status: response?.status() ?? null
  };
  await page.locator("#markonverter-panel-root").waitFor({ state: "attached", timeout: timeoutMs });
  await assertPanelFitsPriceCard(page, label);
}

async function assertNoPanel(page, label) {
  const hasPanel = await page.locator("#markonverter-panel-root").count();
  assert(hasPanel === 0, `${label} unexpectedly has a Markonverter panel`);
}

async function waitForPanelText(page, matcher, label) {
  const deadline = Date.now() + timeoutMs;
  let current = "";
  while (Date.now() < deadline) {
    current = await panelText(page);
    if (matchesText(current, matcher)) {
      return current;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(
    `Timed out waiting for ${label}. Fake route stats: ${JSON.stringify(routeStats, null, 2)}. Current panel text:\n${current}`
  );
}

async function waitForSettingsCondition(worker, predicate, label) {
  const deadline = Date.now() + timeoutMs;
  let current = null;
  while (Date.now() < deadline) {
    current = await readSettings(worker);
    if (predicate(current)) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `Timed out waiting for ${label}. Fake route stats: ${JSON.stringify(routeStats, null, 2)}. Current settings:\n${JSON.stringify(
      current,
      null,
      2
    )}`
  );
}

async function waitForPageText(page, matcher, label) {
  const deadline = Date.now() + timeoutMs;
  let current = "";
  while (Date.now() < deadline) {
    current = await page.evaluate(() => document.body?.innerText || document.body?.textContent || "");
    if (matchesText(current, matcher)) {
      return current;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`Timed out waiting for ${label}. Current page text:\n${current}`);
}

async function panelText(page) {
  return page
    .locator("#markonverter-panel-root")
    .evaluate((host) => host.shadowRoot?.querySelector(".panel")?.textContent || "");
}

async function assertPanelFitsPriceCard(page, label) {
  const metrics = await page.locator("#markonverter-panel-root").evaluate((host) => {
    const panel = host.shadowRoot?.querySelector(".panel");
    const card = host.closest(".price-card");
    const hostRect = host.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const cardRect = card?.getBoundingClientRect();
    return {
      hasPanel: Boolean(panel),
      hasCard: Boolean(card),
      host: { left: hostRect.left, right: hostRect.right, width: hostRect.width },
      panel: panelRect ? { left: panelRect.left, right: panelRect.right, width: panelRect.width } : null,
      card: cardRect ? { left: cardRect.left, right: cardRect.right, width: cardRect.width } : null
    };
  });

  assert(metrics.hasPanel && metrics.panel, `${label} has no rendered Markonverter panel`);
  assert(metrics.hasCard && metrics.card, `${label} panel was not nested in the fake price card`);
  assert(metrics.host.width <= metrics.card.width + 0.5, `${label} panel host overflowed price card: ${JSON.stringify(metrics)}`);
  assert(
    metrics.panel.left >= metrics.card.left - 0.5 && metrics.panel.right <= metrics.card.right + 0.5,
    `${label} panel overflowed price card: ${JSON.stringify(metrics)}`
  );
}

async function clickPanelButton(page, label) {
  await page.locator("#markonverter-panel-root").evaluate((host, buttonLabel) => {
    const buttons = Array.from(host.shadowRoot?.querySelectorAll("button") || []);
    const button = buttons.find((item) => item.textContent?.trim() === buttonLabel);
    if (!button) {
      throw new Error(`Panel button not found: ${buttonLabel}`);
    }
    button.click();
  }, label);
}

async function clickPageButton(page, label) {
  await page.evaluate((buttonLabel) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const button = buttons.find((item) => item.textContent?.trim() === buttonLabel);
    if (!button) {
      throw new Error(`Page button not found: ${buttonLabel}`);
    }
    button.click();
  }, label);
}

async function toggleFirstPanelCheckbox(page) {
  await page.locator("#markonverter-panel-root").evaluate((host) => {
    const checkbox = host.shadowRoot?.querySelector("input.compareToggle");
    if (!checkbox) {
      throw new Error("Panel comparison checkbox not found");
    }
    checkbox.click();
  });
}

function matchesText(text, matcher) {
  return matcher instanceof RegExp ? matcher.test(text) : text.includes(matcher);
}

async function seedStorage(worker, settings) {
  await chromeStorageSet(worker, {
    [settingsKey]: settings,
    [panelStateKey]: { collapsed: false }
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await chromeStorageSet(worker, {
    [settingsKey]: settings,
    [panelStateKey]: { collapsed: false }
  });
}

async function readSettings(worker) {
  return chromeStorageGet(worker, settingsKey);
}

async function chromeStorageSet(worker, value) {
  await worker.evaluate((stored) => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(stored, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(undefined);
      });
    });
  }, value);
}

async function chromeStorageGet(worker, key) {
  return worker.evaluate((storageKey) => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(storageKey, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result[storageKey]);
      });
    });
  }, key);
}

function settingsWithPickupPoints(points, manualQuotes = {}) {
  return {
    defaultCurrency: "RUB",
    currencyRateProvider: "manual",
    ratesToRub: { RUB: 1, KZT: 0.17 },
    pickupPoints: points.map((point) => ({
      id: point.id,
      name: point.name,
      marketplace: "ozon",
      country: point.country,
      currency: point.currency,
      externalLocationId: point.externalLocationId,
      comment: "Seeded by fake Ozon QA"
    })),
    comparisonPickupPointIds: null,
    manualQuotes
  };
}

function manualQuotesForFakePoints() {
  const capturedAt = "2026-07-01T08:00:00.000Z";
  return {
    "2229282395:ru": {
      productId: "2229282395",
      productUrl,
      pickupPointId: "ru",
      quote: {
        amount: 9000,
        currency: "RUB",
        rawText: fakePoints.ru.priceText,
        source: "manual",
        capturedAt
      },
      capturedAt
    },
    "2229282395:kz": {
      productId: "2229282395",
      productUrl,
      pickupPointId: "kz",
      quote: {
        amount: 100000,
        currency: "KZT",
        rawText: fakePoints.kz.priceText,
        source: "manual",
        capturedAt
      },
      capturedAt
    }
  };
}

function fakeOzonApiResponse(request) {
  if (routeState.scenario === "street-only-current-summary") {
    return {
      widgetStates: {
        webPrice: JSON.stringify({ price: fakePoints.kz.priceText })
      }
    };
  }

  if (routeState.scenario === "selector-ids-only") {
    if (requestContainsAddressbookSetSm(request)) {
      return fakeAddressbookSetSmResponse();
    }
    return {
      delivery: {
        selectedAddressOid: fakePoints.kz.externalLocationId
      },
      items: [
        ...Object.values(fakePoints).map((item) => ({
          action: {
            url: `/modal/addressbook?select_address=${item.externalLocationId}`
          },
          layoutId: 39077,
          layoutVersion: 31,
          pageType: "modal"
        })),
        {
          action: {
            url: "/modal/addressbook?select_address=home-address-extra"
          },
          layoutId: 39077,
          layoutVersion: 31,
          pageType: "modal"
        }
      ]
    };
  }

  const requested = requestedLocationFromRequest(request);
  const selected = selectedLocationForRequest(requested);
  const point = pointByExternalLocationId(selected) || fakePoints.kz;

  return {
    requestEcho: {
      deliveryAddressOid: requested,
      url: request.url(),
      body: request.postData() || null
    },
    delivery: {
      selectedAddressOid: selected,
      deliveryAddressOid: selected,
      fullAddress: addressbookLabel(point),
      selectedAddress: {
        deliveryAddressOid: selected,
        fullAddress: addressbookLabel(point)
      },
      deliveryTime: point.deliveryText
    },
    selectedAddress: {
      deliveryAddressOid: selected,
      selectedAddressOid: selected,
      fullAddress: point.name,
      isSelected: true
    },
    addressBook: {
      items: Object.values(fakePoints).map((item) => ({
        deliveryAddressOid: item.externalLocationId,
        ...(item.externalLocationId === selected ? { selectedAddressOid: item.externalLocationId } : {}),
        title: item.name,
        fullAddress: addressbookLabel(item),
        address: addressbookLabel(item),
        country: item.country,
        currency: item.currency,
        isSelected: item.externalLocationId === selected
      }))
    },
    widgetStates: {
      webPrice: JSON.stringify({ price: point.priceText }),
      addressbook: JSON.stringify({
        addresses: Object.values(fakePoints).map((item) => ({
          deliveryAddressOid: item.externalLocationId,
          title: item.name,
          address: addressbookLabel(item)
        }))
      })
    }
  };
}

function requestContainsAddressbookSetSm(request) {
  const chunks = [request.url(), request.postData() || ""];
  return chunks.flatMap((value) => [value, safeDecodeURIComponent(value)]).some((value) => /\/modal\/addressbook\?set_sm=1/i.test(value));
}

function fakeAddressbookSetSmResponse() {
  return {
    layout: [
      {
        component: "commonAddressBook",
        stateId: "commonAddressBook-960478-default-1",
        name: "addressBookMap.commonAddressBook"
      }
    ],
    widgetStates: {
      "commonAddressBook-960478-default-1": JSON.stringify({
        title: { text: "Выберите адрес доставки" },
        addresses: Object.values(fakePoints).map((point) => ({
          addressBookId: point.externalLocationId,
          title: { text: "Пункт Ozon", textStyle: "tsCompactControl500Medium" },
          isEnabled: true,
          isSelected: point.externalLocationId === fakePoints.kz.externalLocationId,
          elements: [
            { text: visibleSelectorLabel(point), textStyle: "tsBodyM", textColor: "textPrimary" },
            { text: "Срок хранения заказа – 14 дней", textStyle: "tsBodyM", textColor: "textSecondary" }
          ],
          controls: [
            {
              text: "Редактировать",
              action: {
                behavior: "BEHAVIOR_TYPE_COMPOSER_NESTED_PAGE",
                link: `/modal/commonDelivery?addrbookid=${point.externalLocationId}&pid=5&pp=${point.externalLocationId === fakePoints.kz.externalLocationId ? "440129" : "469716"}`
              }
            }
          ]
        }))
      })
    }
  };
}

function selectedLocationForRequest(requested) {
  if (routeState.scenario === "success" && pointByExternalLocationId(requested)) {
    return requested;
  }
  if (routeState.scenario === "success" && !requested) {
    return fakePoints.ru.externalLocationId;
  }
  return fakePoints.kz.externalLocationId;
}

function pointByExternalLocationId(id) {
  return Object.values(fakePoints).find((point) => point.externalLocationId === id) || null;
}

function requestedLocationFromRequest(request) {
  const rawBody = request.postData() || "";
  const chunks = [request.url(), rawBody];

  try {
    const parsed = JSON.parse(rawBody);
    if (typeof parsed.deliveryAddressOid === "string") {
      return parsed.deliveryAddressOid;
    }
    if (typeof parsed.select_location === "string") {
      return parsed.select_location;
    }
    if (typeof parsed.url === "string") {
      chunks.push(parsed.url);
    }
  } catch {
    // Fall back to textual matching below.
  }

  for (const chunk of chunks.flatMap((value) => [value, safeDecodeURIComponent(value)])) {
    const match = chunk.match(/(?:deliveryAddressOid|select_location|select_address)["'\s:=&?]+([a-z0-9_-]{4,80})/i);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function fakeProductHtml() {
  const selectorIdsOnly = routeState.scenario === "selector-ids-only";
  const streetOnlyCurrentSummary = routeState.scenario === "street-only-current-summary";
  const includeDeliveryDialog = !selectorIdsOnly && !streetOnlyCurrentSummary;
  const deliveryDialogHtml = `<div class="delivery-dialog" data-widget="deliveryDialog" role="dialog" aria-label="Delivery selector">
        <h2>Выберите пункт выдачи</h2>
        ${Object.values(fakePoints)
          .map(
            (point) => `<div class="pvz-row" role="option" aria-selected="${point.externalLocationId === fakePoints.kz.externalLocationId}" ${
              selectorIdsOnly ? "" : `data-delivery-address-oid="${point.externalLocationId}"`
            } title="${visibleSelectorLabel(point)}">
          ${visibleSelectorLabel(point)} Срок хранения заказа - 14 дней
          <button type="button">Редактировать</button>
        </div>`
          )
          .join("")}
        ${selectorIdsOnly ? '<div class="home-row" role="option">Дом Буинск, ул. Комарова, 87</div>' : ""}
      </div>`;
  const state = streetOnlyCurrentSummary
    ? { delivery: { selectedAddress: { fullAddress: "Пункт Ozon • ул. Вахитова, 174б" }, items: [] } }
    : {
        delivery: {
          selectedAddress: selectorIdsOnly
            ? {
                fullAddress: fakePoints.kz.name
              }
            : {
                deliveryAddressOid: fakePoints.kz.externalLocationId,
                fullAddress: fakePoints.kz.name
              },
          items: selectorIdsOnly
            ? []
            : Object.values(fakePoints).map((point) => ({
                deliveryAddressOid: point.externalLocationId,
                fullAddress: point.name,
                title: point.name
              }))
        }
      };

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Fake Ozon product</title>
    <style>
      body { margin: 0; padding: 32px; font-family: Arial, sans-serif; color: #111827; background: #f5f6f8; }
      main { max-width: 920px; margin: 0 auto; background: white; padding: 24px; border-radius: 12px; }
      .product-layout { display: grid; grid-template-columns: minmax(0, 1fr) 288px; gap: 24px; align-items: start; }
      .price-card { box-sizing: border-box; width: 288px; max-width: 100%; padding: 16px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
      [data-widget="webPrice"] { width: 100%; min-height: 56px; margin: 0 0 16px; font-size: 32px; font-weight: 700; }
      [data-widget="webDelivery"] { width: 520px; min-height: 76px; margin: 16px 0; padding: 12px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; }
      [data-widget="addressBookBarWeb"] { width: 180px; min-height: 20px; margin: 12px 0; font-size: 14px; }
      .delivery-dialog { width: 520px; min-height: 260px; padding: 16px; border: 1px solid #d1d5db; border-radius: 12px; background: #fff; }
      .pvz-row { display: block; position: relative; width: 460px; min-height: 68px; margin-top: 10px; padding: 12px 120px 12px 12px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fafafa; }
    </style>
    <script>
      window.__INITIAL_STATE__ = ${JSON.stringify(state)};
      localStorage.setItem("ozon-delivery-state", ${JSON.stringify(JSON.stringify(state))});
      window.__openFakeDeliverySelector = () => {
        if (document.querySelector(".delivery-dialog")) {
          return;
        }
        document.querySelector("main").insertAdjacentHTML("beforeend", ${JSON.stringify(deliveryDialogHtml)});
      };
    </script>
  </head>
  <body>
    <main>
      <div class="product-layout">
        <section>
          <h1>Fake Ozon Product</h1>
          ${
            streetOnlyCurrentSummary
              ? '<div data-widget="addressBookBarWeb">ул. Вахитова, 174б</div>'
              : `<div data-widget="webDelivery">
                  <strong>Доставка и возврат</strong>
                  <div>Пункт Ozon № 440-129 ${fakePoints.kz.name}, Астана, пр-кт Улы Дала, 31</div>
                  <div>Пункты выдачи Ozon · С 19 июля</div>
                  <button type="button" onclick="window.__openFakeDeliverySelector()">Редактировать</button>
                </div>`
          }
          ${includeDeliveryDialog ? deliveryDialogHtml : ""}
        </section>
        <aside class="price-card">
          <div data-widget="webPrice"><span>100 000 ₸</span></div>
        </aside>
      </div>
    </main>
  </body>
</html>`;
}

function addressbookLabel(point) {
  if (point.externalLocationId === fakePoints.kz.externalLocationId) {
    return `${point.name}, Астана, пр-кт Улы Дала, 31`;
  }
  return `${point.name}, Москва, ул. Тверская, 1`;
}

function visibleSelectorLabel(point) {
  return point.externalLocationId === fakePoints.kz.externalLocationId
    ? "Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31"
    : "Пункт Ozon № 469-716 Буинск, ул. Вахитова, 174Б";
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
