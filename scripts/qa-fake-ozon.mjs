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
const fixtureStoreKey = "markonverter.ozonFixtures";
const timeoutMs = 12_000;
const rub9000Text = /(?:9[\s\u00a0]*000,00[\s\u00a0]*₽|RUB[\s\u00a0]*9,000\.00)/;
const rub17000Text = /(?:17[\s\u00a0]*000,00[\s\u00a0]*₽|RUB[\s\u00a0]*17,000\.00)/;

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
  scenario: "empty",
  selectedLocationId: fakePoints.kz.externalLocationId
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

  await verifyWidePriceCardPanelLayout(page, worker);
  await verifyDetectedPickupSave(page, worker);
  await verifyUnsavedPickupListDisclosure(page, worker);
  await verifySavedPickupLimit(page, worker);
  await verifyCurrentAddressReuseRegression(page, worker);
  await verifyCorruptedEditNameRecovery(page, worker);
  await verifyStreetOnlyCurrentSummaryCapture(page, worker);
  await verifySelectorIdsOnlyNameResolution(page, worker);
  await verifyGenericUuidNameResolution(page, worker);
  await verifyAutomaticTwoPointCaptureAndRestore(page, worker);
  await verifyRegionUnavailableWarningAndRestore(page, worker);
  await verifyManualTwoPointSuccess(page, worker, extensionId);

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

  await waitForPanelText(page, /ПВЗ Ozon не настроены\./, "empty settings state");
  await waitForPanelText(page, /Астана|Astana pickup/, "detected fake Ozon pickup point");
  await waitForPageText(page, /ПВЗ видно/, "delivery selector helper");

  await clickPanelButton(page, "Сохранить");
  await waitForPanelText(page, /Сохранено: |Сохранено и записана текущая цена|Проверяю 1 ПВЗ|Текущая цена автоматически записана/, "detected pickup save status");
  await page.locator('[data-markonverter-pvz-action].is-saved').waitFor({ timeout: timeoutMs });

  const settings = await readSettings(worker);
  assert(settings.pickupPoints.some((point) => point.externalLocationId === fakePoints.kz.externalLocationId), "detected pickup was saved");
}

async function verifyUnsavedPickupListDisclosure(page, worker) {
  const savedOnlyPoints = [
    { ...fakePoints.ru, id: "saved-ru", externalLocationId: "saved-ru-only", name: "Saved RU pickup" },
    { ...fakePoints.kz, id: "saved-kz", externalLocationId: "saved-kz-only", name: "Saved KZ pickup" }
  ];
  const candidateText = /Пункт Ozon № 440-129|Пункт Ozon № 469-716/;

  routeState.scenario = "empty";
  await seedStorage(worker, settingsWithPickupPoints(savedOnlyPoints, manualQuotesForPoints(savedOnlyPoints)));
  await openFakeProduct(page, "unsaved-candidates-collapsed");
  await waitForPanelText(page, /Saved RU pickup/, "saved pickup rows before unsaved candidates");
  await waitForPanelText(page, /Не добавленные ПВЗ/, "unsaved pickup list header");

  const collapsedText = await panelText(page);
  const savedIndex = collapsedText.indexOf("Saved KZ pickup");
  const unsavedIndex = collapsedText.indexOf("Не добавленные ПВЗ");
  assert(savedIndex >= 0 && unsavedIndex > savedIndex, `unsaved pickup list should render below saved rows:\n${collapsedText}`);
  assert(!candidateText.test(collapsedText), `unsaved pickup candidates should be collapsed by default after two saved points:\n${collapsedText}`);

  await clickPanelIconButton(page, "Показать не добавленные ПВЗ");
  await waitForPanelText(page, candidateText, "expanded unsaved pickup candidates");

  routeState.scenario = "empty";
  await seedStorage(worker, settingsWithPickupPoints([savedOnlyPoints[0]], manualQuotesForPoints([savedOnlyPoints[0]])));
  await openFakeProduct(page, "unsaved-candidates-expanded");
  await waitForPanelText(page, /Не добавленные ПВЗ/, "unsaved pickup list header with one saved point");
  await waitForPanelText(page, candidateText, "unsaved pickup candidates expanded before two saved points");
}

async function verifySavedPickupLimit(page, worker) {
  const savedPoints = Array.from({ length: 4 }, (_, index) => ({
    ...fakePoints.ru,
    id: `limit-${index}`,
    externalLocationId: `saved-limit-${index}`,
    name: `Saved limit ${index}`
  }));

  routeState.scenario = "empty";
  await seedStorage(worker, settingsWithPickupPoints(savedPoints, manualQuotesForPoints(savedPoints)));
  await openFakeProduct(page, "saved-pickup-limit");
  await waitForPanelText(page, /Не добавленные ПВЗ/, "unsaved pickup list at saved limit");
  await clickPanelIconButton(page, "Показать не добавленные ПВЗ");
  await waitForPanelText(page, /Пункт Ozon № 440-129|Пункт Ozon № 469-716/, "unsaved pickup candidates at saved limit");
  await clickPanelButton(page, "Сохранить");
  await waitForPanelText(page, /Можно сохранить не больше 4 ПВЗ Ozon/, "saved pickup limit message");

  const settings = await readSettings(worker);
  assert(settings.pickupPoints.length === 4, `saved pickup limit should keep four points, got ${settings.pickupPoints.length}`);
  assert(
    !settings.pickupPoints.some((point) => point.externalLocationId === fakePoints.kz.externalLocationId),
    "saved pickup limit should not add a fifth Ozon point"
  );
}

async function verifyCurrentAddressReuseRegression(page, worker) {
  routeState.scenario = "reuse";
  await seedStorage(worker, settingsWithPickupPoints([fakePoints.ru, fakePoints.kz]));
  const locationSelectionRequestsBefore = routeStats.locationSelectionRequests;
  await openFakeProduct(page, "reuse");

  await waitForPanelText(page, /Moscow pickup/, "Moscow row");
  await waitForPanelText(page, /Astana pickup/, "Astana row");
  await waitForPanelText(page, rub17000Text, "current KZ point auto-captured from visible page");
  await waitForPanelText(page, /Недоступно/, "unavailable row before manual capture");
  await waitForPanelText(page, /Ozon не подтвердил этот ПВЗ.*Записать текущую/i, "guarded activation failure guidance");
  assert(
    routeStats.locationSelectionRequests > locationSelectionRequestsBefore,
    `saved-row comparison did not try the guarded activation fallback: ${JSON.stringify(routeStats.lastLocationSelectionUrls)}`
  );

  let settings = await readSettings(worker);
  assert(settings.manualQuotes["2229282395:kz"], "current KZ point was auto-captured without pressing Capture current");

  await assertPanelButtonAbsent(page, "Копировать детали");
  const defaultPanelText = await panelText(page);
  assert(!defaultPanelText.includes("Фикстуры Ozon"), `debug fixture row should be hidden by default:\n${defaultPanelText}`);
  const fixtureStore = await chromeStorageGet(worker, fixtureStoreKey);
  assert(!fixtureStore?.records?.length, `debug fixtures should not be recorded while debug mode is off: ${JSON.stringify(fixtureStore)}`);

  await setDebugMode(worker, true);
  await waitForPanelText(page, /Копировать детали/, "debug diagnostics button");
  await waitForPanelText(page, /Фикстуры Ozon/, "debug fixtures row");
  await clickPanelButton(page, "Копировать детали");
  await waitForPanelText(page, /Диагностика ПВЗ скопирована|Не удалось скопировать диагностику/, "diagnostics copy status");

  await clickPanelButton(page, "Записать текущую");
  await waitForPanelText(page, /Записать видимую цену\?/, "inline capture confirmation");
  await clickPanelButton(page, "Записать цену");
  await waitForPanelText(page, /Текущая цена страницы записана для Moscow pickup|Записано /, "manual capture status");

  settings = await readSettings(worker);
  assert(settings.manualQuotes["2229282395:ru"], "manual quote was stored for the unavailable Moscow row");
}

async function verifyCorruptedEditNameRecovery(page, worker) {
  routeState.scenario = "reuse";
  const editNamePoints = [
    { ...fakePoints.ru, name: "Редактировать" },
    { ...fakePoints.kz, name: "Редактировать" }
  ];
  await seedStorage(worker, settingsWithPickupPoints(editNamePoints, manualQuotesForPoints(editNamePoints)));
  await openFakeProduct(page, "edit-name-recovery");

  await waitForPanelText(page, rub17000Text, "auto capture after edit-name repair");
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

  await waitForPanelText(page, rub17000Text, "street-only current summary auto-capture");

  const settings = await readSettings(worker);
  assert(
    settings.manualQuotes["2229282395:kz"],
    "street-only current delivery summary did not auto-capture the saved current pickup point"
  );
}

async function verifySelectorIdsOnlyNameResolution(page, worker) {
  routeState.scenario = "selector-ids-only";
  const selectorIdPoints = [
    { ...fakePoints.ru, name: `Ozon pickup ${fakePoints.ru.externalLocationId}` },
    { ...fakePoints.kz, name: `Ozon pickup ${fakePoints.kz.externalLocationId}` }
  ];
  await seedStorage(worker, settingsWithPickupPoints(selectorIdPoints, manualQuotesForPoints(selectorIdPoints)));
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
  const genericUuidPoints = [{ ...fakePoints.kz, name: `Ozon pickup ${fakePoints.kz.externalLocationId}` }];
  await seedStorage(worker, settingsWithPickupPoints(genericUuidPoints, manualQuotesForPoints(genericUuidPoints)));
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

async function verifyAutomaticTwoPointCaptureAndRestore(page, worker) {
  routeState.scenario = "success";
  await seedStorage(worker, settingsWithPickupPoints([fakePoints.ru, fakePoints.kz]));
  const locationSelectionRequestsBefore = routeStats.locationSelectionRequests;
  await openFakeProduct(page, "automatic-two-point-capture");

  await waitForPanelText(page, /Moscow pickup/, "Moscow automatic row");
  await waitForPanelText(page, /Astana pickup/, "Astana automatic row");
  await waitForPanelText(page, rub9000Text, "Moscow automatically captured price");
  await waitForPanelText(page, rub17000Text, "Astana automatically captured converted price");
  await waitForSettingsCondition(
    worker,
    (settings) => Boolean(settings.manualQuotes["2229282395:ru"] && settings.manualQuotes["2229282395:kz"]),
    "automatic quotes saved for both pickup points"
  );
  assert(
    routeStats.locationSelectionRequests > locationSelectionRequestsBefore,
    `automatic two-point capture did not use activation fallback: ${JSON.stringify(routeStats.lastLocationSelectionUrls)}`
  );
  assert(
    routeStats.lastLocationSelectionUrls.some((url) => url.includes("select_address%3Dkz-456")),
    `automatic two-point capture did not restore the originally selected KZ pickup point: ${JSON.stringify(
      routeStats.lastLocationSelectionUrls
    )}`
  );
  assert(
    routeState.selectedLocationId === fakePoints.kz.externalLocationId,
    `fake Ozon state was not restored to the original KZ pickup point: ${routeState.selectedLocationId}`
  );
}

async function verifyRegionUnavailableWarningAndRestore(page, worker) {
  routeState.scenario = "region-unavailable";
  await seedStorage(worker, settingsWithPickupPoints([fakePoints.ru, fakePoints.kz]));
  await openFakeProduct(page, "region-unavailable");

  await waitForPanelText(page, /Moscow pickup/, "region-unavailable Moscow row");
  await waitForPanelText(page, /Astana pickup/, "region-unavailable Astana row");
  await waitForPanelText(page, /Нет в регионе/, "regional warning title");
  await waitForPanelText(page, /Товар не доставляется в регион этого ПВЗ/, "regional warning text");
  await waitForPanelText(page, rub17000Text, "available KZ price after unavailable RU region");

  const text = await panelText(page);
  assert(!/Нет в регионе[\s\S]*Записать текущую/.test(text), `region-unavailable warning should not offer manual capture:\n${text}`);
  assert(
    routeState.selectedLocationId === fakePoints.kz.externalLocationId,
    `region-unavailable scenario should restore an available KZ pickup point, got ${routeState.selectedLocationId}`
  );
}

async function verifyManualTwoPointSuccess(page, worker, extensionId) {
  routeState.scenario = "success";
  await seedStorage(worker, settingsWithPickupPoints([fakePoints.ru, fakePoints.kz], manualQuotesForFakePoints()));
  await openFakeProduct(page, "success");

  await waitForPanelText(page, /Moscow pickup/, "Moscow manual row");
  await waitForPanelText(page, /Astana pickup/, "Astana manual row");
  await waitForPanelText(page, rub9000Text, "Moscow captured price");
  await waitForPanelText(page, rub17000Text, "Astana captured converted price");
  const text = await panelText(page);
  assert(!/Unavailable|Недоступно/.test(text), "manual quote scenario should not show unavailable rows");
  await assertPanelRowChrome(page);
  await verifyPanelCollapseAnimation(page);
  await deleteFirstPanelPickupPoint(page, worker);

  await verifyOptionsComparisonManagement(page, worker, extensionId);

  const settings = await readSettings(worker);
  assert(settings.pickupPoints.length === 1, `expected one pickup point after delete, got ${settings.pickupPoints.length}`);
}

async function openFakeProduct(page, label) {
  await clearSweepSessionState(page);
  routeState.selectedLocationId = initialSelectedLocationId();
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
  await waitForOzonSweepSettled(page);
  await page.locator("#markonverter-panel-root").waitFor({ state: "attached", timeout: timeoutMs });
  await assertPanelFitsPriceCard(page, label);
}

// The visible price sweep reloads the page a few times; wait until it has finished
// so scenario assertions do not race against a navigation.
async function waitForOzonSweepSettled(page) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let clearStreak = 0;
  while (Date.now() < deadline) {
    let active = true;
    try {
      active = await page.evaluate(() => Boolean(sessionStorage.getItem("markonverter.ozonSweep.v1")));
    } catch {
      active = true; // A sweep reload is navigating the page; keep waiting.
    }
    if (active) {
      clearStreak = 0;
    } else if (++clearStreak >= 3 && Date.now() - startedAt > 700) {
      return;
    }
    await page.waitForTimeout(150);
  }
}

function initialSelectedLocationId() {
  return routeState.scenario === "region-unavailable" ? fakePoints.ru.externalLocationId : fakePoints.kz.externalLocationId;
}

// The visible reload sweep persists progress in sessionStorage, which survives the
// same-origin navigations between scenarios. Clear it so each scenario starts clean
// (sweep-internal reloads are not affected because they never call openFakeProduct).
async function clearSweepSessionState(page) {
  try {
    await page.evaluate(() => {
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith("markonverter.ozon"))
        .forEach((key) => sessionStorage.removeItem(key));
    });
  } catch {
    // A fresh/blank page has nothing to clear.
  }
}

// Suppress the auto price sweep for scenarios that only exercise panel/name UI by
// pre-seeding a captured quote for every saved point.
function manualQuotesForPoints(points) {
  const capturedAt = "2026-07-01T08:00:00.000Z";
  const quotes = {};
  for (const point of points) {
    quotes[`2229282395:${point.id}`] = {
      productId: "2229282395",
      productUrl,
      pickupPointId: point.id,
      quote: {
        amount: point.currency === "KZT" ? 100000 : 9000,
        currency: point.currency,
        rawText: point.priceText || "",
        source: "manual",
        capturedAt
      },
      capturedAt
    };
  }
  return quotes;
}

async function assertNoPanel(page, label) {
  const hasPanel = await page.locator("#markonverter-panel-root").count();
  assert(hasPanel === 0, `${label} unexpectedly has a Markonverter panel`);
}

async function verifyWidePriceCardPanelLayout(page, worker) {
  routeState.scenario = "wide-price-card";
  await seedStorage(worker, settingsWithPickupPoints([fakePoints.ru, fakePoints.kz], manualQuotesForFakePoints()));
  await openFakeProduct(page, "wide-price-card");
  await waitForPanelText(page, /Moscow pickup/, "wide price-card panel row");
  await assertPanelFitsPriceCard(page, "wide-price-card");
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
  try {
    return await page
      .locator("#markonverter-panel-root")
      .evaluate((host) => host.shadowRoot?.querySelector(".panel")?.textContent || "");
  } catch {
    return ""; // The panel may be mid-reload during a price sweep.
  }
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
  assert(metrics.panel.width >= metrics.host.width - 1, `${label} panel did not fill panel host width: ${JSON.stringify(metrics)}`);
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

async function assertPanelButtonAbsent(page, label) {
  const labels = await page.locator("#markonverter-panel-root").evaluate((host) => {
    return Array.from(host.shadowRoot?.querySelectorAll("button") || []).map((button) => button.textContent?.trim() || "");
  });
  assert(!labels.includes(label), `Panel button should be hidden: ${label}. Current buttons: ${JSON.stringify(labels)}`);
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

async function assertPanelRowChrome(page) {
  await page.locator("#markonverter-panel-root").evaluate((host) => {
    const shadow = host.shadowRoot;
    if (!shadow) {
      throw new Error("Panel shadow root not found");
    }
    const checkboxCount = shadow.querySelectorAll("input.compareToggle").length;
    const buttonLabels = Array.from(shadow.querySelectorAll("button")).map((button) => button.textContent?.trim() || "");
    const rowText = Array.from(shadow.querySelectorAll(".row")).map((row) => row.textContent || "").join("\n");
    if (checkboxCount > 0) {
      throw new Error("Product panel still shows comparison checkboxes");
    }
    if (buttonLabels.includes("Add current") || buttonLabels.includes("Добавить текущую")) {
      throw new Error("Product panel still shows Add current");
    }
    if (/Moscow pickup\s+(?:RU|KZ)\s*\/\s*(?:RUB|KZT)/i.test(rowText) || /Astana pickup\s+(?:RU|KZ)\s*\/\s*(?:RUB|KZT)/i.test(rowText)) {
      throw new Error(`Product panel still shows country/currency metadata under saved pickup names:\n${rowText}`);
    }
    if (/Captured |Записано |Today, 18:00-20:00|Tomorrow, 10:00-18:00/i.test(rowText)) {
      throw new Error(`Product panel still shows captured metadata or delivery text under prices:\n${rowText}`);
    }
  });
}

async function verifyPanelCollapseAnimation(page) {
  const before = await panelBox(page);
  const beforeHeader = await panelHeaderSnapshot(page);
  assert(beforeHeader.hasSettingsButton, `expanded panel header is missing settings button: ${JSON.stringify(beforeHeader)}`);
  assert(beforeHeader.bodyChildCount > 0, `expanded panel should render body content: ${JSON.stringify(beforeHeader)}`);

  await clickPanelIconButton(page, "Свернуть панель Markonverter");
  await page.waitForTimeout(110);
  const mid = await panelBox(page);
  assert(!mid.collapsed, `panel switched to collapsed markup before the collapse animation finished: ${JSON.stringify({ before, mid })}`);
  assert(mid.height < before.height - 8, `panel height did not animate down during collapse: ${JSON.stringify({ before, mid })}`);

  await waitForPanelCollapsed(page, true);
  const collapsed = await panelBox(page);
  const collapsedHeader = await panelHeaderSnapshot(page);
  assert(collapsed.height < before.height - 24, `panel did not end collapsed: ${JSON.stringify({ before, collapsed })}`);
  assert(Math.abs(collapsed.width - before.width) < 1, `collapsed panel should keep the same header width: ${JSON.stringify({ before, collapsed })}`);
  assert(collapsedHeader.title === beforeHeader.title, `collapsed panel header title changed: ${JSON.stringify({ beforeHeader, collapsedHeader })}`);
  assert(collapsedHeader.hasSettingsButton, `collapsed panel header should keep the settings button: ${JSON.stringify(collapsedHeader)}`);
  assert(collapsedHeader.bodyChildCount === 0, `collapsed panel should hide only the body: ${JSON.stringify(collapsedHeader)}`);

  await clickPanelIconButton(page, "Развернуть панель Markonverter");
  await waitForPanelCollapsed(page, false);
  await page.waitForTimeout(260);
  const expanded = await panelBox(page);
  assert(expanded.height > collapsed.height + 24, `panel did not expand back to full height: ${JSON.stringify({ collapsed, expanded })}`);
}

async function panelBox(page) {
  return page.locator("#markonverter-panel-root").evaluate((host) => {
    const panel = host.shadowRoot?.querySelector(".panel");
    if (!panel) {
      throw new Error("Panel not found");
    }
    const rect = panel.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      collapsed: panel.classList.contains("collapsed")
    };
  });
}

async function panelHeaderSnapshot(page) {
  return page.locator("#markonverter-panel-root").evaluate((host) => {
    const panel = host.shadowRoot?.querySelector(".panel");
    const header = panel?.querySelector(".header");
    if (!panel || !header) {
      throw new Error("Panel header not found");
    }
    const title = header.querySelector(".headerTitle")?.textContent?.replace(/\s+/g, " ").trim() || "";
    return {
      title,
      hasSettingsButton: Boolean(header.querySelector('button[aria-label="Открыть настройки"]')),
      bodyChildCount: Array.from(panel.children).filter((child) => !child.classList.contains("header")).length
    };
  });
}

async function clickPanelIconButton(page, label) {
  await page.locator("#markonverter-panel-root").evaluate((host, buttonLabel) => {
    const buttons = Array.from(host.shadowRoot?.querySelectorAll("button") || []);
    const button = buttons.find((item) => item.getAttribute("aria-label") === buttonLabel);
    if (!button) {
      throw new Error(`Panel icon button not found: ${buttonLabel}`);
    }
    button.click();
  }, label);
}

async function waitForPanelCollapsed(page, expected) {
  await page.waitForFunction(
    ({ selector, expected }) => {
      const host = document.querySelector(selector);
      const panel = host?.shadowRoot?.querySelector(".panel");
      return Boolean(panel) && panel.classList.contains("collapsed") === expected;
    },
    { selector: "#markonverter-panel-root", expected },
    { timeout: timeoutMs }
  );
}

async function deleteFirstPanelPickupPoint(page, worker) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(60);

  const firstRow = page.locator("#markonverter-panel-root .row").first();
  const deleteButton = page.locator("#markonverter-panel-root .rowDeleteButton").first();
  const before = await rowHoverMetrics(firstRow, deleteButton);
  assert(before.button.visibility === "hidden" && Number(before.button.opacity) === 0, `delete button should be hidden before hover: ${JSON.stringify(before)}`);

  await firstRow.hover();
  await page.waitForTimeout(180);
  const after = await rowHoverMetrics(firstRow, deleteButton);
  assert(after.button.visibility === "visible" && Number(after.button.opacity) > 0.9, `delete button should be visible on hover: ${JSON.stringify(after)}`);
  assert(Math.abs(after.box.width - before.box.width) < 0.5, `row width changed on hover: ${JSON.stringify({ before, after })}`);
  assert(Math.abs(after.box.height - before.box.height) < 0.5, `row height changed on hover: ${JSON.stringify({ before, after })}`);

  await deleteButton.click();
  await waitForPanelText(page, /Удалить ПВЗ\?/, "hover delete confirmation");
  await clickPanelButton(page, "Удалить ПВЗ");
  await waitForSettingsCondition(
    worker,
    (settings) => settings.pickupPoints.length === 1 && settings.pickupPoints[0]?.id === "kz",
    "hover delete saved pickup"
  );
}

async function rowHoverMetrics(row, button) {
  const box = await row.boundingBox();
  if (!box) {
    throw new Error("Panel row has no bounding box");
  }
  const buttonState = await button.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      opacity: style.opacity,
      visibility: style.visibility
    };
  });
  return { box, button: buttonState };
}

async function verifyOptionsComparisonManagement(page, worker, extensionId) {
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#pointList .point").first().waitFor({ timeout: timeoutMs });
  await verifyLanguageSetting(page, worker);

  await clickOptionsPointButton(page, "Astana pickup", "Сравнивается");
  await waitForSettingsCondition(
    worker,
    (settings) => Array.isArray(settings.comparisonPickupPointIds) && settings.comparisonPickupPointIds.length === 0,
    "options comparison toggle"
  );
}

async function verifyLanguageSetting(page, worker) {
  await waitForOptionsText(page, /Язык интерфейса/, "Russian language section");
  const initial = await page.locator("#language").inputValue();
  assert(initial === "ru", `expected default Russian language setting, got ${initial}`);

  await page.selectOption("#language", "en");
  await clickOptionsButton(page, "Сохранить язык");
  await waitForOptionsText(page, /Language saved/, "English language save status");
  await waitForOptionsText(page, /Interface language/, "English settings UI");
  await waitForSettingsCondition(worker, (settings) => settings.language === "en", "English language setting");

  await page.selectOption("#language", "ru");
  await clickOptionsButton(page, "Save language");
  await waitForOptionsText(page, /Язык сохранен/, "Russian language save status");
  await waitForOptionsText(page, /Язык интерфейса/, "Russian settings UI restored");
  await waitForSettingsCondition(worker, (settings) => settings.language === "ru", "Russian language setting");
}

async function waitForOptionsText(page, matcher, label) {
  const deadline = Date.now() + timeoutMs;
  let current = "";
  while (Date.now() < deadline) {
    current = await page.locator("body").textContent();
    if (matchesText(current || "", matcher)) {
      return current;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`Timed out waiting for ${label}. Current options text:\n${current}`);
}

async function clickOptionsButton(page, buttonLabel) {
  await page.evaluate((label) => {
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
    if (!button) {
      throw new Error(`Options button not found: ${label}`);
    }
    button.click();
  }, buttonLabel);
}

async function clickOptionsPointButton(page, pointName, buttonLabel) {
  await page.evaluate(({ pointName, buttonLabel }) => {
    const rows = Array.from(document.querySelectorAll("#pointList .point"));
    const row = rows.find((item) => item.textContent?.includes(pointName));
    if (!row) {
      throw new Error(`Options pickup row not found: ${pointName}`);
    }
    const button =
      Array.from(row.querySelectorAll("button")).find((item) => item.textContent?.trim() === buttonLabel) ||
      row.querySelector("button.compareState");
    if (!button) {
      throw new Error(`Options comparison button not found for ${pointName}`);
    }
    button.click();
  }, { pointName, buttonLabel });
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
    language: "ru",
    debug: false,
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

async function setDebugMode(worker, debug) {
  const settings = await readSettings(worker);
  await chromeStorageSet(worker, {
    [settingsKey]: {
      ...settings,
      debug
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
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
  if ((routeState.scenario === "success" || routeState.scenario === "region-unavailable") && requestSelectsAddress(request) && pointByExternalLocationId(requested)) {
    routeState.selectedLocationId = requested;
  }
  const selected = selectedLocationForRequest(requested);
  const point = pointByExternalLocationId(selected) || fakePoints.kz;
  const unavailableInRegion = routeState.scenario === "region-unavailable" && selected === fakePoints.ru.externalLocationId;

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
      webPrice: JSON.stringify(unavailableInRegion ? { title: "Товар не доставляется в ваш регион" } : { price: point.priceText }),
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
  if ((routeState.scenario === "success" || routeState.scenario === "region-unavailable") && pointByExternalLocationId(requested)) {
    return requested;
  }
  if (routeState.scenario === "success" || routeState.scenario === "region-unavailable") {
    return routeState.selectedLocationId || fakePoints.kz.externalLocationId;
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

function requestSelectsAddress(request) {
  const rawBody = request.postData() || "";
  const chunks = [request.url(), rawBody];

  try {
    const parsed = JSON.parse(rawBody);
    if (typeof parsed.url === "string") {
      chunks.push(parsed.url);
    }
  } catch {
    // Fall back to textual matching below.
  }

  return chunks.flatMap((value) => [value, safeDecodeURIComponent(value)]).some((value) => /\/modal\/addressbook\?[^"'\s]*select_address=/i.test(value));
}

function fakeProductHtml() {
  const selectorIdsOnly = routeState.scenario === "selector-ids-only";
  const streetOnlyCurrentSummary = routeState.scenario === "street-only-current-summary";
  const widePriceCard = routeState.scenario === "wide-price-card";
  const includeDeliveryDialog = !selectorIdsOnly && !streetOnlyCurrentSummary;
  const currentPoint = pointByExternalLocationId(routeState.selectedLocationId) || fakePoints.kz;
  const currentUnavailableInRegion = routeState.scenario === "region-unavailable" && currentPoint.externalLocationId === fakePoints.ru.externalLocationId;
  const priceCardWidth = widePriceCard ? 680 : 288;
  const mainWidth = widePriceCard ? 1080 : 920;
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
                deliveryAddressOid: currentPoint.externalLocationId,
                fullAddress: currentPoint.name
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
      main { max-width: ${mainWidth}px; margin: 0 auto; background: white; padding: 24px; border-radius: 12px; }
      .product-layout { display: grid; grid-template-columns: minmax(0, 1fr) ${priceCardWidth}px; gap: 24px; align-items: start; }
      .price-card { box-sizing: border-box; width: ${priceCardWidth}px; max-width: 100%; padding: 16px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
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
                  <div>${visibleSelectorLabel(currentPoint)} ${addressbookLabel(currentPoint)}</div>
                  <div>Пункты выдачи Ozon · С 19 июля</div>
                  <button type="button" onclick="window.__openFakeDeliverySelector()">Редактировать</button>
                </div>`
          }
          ${includeDeliveryDialog ? deliveryDialogHtml : ""}
        </section>
        <aside class="price-card">
          <div data-widget="webPrice"><span>${currentUnavailableInRegion ? "Товар не доставляется в ваш регион" : currentPoint.priceText}</span></div>
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
