// Generates the store/README screenshots from the REAL extension UI: loads the
// built extension into a realistic fake Ozon product page, seeds two saved
// pickup points, and screenshots the authentic rendered panel, the options
// page, and the panel embedded inside an Ozon price card. The marketplace-style
// promo cards are composited from those same real screenshots, so nothing is
// hand-drawn or stretched.
//
// Run: npm run build && node scripts/screenshots.mjs
// ponytail: self-contained one-off tooling; copies the minimal fake-Ozon
// scaffolding from qa-fake-ozon.mjs rather than exporting from a tested script.

import { chromium } from "playwright";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const extensionPath = path.join(repoRoot, "dist");
const outDir = path.join(repoRoot, "docs", "screenshots");
const fakeOzonOrigin = "https://www.ozon.kz";
const productId = "2229282395";
const productUrl = `${fakeOzonOrigin}/product/fake-product-${productId}/`;
const productTitle = "Смартфон Xiaomi Redmi Note 13 8/256 ГБ";
const settingsKey = "markonverter.settings";
const panelStateKey = "markonverter.panelState";
const timeoutMs = 15_000;

// Two saved Ozon pickup points. Moscow is the currently selected (visible) one,
// so the native Ozon price shows ₽; Astana is cheaper once converted → best row.
const points = {
  ru: {
    id: "ru",
    externalLocationId: "ru-123",
    name: "ПВЗ Москва · Тверская, 1",
    country: "RU",
    currency: "RUB",
    amount: 17990,
    priceText: "17 990 ₽"
  },
  kz: {
    id: "kz",
    externalLocationId: "kz-456",
    name: "ПВЗ Астана · Улы Дала, 31",
    country: "KZ",
    currency: "KZT",
    amount: 89990,
    priceText: "89 990 ₸"
  }
};
const currentPoint = points.ru;

if (!existsSync(path.join(extensionPath, "manifest.json"))) {
  throw new Error("dist/manifest.json is missing. Run npm run build first.");
}
mkdirSync(outDir, { recursive: true });

const userDataDir = mkdtempSync(path.join(tmpdir(), "markonverter-shots-"));
let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });
  context.setDefaultTimeout(timeoutMs);
  await installRoutes(context);

  const worker = await waitForWorker(context);
  const extensionId = new URL(worker.url()).host;
  console.log(`Loaded extension ${extensionId}`);

  const page = context.pages()[0] || (await context.newPage());
  await installRoutes(page);
  // Let the extension finish writing its default settings on first install
  // before seeding, otherwise a late default write clobbers our pickup points.
  await page.goto("data:text/html,<h1>init</h1>");
  await page.waitForTimeout(800);
  await seedStorage(worker);

  // --- Real product page: authentic panel + price card ---
  await page.goto(`${productUrl}?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
  const panelHost = page.locator("#markonverter-panel-root");
  await panelHost.waitFor({ state: "attached", timeout: timeoutMs });
  await waitPanelText(page, /лучшее/); // best-row comparison rendered
  await page.waitForTimeout(600); // let collapse/expand + status settle

  const rawPanel = await shot(panelHost);
  const rawPriceCard = await shot(page.locator(".price-card"));

  // --- Options page ---
  const options = await context.newPage();
  await options.setViewportSize({ width: 1180, height: 1000 });
  await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "domcontentloaded" });
  await options.getByText(points.kz.name).first().waitFor({ timeout: timeoutMs });
  await options.waitForTimeout(300);
  const rawOptions = await shot(options.locator("main"));
  await options.close();

  // --- Framed clean deliverables + promo cards, composited from real shots ---
  const compose = await context.newPage();
  await compose.setViewportSize({ width: 1600, height: 1600 });

  await render(compose, framePage(rawPanel, { pad: 72, maxw: 460 }), path.join(outDir, "panel-element.png"));
  await render(compose, framePage(rawPriceCard, { pad: 72, maxw: 520 }), path.join(outDir, "ozon-price-block.png"));
  await render(compose, framePage(rawOptions, { pad: 56, maxw: 1180, bg: "#eef3fa" }), path.join(outDir, "options.png"));
  await render(compose, promoPanel(rawPanel), path.join(outDir, "promo-panel.png"));
  await render(compose, promoOzon(rawPriceCard), path.join(outDir, "promo-ozon.png"));
  await compose.close();

  // Chrome Web Store tile must be EXACTLY 1280x800 → render at dsf 1 in a
  // plain browser (the persistent extension context is locked to dsf 2).
  const tileBrowser = await chromium.launch();
  try {
    const tile = await tileBrowser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await render(tile, storeTile(rawPriceCard), path.join(outDir, "store-1280x800.png"));
  } finally {
    await tileBrowser.close();
  }

  console.log("Screenshots written to docs/screenshots/");
} finally {
  await context?.close().catch(() => undefined);
  rmSync(userDataDir, { recursive: true, force: true });
}

// -- helpers -----------------------------------------------------------------

// Poll the panel's shadow DOM text until it matches; survives the transient
// loading/checking rerenders and same-origin sweep reloads.
async function waitPanelText(page, re) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    // Bound each poll so a mid-sweep navigation (host detached) can't eat the
    // whole budget; a reload just yields "" and we retry.
    const text = await page
      .locator("#markonverter-panel-root")
      .evaluate((el) => el.shadowRoot?.querySelector(".panel")?.textContent || "", undefined, { timeout: 700 })
      .catch(() => "");
    if (re.test(text)) return;
    await page.waitForTimeout(250).catch(() => undefined);
  }
  throw new Error(`panel text never matched ${re}`);
}

async function shot(locator) {
  const buf = await locator.screenshot();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

// Render an HTML body, then screenshot its single .stage element (tight crop).
async function render(page, body, outPath) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    *{margin:0;box-sizing:border-box}
    body{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;display:inline-block}
    .stage{display:inline-block}
  </style>${body}`);
  await page.locator(".stage").first().screenshot({ path: outPath });
}

function framePage(dataUri, { pad, maxw, bg = "#f5f7fa" }) {
  return `<div class="stage" style="background:linear-gradient(160deg,#ffffff, ${bg});padding:${pad}px;width:${maxw + pad * 2}px">
    <img src="${dataUri}" style="display:block;width:${maxw}px;border-radius:12px;box-shadow:0 18px 50px rgba(23,35,60,.16)">
  </div>`;
}

function promoPanel(panelUri) {
  const saving = points.ru.amount - Math.round(points.kz.amount * 0.17);
  return `<div class="stage" style="width:1200px;height:1500px;overflow:hidden;
      background:linear-gradient(200deg,#f5f7fa,#e3edff);color:#17233c;padding:88px;
      display:flex;flex-direction:column">
    <div style="font-size:32px;font-weight:700;color:#005bff">Markonverter для Ozon</div>
    <h1 style="font-size:76px;line-height:1.05;font-weight:800;margin-top:24px;max-width:980px">
      Сравни цены Ozon<br>по всем ПВЗ сразу</h1>
    <p style="font-size:32px;line-height:1.4;color:#53627a;margin-top:26px;max-width:900px">
      Прямо на странице товара — какой пункт выдачи дешевле, с учётом валюты и курса.</p>
    <div style="flex:1;display:flex;align-items:center;gap:40px;margin-top:56px">
      <img src="${panelUri}" style="width:560px;flex:0 0 auto;border-radius:16px;box-shadow:0 30px 70px rgba(23,35,60,.22)">
      <div style="flex:0 0 auto;background:#fff;color:#0b7a3e;border:1px solid #dce3ee;border-radius:28px;padding:38px 40px;box-shadow:0 24px 60px rgba(23,35,60,.18)">
        <div style="font-size:30px;font-weight:700;color:#53627a">экономия</div>
        <div style="font-size:66px;font-weight:800;line-height:1;white-space:nowrap;margin-top:6px">−${saving.toLocaleString("ru-RU")}&nbsp;₽</div>
      </div>
    </div>
  </div>`;
}

function storeTile(cardUri) {
  return `<div class="stage" style="width:1280px;height:800px;overflow:hidden;
      background:linear-gradient(200deg,#f5f7fa,#e3edff);color:#17233c;
      display:grid;grid-template-columns:1fr 500px;gap:48px;align-items:center;padding:0 80px">
    <div>
      <div style="font-size:23px;font-weight:700;color:#005bff">Markonverter для Ozon</div>
      <h1 style="font-size:58px;line-height:1.06;font-weight:800;margin-top:18px">Цены Ozon по всем ПВЗ — сразу на карточке товара</h1>
      <p style="font-size:26px;line-height:1.42;color:#53627a;margin-top:22px;max-width:560px">
        Сравнение сохранённых пунктов выдачи с автоконвертацией RUB/KZT — прямо в ценовом блоке Ozon.</p>
    </div>
    <img src="${cardUri}" style="width:500px;border-radius:18px;box-shadow:0 30px 70px rgba(23,35,60,.22)">
  </div>`;
}

function promoOzon(cardUri) {
  return `<div class="stage" style="width:1200px;height:1500px;position:relative;overflow:hidden;
      background:linear-gradient(200deg,#f5f7fa,#e3edff);color:#17233c;padding:88px">
    <div style="font-size:32px;font-weight:700;color:#005bff">Markonverter для Ozon</div>
    <h1 style="font-size:76px;line-height:1.05;font-weight:800;margin-top:24px;max-width:1000px">
      Тот же товар —<br>дешевле в другом ПВЗ</h1>
    <p style="font-size:32px;line-height:1.4;color:#53627a;margin-top:26px;max-width:900px">
      Расширение встраивается в ценовой блок Ozon и подсвечивает лучший пункт выдачи.</p>
    <div style="position:absolute;left:50%;transform:translateX(-50%);bottom:80px;display:flex;flex-direction:column;align-items:center">
      <div style="background:#10a35a;color:#fff;font-size:30px;font-weight:700;border-radius:999px;padding:14px 30px;margin-bottom:-18px;z-index:2;box-shadow:0 12px 30px rgba(16,163,90,.4)">лучшая цена ↓</div>
      <img src="${cardUri}" style="width:660px;border-radius:18px;box-shadow:0 40px 90px rgba(23,35,60,.28)">
    </div>
  </div>`;
}

// -- fake Ozon scaffolding (minimal, from qa-fake-ozon.mjs) ------------------

async function installRoutes(target) {
  await target.route(/^https:\/\/(?:www\.)?ozon\.kz\/api\//, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(apiResponse())
    });
  });
  await target.route(/^https:\/\/(?:www\.)?ozon\.kz\/product\//, async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: productHtml() });
  });
  await target.route(/^https:\/\/(?:www\.)?ozon\.kz\/(?!api\/|product\/)/, async (route) => {
    await route.fulfill({ status: 404, contentType: "text/plain", body: "not implemented" });
  });
}

async function waitForWorker(browserContext) {
  const existing = browserContext.serviceWorkers().find((w) => w.url().endsWith("/background.js"));
  if (existing) return existing;
  return browserContext.waitForEvent("serviceworker", { timeout: timeoutMs });
}

async function seedStorage(worker) {
  const settings = {
    language: "ru",
    debug: false,
    defaultCurrency: "RUB",
    currencyRateProvider: "manual",
    ratesToRub: { RUB: 1, KZT: 0.17 },
    pickupPoints: Object.values(points).map((p) => ({
      id: p.id,
      name: p.name,
      marketplace: "ozon",
      country: p.country,
      currency: p.currency,
      externalLocationId: p.externalLocationId,
      comment: ""
    })),
    comparisonPickupPointIds: null,
    manualQuotes: Object.fromEntries(
      Object.values(points).map((p) => [
        `${productId}:${p.id}`,
        {
          productId,
          productUrl,
          pickupPointId: p.id,
          quote: {
            amount: p.amount,
            currency: p.currency,
            rawText: p.priceText,
            source: "manual",
            capturedAt: "2026-07-01T08:00:00.000Z"
          },
          capturedAt: "2026-07-01T08:00:00.000Z"
        }
      ])
    )
  };
  const value = { [settingsKey]: settings, [panelStateKey]: { collapsed: false } };
  const write = () =>
    worker.evaluate(
      (v) => new Promise((res, rej) => chrome.storage.local.set(v, () => (chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res()))),
      value
    );
  // Write and confirm the read-back sticks; retry to beat any late default write.
  for (let i = 0; i < 5; i++) {
    await write();
    await new Promise((r) => setTimeout(r, 150));
    const saved = await worker.evaluate(
      (k) => new Promise((res) => chrome.storage.local.get(k, (r) => res(r[k]))),
      settingsKey
    );
    if (saved?.pickupPoints?.length === 2) return;
  }
  throw new Error("seed did not stick: extension kept overwriting settings");
}

function apiResponse() {
  return {
    delivery: { selectedAddressOid: currentPoint.externalLocationId, fullAddress: currentPoint.name },
    addressBook: {
      items: Object.values(points).map((p) => ({
        deliveryAddressOid: p.externalLocationId,
        title: p.name,
        fullAddress: p.name,
        isSelected: p.externalLocationId === currentPoint.externalLocationId
      }))
    },
    widgetStates: { webPrice: JSON.stringify({ price: currentPoint.priceText }) }
  };
}

function productHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${productTitle}</title>
<style>
  body{margin:0;padding:32px;font-family:ui-sans-serif,-apple-system,"Segoe UI",Arial,sans-serif;color:#001a34;background:#f7f8fa}
  main{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:28px;align-items:start}
  h1{font-size:22px;line-height:1.3;margin:0 0 16px;font-weight:600}
  .gallery{height:420px;border-radius:16px;background:linear-gradient(135deg,#eef2f8,#dfe7f3)}
  .price-card{box-sizing:border-box;width:380px;padding:20px;border:1px solid #eceef2;border-radius:16px;background:#fff;box-shadow:0 4px 18px rgba(0,26,52,.06)}
  [data-widget=webPrice]{margin:0 0 14px}
  .now{display:flex;align-items:baseline;gap:10px}
  .now b{font-size:30px;font-weight:700;letter-spacing:-.5px}
  .old{font-size:16px;color:#9aa3b0;text-decoration:line-through}
  .disc{font-size:15px;font-weight:700;color:#f1117e}
  .ozcard{margin-top:6px;font-size:15px;color:#0b7a3e;font-weight:600}
  .cart{margin-top:16px;width:100%;padding:14px;border:0;border-radius:12px;background:#005bff;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
  .buy{margin-top:10px;width:100%;padding:14px;border:0;border-radius:12px;background:#f0f3f8;color:#001a34;font-size:16px;font-weight:600;cursor:pointer}
  .deliv{margin-top:14px;font-size:14px;color:#53627a}
</style></head><body>
  <script>window.__INITIAL_STATE__=${JSON.stringify({ delivery: { selectedAddress: { deliveryAddressOid: currentPoint.externalLocationId, fullAddress: currentPoint.name }, items: Object.values(points).map((p) => ({ deliveryAddressOid: p.externalLocationId, fullAddress: p.name, title: p.name })) } })};</script>
  <main>
    <section>
      <h1>${productTitle}</h1>
      <div class="gallery"></div>
    </section>
    <aside class="price-card">
      <div data-widget="webPrice">
        <div class="now"><b>${currentPoint.priceText}</b><span class="old">21 200 ₽</span><span class="disc">−15%</span></div>
        <div class="ozcard">17 460 ₽ с Ozon Картой</div>
      </div>
      <button class="cart">Добавить в корзину</button>
      <button class="buy">Купить сейчас</button>
      <div class="deliv">Доставка в Москву · Завтра, бесплатно</div>
    </aside>
  </main>
</body></html>`;
}
