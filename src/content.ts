import { buildComparisonRows, makeErrorResult, makeSuccessResult } from "./shared/comparison";
import { formatCurrency } from "./shared/currency";
import { RuntimeRequest, RuntimeResponse } from "./shared/messages";
import { ComparisonResult, Currency, ExtensionSettings, ManualQuote, PickupPoint, PriceQuote, ProductIdentity } from "./shared/types";
import { manualQuoteKey } from "./shared/settings";
import { createMarketplaceAdapter } from "./marketplaces/registry";
import { fetchOzonPrivatePrice } from "./marketplaces/ozon-private-api";
import {
  extractOzonPickupCandidatesFromSources,
  OzonCaptureSource,
  OzonPickupCandidate
} from "./marketplaces/ozon-pickup-capture";

const PANEL_ID = "markonverter-panel-root";
const MENU_ASSIST_ID = "markonverter-ozon-delivery-assist";
const COLLECT_PICKUP_EVENT = "markonverter:collect-ozon-pickup";
const PICKUP_CANDIDATES_EVENT = "markonverter:ozon-pickup-candidates";

let activeUrl = "";
let activeRun = 0;
let latestPickupCandidates: OzonPickupCandidate[] = [];
let lastPanelModel: PanelModel | null = null;
let captureStatus: { tone: "normal" | "error"; message: string } | null = null;
let isPointManagerOpen = false;

void boot();

async function boot(): Promise<void> {
  document.addEventListener(PICKUP_CANDIDATES_EVENT, handlePickupCandidatesEvent);
  chrome.runtime.onMessage.addListener((request: RuntimeRequest, _sender, sendResponse) => {
    if (request.type !== "SAVE_SELECTED_OZON_PICKUP") {
      return false;
    }
    void saveCurrentSelectedPickupPoint()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies RuntimeResponse);
      });
    return true;
  });
  if (document.readyState === "loading") {
    await new Promise<void>((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
  }
  installOzonDeliveryMenuAssist();
  await runIfProductPage();
  setInterval(() => {
    if (location.href !== activeUrl) {
      void runIfProductPage();
    }
  }, 1000);
}

async function runIfProductPage(): Promise<void> {
  const currentUrl = location.href;
  const runId = ++activeRun;
  const adapter = createMarketplaceAdapter("ozon", { requestOzonPrice });
  const url = new URL(currentUrl);

  if (!adapter.isProductPage(url)) {
    activeUrl = currentUrl;
    removePanel();
    return;
  }

  const product = adapter.getProductIdentity(url, document);
  if (!product) {
    activeUrl = "";
    removePanel();
    return;
  }

  activeUrl = currentUrl;
  const panel = ensurePanel();
  renderPanel(panel, { state: "loading", product });
  requestPagePickupCandidates();

  const settingsResponse = await runtimeRequest({ type: "GET_SETTINGS" });
  if (!settingsResponse.ok || !("settings" in settingsResponse)) {
    renderPanel(panel, { state: "fatal", product, message: settingsResponse.ok ? "Settings are unavailable" : settingsResponse.error });
    return;
  }

  const settings = settingsResponse.settings;
  const allPickupPoints = settings.pickupPoints.filter((point) => point.marketplace === "ozon");
  if (allPickupPoints.length === 0) {
    renderPanel(panel, { state: "empty", product, settings });
    return;
  }

  const pickupPoints = getComparisonPickupPoints(settings, allPickupPoints);
  if (pickupPoints.length === 0) {
    renderPanel(panel, { state: "noSelection", product, settings, allPickupPoints });
    return;
  }

  renderPanel(panel, { state: "loading", product, settings, pickupPoints });
  const results = await Promise.all(
    pickupPoints.map(async (pickupPoint): Promise<ComparisonResult> => {
      try {
        const price = await adapter.fetchPrice(product, pickupPoint, settings);
        return makeSuccessResult(pickupPoint.id, { ...price, source: "api" }, settings.defaultCurrency, settings);
      } catch (error) {
        const manualQuote = settings.manualQuotes[manualQuoteKey(product.productId, pickupPoint.id)];
        if (manualQuote) {
          return makeSuccessResult(
            pickupPoint.id,
            {
              ...manualQuote.quote,
              source: "manual",
              capturedAt: manualQuote.capturedAt
            },
            settings.defaultCurrency,
            settings
          );
        }
        return makeErrorResult(pickupPoint.id, adapter.formatError(error));
      }
    })
  );

  if (runId !== activeRun) {
    return;
  }

  renderPanel(panel, {
    state: "results",
    product,
    settings,
    pickupPoints,
    results
  });
}

function getComparisonPickupPoints(settings: ExtensionSettings, allPickupPoints: PickupPoint[]): PickupPoint[] {
  if (!settings.comparisonPickupPointIds) {
    return allPickupPoints;
  }
  const selectedIds = new Set(settings.comparisonPickupPointIds);
  return allPickupPoints.filter((point) => selectedIds.has(point.id));
}

async function requestOzonPrice(request: {
  productId: string;
  productUrl: string;
  pickupExternalLocationId: string;
  currencyHint: "RUB" | "KZT";
}): Promise<PriceQuote> {
  return fetchOzonPrivatePrice(request);
}

function getCurrentProduct(): ProductIdentity | null {
  const adapter = createMarketplaceAdapter("ozon", { requestOzonPrice });
  const url = new URL(location.href);
  return adapter.isProductPage(url) ? adapter.getProductIdentity(url, document) : null;
}

function handlePickupCandidatesEvent(event: Event): void {
  const detail = (event as CustomEvent<string>).detail;
  if (!detail) {
    return;
  }
  try {
    const candidates = JSON.parse(detail) as OzonPickupCandidate[];
    mergePickupCandidates(candidates);
  } catch {
    // Ignore malformed events from the page world.
  }
}

function mergePickupCandidates(candidates: OzonPickupCandidate[]): void {
  const byId = new Map(latestPickupCandidates.map((candidate) => [candidate.externalLocationId, candidate]));
  for (const candidate of candidates) {
    if (!candidate.externalLocationId || !candidate.name) {
      continue;
    }
    const existing = byId.get(candidate.externalLocationId);
    if (!existing || candidate.score > existing.score) {
      byId.set(candidate.externalLocationId, candidate);
    }
  }
  latestPickupCandidates = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 20);
}

function requestPagePickupCandidates(): void {
  document.dispatchEvent(new CustomEvent(COLLECT_PICKUP_EVENT));
}

async function getBestPickupCandidate(): Promise<OzonPickupCandidate | null> {
  requestPagePickupCandidates();
  mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
  await new Promise((resolve) => setTimeout(resolve, 250));
  mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
  return latestPickupCandidates[0] || null;
}

function collectFallbackCaptureSources(): OzonCaptureSource[] {
  const sources: OzonCaptureSource[] = [];
  const urlHint = location.href;
  collectStorage("localStorage", localStorage, sources, urlHint);
  collectStorage("sessionStorage", sessionStorage, sources, urlHint);
  if (document.cookie) {
    sources.push({ source: "content.cookie", value: document.cookie, urlHint });
  }
  const deliveryText = collectDeliveryText();
  if (deliveryText) {
    sources.push({ source: "content.dom", value: deliveryText, textHint: deliveryText, urlHint });
  }
  return sources;
}

function collectStorage(name: string, storage: Storage, sources: OzonCaptureSource[], urlHint: string): void {
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !/(ozon|delivery|address|pickup|pvz|location|geo|city|region)/i.test(key)) {
        continue;
      }
      const value = storage.getItem(key);
      if (value) {
        sources.push({ source: `content.${name}.${key}`, value, urlHint });
      }
    }
  } catch {
    // Storage access may be unavailable in some browser/privacy modes.
  }
}

function collectDeliveryText(): string {
  const chunks: string[] = [];
  document
    .querySelectorAll<HTMLElement>(
      '[data-widget*="address" i], [data-widget*="delivery" i], [data-widget*="geo" i], [data-widget*="user" i], [href*="delivery" i], button, a'
    )
    .forEach((element) => {
      const text = element.innerText || element.textContent || "";
      if (/(достав|получ|пункт|пвз|адрес|город|pickup|delivery|address)/i.test(text)) {
        chunks.push(text);
      }
    });
  return chunks.slice(0, 30).join(" | ").slice(0, 8000);
}

function extractVisibleOzonPrice(currencyHint: Currency): PriceQuote | null {
  const selectors = ['[data-widget="webPrice"]', '[data-widget*="webPrice" i]', '[data-widget*="price" i]'];
  const seen = new Set<HTMLElement>();
  const candidates: Array<PriceQuote & { score: number }> = [];

  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (seen.has(element) || !isVisibleEnough(element)) {
        return;
      }
      seen.add(element);
      const text = compactText(element.innerText || element.textContent || "");
      if (!text) {
        return;
      }
      candidates.push(...parseVisiblePriceCandidates(text, currencyHint));
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) {
    return null;
  }
  const deliveryText = extractVisibleDeliverySummary();
  return {
    amount: best.amount,
    currency: best.currency,
    rawText: best.rawText,
    ...(deliveryText ? { deliveryText } : {})
  };
}

function parseVisiblePriceCandidates(text: string, currencyHint: Currency): Array<PriceQuote & { score: number }> {
  const candidates: Array<PriceQuote & { score: number }> = [];
  const pricePattern = /(\d[\d\s\u00a0]{1,14}(?:[,.]\d{1,2})?)\s*(₽|руб\.?|рублей|RUB|₸|тг|тенге|KZT)?/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pricePattern.exec(text))) {
    const rawAmount = match[1];
    const amount = Number.parseFloat(rawAmount.replace(/[\s\u00a0]/g, "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
      continue;
    }
    const currency = parseCurrencyMarker(match[2] || text, currencyHint);
    const rawText = match[0].trim();
    candidates.push({
      amount,
      currency,
      rawText,
      score: 100 + (match[2] ? 30 : 0) + (amount >= 100 ? 10 : 0) - index
    });
    index += 1;
  }
  return candidates;
}

function parseCurrencyMarker(value: string, fallback: Currency): Currency {
  if (/₽|руб|RUB/i.test(value)) {
    return "RUB";
  }
  if (/₸|тг|тенге|KZT/i.test(value)) {
    return "KZT";
  }
  return fallback;
}

function extractVisibleDeliverySummary(): string | null {
  const selectors = ['[data-widget*="delivery" i]', '[data-widget*="address" i]'];
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (!isVisibleEnough(element)) {
        continue;
      }
      const text = compactText(element.innerText || element.textContent || "");
      if (text && text.length <= 160 && /(сегодня|завтра|достав|получ|today|tomorrow|delivery|\d)/i.test(text)) {
        return text;
      }
    }
  }
  return null;
}

function isVisibleEnough(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 20 && rect.height > 8 && rect.bottom > 0 && rect.right > 0;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function saveCurrentSelectedPickupPoint(): Promise<RuntimeResponse> {
  const product = getCurrentProduct();
  if (!product) {
    return { ok: false, error: "Open an Ozon product page to save the selected pickup point" };
  }
  return saveSelectedPickupPoint(product);
}

async function saveSelectedPickupPoint(product: ProductIdentity): Promise<RuntimeResponse> {
  captureStatus = { tone: "normal", message: "Detecting selected Ozon pickup point..." };
  renderLastPanel();

  const candidate = await getBestPickupCandidate();
  if (!candidate) {
    captureStatus = {
      tone: "error",
      message: "Could not detect the selected point yet. Select it in Ozon, wait for the page to update, then try again."
    };
    renderLastPanel();
    return { ok: false, error: captureStatus.message };
  }

  const response = await savePickupCandidate(candidate, product);
  if (!response.ok || !("settings" in response)) {
    captureStatus = { tone: "error", message: response.ok ? "Pickup point was not saved" : response.error };
    renderLastPanel();
    return { ok: false, error: captureStatus.message };
  }

  const savedPoint = response.settings.pickupPoints.find(
    (point) => point.marketplace === "ozon" && point.externalLocationId === candidate.externalLocationId
  );
  const quoteCaptured = savedPoint ? await saveCurrentVisibleQuoteForPoint(savedPoint, product, { requireConfirmation: false }) : false;
  captureStatus = {
    tone: "normal",
    message: quoteCaptured ? `Saved and captured current price: ${candidate.name}` : `Saved: ${candidate.name}`
  };
  await runIfProductPage();
  return response;
}

async function savePickupCandidate(candidate: OzonPickupCandidate, product: ProductIdentity): Promise<RuntimeResponse> {
  const pickupPoint: PickupPoint = {
    id: crypto.randomUUID(),
    name: candidate.name,
    marketplace: "ozon",
    country: candidate.country,
    currency: candidate.currency,
    externalLocationId: candidate.externalLocationId,
    comment: candidate.comment || `Captured from ${product.url}`
  };

  return runtimeRequest({ type: "UPSERT_PICKUP_POINT", pickupPoint });
}

async function captureCurrentPriceForPickupPoint(pickupPoint: PickupPoint, product: ProductIdentity): Promise<void> {
  const saved = await saveCurrentVisibleQuoteForPoint(pickupPoint, product, { requireConfirmation: true });
  if (saved) {
    captureStatus = { tone: "normal", message: `Captured current page price for ${pickupPoint.name}` };
    await runIfProductPage();
  } else {
    renderLastPanel();
  }
}

async function saveCurrentVisibleQuoteForPoint(
  pickupPoint: PickupPoint,
  product: ProductIdentity,
  options: { requireConfirmation: boolean }
): Promise<boolean> {
  if (options.requireConfirmation) {
    const currentCandidate = await getBestPickupCandidate();
    if (currentCandidate && currentCandidate.externalLocationId !== pickupPoint.externalLocationId) {
      const shouldContinue = window.confirm(
        `The currently detected Ozon point looks like "${currentCandidate.name}", not "${pickupPoint.name}". Capture the visible page price for "${pickupPoint.name}" anyway?`
      );
      if (!shouldContinue) {
        captureStatus = { tone: "normal", message: "Price capture cancelled" };
        return false;
      }
    } else if (!currentCandidate) {
      const shouldContinue = window.confirm(
        `I could not verify the selected Ozon point. Capture the visible page price for "${pickupPoint.name}" anyway?`
      );
      if (!shouldContinue) {
        captureStatus = { tone: "normal", message: "Price capture cancelled" };
        return false;
      }
    }
  }

  const quote = extractVisibleOzonPrice(pickupPoint.currency);
  if (!quote) {
    captureStatus = { tone: "error", message: "Could not find a visible product price on the current Ozon page." };
    return false;
  }

  const capturedAt = new Date().toISOString();
  const manualQuote: ManualQuote = {
    productId: product.productId,
    productUrl: product.url,
    pickupPointId: pickupPoint.id,
    quote: {
      ...quote,
      source: "manual",
      capturedAt
    },
    capturedAt
  };
  const response = await runtimeRequest({ type: "SAVE_MANUAL_QUOTE", manualQuote });
  if (!response.ok || !("settings" in response)) {
    captureStatus = { tone: "error", message: response.ok ? "Captured price was not saved" : response.error };
    return false;
  }
  return true;
}

async function deleteSavedPickupPoint(pickupPoint: PickupPoint, product: ProductIdentity): Promise<void> {
  if (!window.confirm(`Delete "${pickupPoint.name}" from saved pickup points?`)) {
    return;
  }

  captureStatus = { tone: "normal", message: `Deleted: ${pickupPoint.name}` };
  const response = await runtimeRequest({ type: "DELETE_PICKUP_POINT", pickupPointId: pickupPoint.id });
  if (!response.ok || !("settings" in response)) {
    captureStatus = { tone: "error", message: response.ok ? "Pickup point was not deleted" : response.error };
    renderLastPanel();
    return;
  }
  await runIfProductPage();
  if (getCurrentProduct()?.productId === product.productId) {
    renderLastPanel();
  }
}

async function toggleComparisonPoint(
  pickupPointId: string,
  isSelected: boolean,
  settings: ExtensionSettings,
  product: ProductIdentity
): Promise<void> {
  const allIds = settings.pickupPoints.filter((point) => point.marketplace === "ozon").map((point) => point.id);
  const selected = new Set(settings.comparisonPickupPointIds ?? allIds);
  if (isSelected) {
    selected.add(pickupPointId);
  } else {
    selected.delete(pickupPointId);
  }

  const nextIds = allIds.filter((id) => selected.has(id));
  await updateComparisonSelection(nextIds.length === allIds.length ? null : nextIds, product);
}

async function updateComparisonSelection(pickupPointIds: string[] | null, product: ProductIdentity): Promise<void> {
  captureStatus = { tone: "normal", message: pickupPointIds === null ? "Comparing all saved points" : "Comparison points updated" };
  const response = await runtimeRequest({ type: "SET_COMPARISON_PICKUP_POINT_IDS", pickupPointIds });
  if (!response.ok || !("settings" in response)) {
    captureStatus = { tone: "error", message: response.ok ? "Comparison selection was not saved" : response.error };
    renderLastPanel();
    return;
  }
  await runIfProductPage();
  if (getCurrentProduct()?.productId === product.productId) {
    renderLastPanel();
  }
}

function ensurePanel(): ShadowRoot {
  const existing = document.getElementById(PANEL_ID);
  if (existing?.shadowRoot) {
    return existing.shadowRoot;
  }

  const host = document.createElement("aside");
  host.id = PANEL_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const anchor =
    document.querySelector('[data-widget="webPrice"]') ||
    document.querySelector('[data-widget*="price" i]') ||
    document.querySelector("h1")?.parentElement;

  if (anchor?.parentElement) {
    anchor.parentElement.insertBefore(host, anchor.nextSibling);
  } else {
    document.documentElement.append(host);
  }
  return shadow;
}

function removePanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}

function installOzonDeliveryMenuAssist(): void {
  const sync = () => {
    if (!getCurrentProduct()) {
      document.getElementById(MENU_ASSIST_ID)?.remove();
      return;
    }
    ensureOzonDeliveryMenuAssist();
  };

  sync();
  new MutationObserver(sync).observe(document.body, {
    childList: true,
    subtree: true
  });
  setInterval(sync, 1500);
}

function ensureOzonDeliveryMenuAssist(): void {
  const target = findOzonDeliveryContainer();
  const existing = document.getElementById(MENU_ASSIST_ID);
  if (!target) {
    existing?.remove();
    return;
  }
  if (existing && existing.parentElement === target) {
    return;
  }

  existing?.remove();
  const product = getCurrentProduct();
  if (!product) {
    return;
  }

  const assist = document.createElement("div");
  assist.id = MENU_ASSIST_ID;
  assist.setAttribute(
    "style",
    [
      "display:flex",
      "align-items:center",
      "gap:8px",
      "margin:8px 0",
      "padding:8px",
      "border:1px solid #2a2a2c",
      "border-radius:10px",
      "background:#141414",
      "box-shadow:0 12px 30px rgba(0,0,0,.34)",
      "font:13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "color:#fafafa",
      "z-index:2147483647"
    ].join(";")
  );

  const saveButton = pageButton("Save to Markonverter");
  saveButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void saveSelectedPickupPoint(product);
  });

  const showButton = pageButton("Show detected PVZ");
  showButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    isPointManagerOpen = true;
    requestPagePickupCandidates();
    renderLastPanel();
    document.getElementById(PANEL_ID)?.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  assist.append(saveButton, showButton);
  target.prepend(assist);
}

function findOzonDeliveryContainer(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"], [data-widget*="delivery" i], [data-widget*="address" i], [data-widget*="geo" i]')
  );
  return (
    candidates.find((element) => {
      if (element.id === PANEL_ID || element.closest(`#${PANEL_ID}`) || element.id === MENU_ASSIST_ID) {
        return false;
      }
      if (!isVisible(element)) {
        return false;
      }
      const text = (element.innerText || element.textContent || "").slice(0, 3000);
      return /(пункт|пвз|получ|достав|адрес|город|pickup|delivery|address)/i.test(text);
    }) || null
  );
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 120 && rect.height > 40 && rect.bottom > 0 && rect.right > 0;
}

function pageButton(text: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.setAttribute(
    "style",
    [
      "min-height:32px",
      "padding:0 10px",
      "border:1px solid #f59e0b",
      "border-radius:8px",
      "background:#f59e0b",
      "color:#111",
      "cursor:pointer",
      "font:inherit",
      "font-weight:700",
      "white-space:nowrap"
    ].join(";")
  );
  return button;
}

type PanelModel =
  | { state: "loading"; product: ProductIdentity; settings?: ExtensionSettings; pickupPoints?: PickupPoint[] }
  | { state: "empty"; product: ProductIdentity; settings: ExtensionSettings }
  | { state: "noSelection"; product: ProductIdentity; settings: ExtensionSettings; allPickupPoints: PickupPoint[] }
  | { state: "fatal"; product: ProductIdentity; message: string }
  | {
      state: "results";
      product: ProductIdentity;
      settings: ExtensionSettings;
      pickupPoints: PickupPoint[];
      results: ComparisonResult[];
    };

function renderPanel(shadow: ShadowRoot, model: PanelModel): void {
  lastPanelModel = model;
  shadow.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = panelCss();
  shadow.append(style);

  const root = document.createElement("section");
  root.className = "panel";
  if (!document.body.contains(shadow.host)) {
    root.classList.add("floating");
  }

  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `<div class="headerTitle"><span class="eyebrow">Markonverter</span><strong>Pickup prices</strong><span>${escapeHtml(model.product.title || "Ozon product")}</span></div>`;

  const headerActions = document.createElement("div");
  headerActions.className = "headerActions";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "saveHeaderButton";
  saveButton.title = "Save selected Ozon pickup point";
  saveButton.textContent = "Save point";
  saveButton.addEventListener("click", () => {
    void saveSelectedPickupPoint(model.product);
  });

  const pointsButton = document.createElement("button");
  pointsButton.type = "button";
  pointsButton.className = "secondaryButton";
  pointsButton.title = "Choose saved pickup points";
  pointsButton.textContent = "Points";
  pointsButton.addEventListener("click", () => {
    isPointManagerOpen = !isPointManagerOpen;
    renderLastPanel();
  });

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "iconButton";
  settingsButton.title = "Settings";
  settingsButton.textContent = "Options";
  settingsButton.addEventListener("click", () => {
    openOptionsPage();
  });
  headerActions.append(saveButton, pointsButton, settingsButton);
  header.append(headerActions);
  root.append(header);

  if (model.state === "loading") {
    root.append(messageNode(`Checking ${model.pickupPoints?.length || "configured"} pickup points...`));
    if (captureStatus) {
      root.append(messageNode(captureStatus.message, captureStatus.tone));
    }
  } else if (model.state === "empty") {
    root.append(messageNode("No Ozon pickup points configured."));
    root.append(captureControl(model.product));
    if (isPointManagerOpen || latestPickupCandidates.length > 0) {
      root.append(pointManager(model.settings, [], model.product));
    }
  } else if (model.state === "noSelection") {
    root.append(messageNode("No saved pickup points selected for comparison."));
    root.append(pointManager(model.settings, model.allPickupPoints, model.product));
  } else if (model.state === "fatal") {
    root.append(messageNode(model.message, "error"));
  } else {
    if (isPointManagerOpen) {
      root.append(pointManager(model.settings, model.pickupPoints, model.product));
    }
    const rows = buildComparisonRows(model.pickupPoints, model.results);
    const list = document.createElement("div");
    list.className = "rows";

    for (const row of rows) {
      const item = document.createElement("div");
      item.className = `row${row.isCheapest ? " cheapest" : ""}${row.result.status === "error" ? " failed" : ""}`;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = `<strong>${escapeHtml(row.pickupPoint.name)}</strong><span class="locationMeta">${escapeHtml(row.pickupPoint.country)} / ${escapeHtml(row.pickupPoint.currency)}</span>`;

      const rowActions = document.createElement("div");
      rowActions.className = "rowActions";
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "deleteButton";
      deleteButton.textContent = "Delete";
      deleteButton.title = "Delete saved pickup point";
      deleteButton.addEventListener("click", () => {
        void deleteSavedPickupPoint(row.pickupPoint, model.product);
      });
      rowActions.append(deleteButton);
      meta.append(rowActions);

      const value = document.createElement("div");
      value.className = "value";
      if (row.result.status === "success") {
        const original = formatCurrency(row.result.originalPrice.amount, row.result.originalPrice.currency);
        const converted = formatCurrency(row.result.convertedAmount, row.result.convertedCurrency);
        const delivery = row.result.originalPrice.deliveryText;
        const manualLabel =
          row.result.originalPrice.source === "manual"
            ? `Captured ${formatCapturedAt(row.result.originalPrice.capturedAt)}`
            : "";
        const delta =
          row.deltaFromCheapest && row.deltaFromCheapest > 0
            ? `+${formatCurrency(row.deltaFromCheapest, row.result.convertedCurrency)}`
            : row.isCheapest
              ? "best"
              : "";
        value.innerHTML = `<strong>${converted}</strong><span class="original">${escapeHtml(original)} ${escapeHtml(delta)}</span>${
          delivery ? `<span>${escapeHtml(delivery)}</span>` : ""
        }${manualLabel ? `<span>${escapeHtml(manualLabel)}</span>` : ""}`;
      } else {
        const error = row.result.error;
        value.title = error;
        const unavailable = document.createElement("strong");
        unavailable.textContent = "Unavailable";
        const reason = document.createElement("span");
        reason.textContent = readableResultError(error);
        const actions = document.createElement("div");
        actions.className = "failureActions";
        const captureButton = document.createElement("button");
        captureButton.type = "button";
        captureButton.className = "saveSmallButton";
        captureButton.textContent = "Capture current";
        captureButton.title = "After selecting this pickup point in Ozon, capture the visible page price for this product.";
        captureButton.addEventListener("click", () => {
          void captureCurrentPriceForPickupPoint(row.pickupPoint, model.product);
        });
        const detailsButton = document.createElement("button");
        detailsButton.type = "button";
        detailsButton.className = "detailsButton";
        detailsButton.textContent = "Copy details";
        detailsButton.title = "Copy technical details for debugging this pickup point.";
        detailsButton.addEventListener("click", () => {
          void copyFailureDiagnostics(row.pickupPoint, error, model.product);
        });
        actions.append(captureButton, detailsButton);
        value.append(unavailable, reason, actions);
      }

      item.append(meta, value);
      list.append(item);
    }
    root.append(list);
    root.append(captureControl(model.product));
  }

  shadow.append(root);
}

function renderLastPanel(): void {
  if (lastPanelModel) {
    renderPanel(ensurePanel(), lastPanelModel);
  }
}

function pointManager(settings: ExtensionSettings, visiblePickupPoints: PickupPoint[], product: ProductIdentity): HTMLElement {
  const allPickupPoints = settings.pickupPoints.filter((point) => point.marketplace === "ozon");
  const selectedIds = settings.comparisonPickupPointIds ? new Set(settings.comparisonPickupPointIds) : null;
  const savedExternalIds = new Set(allPickupPoints.map((point) => point.externalLocationId));

  const wrapper = document.createElement("div");
  wrapper.className = "pointManager";

  const top = document.createElement("div");
  top.className = "pointManagerTop";
  top.innerHTML = `<div><span class="eyebrow">Points</span><strong>Saved in Markonverter</strong></div><span>${allPickupPoints.length} total</span>`;

  const controls = document.createElement("div");
  controls.className = "pointManagerControls";
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.textContent = "All";
  allButton.addEventListener("click", () => {
    void updateComparisonSelection(null, product);
  });
  const noneButton = document.createElement("button");
  noneButton.type = "button";
  noneButton.textContent = "None";
  noneButton.addEventListener("click", () => {
    void updateComparisonSelection([], product);
  });
  controls.append(allButton, noneButton);
  top.append(controls);
  wrapper.append(top);

  const points = visiblePickupPoints.length === allPickupPoints.length ? visiblePickupPoints : allPickupPoints;
  if (points.length === 0) {
    const empty = document.createElement("p");
    empty.className = "pointManagerHint";
    empty.textContent = "No saved Markonverter points yet.";
    wrapper.append(empty);
  }

  for (const point of points) {
    const row = document.createElement("label");
    row.className = "pointChoice";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIds ? selectedIds.has(point.id) : true;
    checkbox.addEventListener("change", () => {
      void toggleComparisonPoint(point.id, checkbox.checked, settings, product);
    });

    const label = document.createElement("span");
    label.className = "pointChoiceText";
    label.innerHTML = `<strong>${escapeHtml(point.name)}</strong><span>${escapeHtml(point.country)} / ${escapeHtml(point.currency)}</span>`;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "deleteButton";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      void deleteSavedPickupPoint(point, product);
    });

    row.append(checkbox, label, deleteButton);
    wrapper.append(row);
  }

  const detected = latestPickupCandidates.slice(0, 8);
  const detectedHeader = document.createElement("div");
  detectedHeader.className = "pointManagerTop detectedHeader";
  detectedHeader.innerHTML = `<div><span class="eyebrow">Ozon page</span><strong>Detected on Ozon</strong></div><span>${detected.length} found</span>`;
  wrapper.append(detectedHeader);

  if (detected.length === 0) {
    const hint = document.createElement("p");
    hint.className = "pointManagerHint";
    hint.textContent = "Open Ozon delivery selection, then choose or view a point so Markonverter can detect it.";
    wrapper.append(hint);
  }

  for (const candidate of detected) {
    const row = document.createElement("div");
    row.className = "pointChoice detectedChoice";

    const text = document.createElement("span");
    text.className = "pointChoiceText";
    const alreadySaved = savedExternalIds.has(candidate.externalLocationId);
    text.innerHTML = `<strong>${escapeHtml(candidate.name)}</strong><span>${escapeHtml(candidate.country)} / ${escapeHtml(candidate.currency)}${
      alreadySaved ? " - saved" : ""
    }</span>`;

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "saveSmallButton";
    saveButton.textContent = alreadySaved ? "Saved" : "Save";
    saveButton.disabled = alreadySaved;
    saveButton.addEventListener("click", () => {
      void saveDetectedPickupCandidate(candidate, product);
    });

    row.append(text, saveButton);
    wrapper.append(row);
  }

  return wrapper;
}

async function saveDetectedPickupCandidate(candidate: OzonPickupCandidate, product: ProductIdentity): Promise<void> {
  captureStatus = { tone: "normal", message: `Saving: ${candidate.name}` };
  renderLastPanel();

  const response = await savePickupCandidate(candidate, product);
  if (!response.ok || !("settings" in response)) {
    captureStatus = { tone: "error", message: response.ok ? "Pickup point was not saved" : response.error };
    renderLastPanel();
    return;
  }

  captureStatus = { tone: "normal", message: `Saved: ${candidate.name}` };
  await runIfProductPage();
}

function captureControl(product: ProductIdentity): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "capture";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "captureButton";
  button.textContent = "Save selected point";
  button.addEventListener("click", () => {
    void saveSelectedPickupPoint(product);
  });

  const hint = document.createElement("span");
  hint.textContent = "Select a pickup point in Ozon, then save it here.";

  wrapper.append(button, hint);
  if (captureStatus) {
    wrapper.append(messageNode(captureStatus.message, captureStatus.tone));
  }
  return wrapper;
}

function messageNode(text: string, tone: "normal" | "error" = "normal"): HTMLElement {
  const node = document.createElement("p");
  node.className = `message ${tone}`;
  node.textContent = text;
  return node;
}

function openOptionsPage(): void {
  void runtimeRequest({ type: "OPEN_OPTIONS" })
    .then((response) => {
      if (!response.ok) {
        window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener");
      }
    })
    .catch(() => {
      window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener");
    });
}

function readableResultError(error: string): string {
  if (error.includes("response did not confirm requested pickup point")) {
    return "Ozon did not confirm this pickup point, so the current address may have been reused.";
  }
  return error.length > 150 ? `${error.slice(0, 147)}...` : error;
}

function formatCapturedAt(value: string | undefined): string {
  if (!value) {
    return "from page";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "from page";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function copyFailureDiagnostics(pickupPoint: PickupPoint, error: string, product: ProductIdentity): Promise<void> {
  const diagnostics = {
    product,
    pickupPoint: {
      id: pickupPoint.id,
      name: pickupPoint.name,
      country: pickupPoint.country,
      currency: pickupPoint.currency,
      externalLocationId: pickupPoint.externalLocationId,
      comment: pickupPoint.comment
    },
    error,
    detectedPickupCandidates: latestPickupCandidates.slice(0, 5).map((candidate) => ({
      externalLocationId: candidate.externalLocationId,
      name: candidate.name,
      country: candidate.country,
      currency: candidate.currency,
      source: candidate.source,
      score: candidate.score,
      comment: candidate.comment
    })),
    pageUrl: location.href,
    copiedAt: new Date().toISOString()
  };

  try {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    captureStatus = { tone: "normal", message: "Copied pickup-point diagnostics" };
  } catch {
    captureStatus = { tone: "error", message: "Could not copy diagnostics. Browser clipboard access is blocked." };
  }
  renderLastPanel();
}

async function runtimeRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(request);
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function panelCss(): string {
  return `
    :host {
      color-scheme: dark;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      --mk-bg: #0c0c0c;
      --mk-surface: #141414;
      --mk-surface-2: #1b1b1c;
      --mk-surface-3: #202022;
      --mk-border: #2a2a2c;
      --mk-border-strong: #3f3f46;
      --mk-text: #fafafa;
      --mk-muted: #a1a1aa;
      --mk-quiet: #71717a;
      --mk-accent: #f59e0b;
      --mk-accent-strong: #fbbf24;
      --mk-success: #22c55e;
      --mk-danger: #ef4444;
      --mk-info: #3b82f6;
    }
    * {
      box-sizing: border-box;
    }
    .panel {
      width: min(398px, calc(100vw - 24px));
      margin: 12px 0;
      border: 1px solid var(--mk-border);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.028), rgba(255, 255, 255, 0.01)), var(--mk-surface);
      box-shadow: 0 22px 48px rgba(0, 0, 0, 0.34);
      overflow: hidden;
      font-size: 13px;
      line-height: 1.35;
      z-index: 2147483647;
      color: var(--mk-text);
    }
    .floating {
      position: fixed;
      top: 84px;
      right: 16px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px;
      border-bottom: 1px solid var(--mk-border);
      background:
        radial-gradient(circle at top left, rgba(245, 158, 11, 0.12), transparent 240px),
        #111111;
    }
    .headerTitle {
      min-width: 0;
    }
    .eyebrow {
      display: block;
      margin: 0 0 5px;
      color: var(--mk-accent-strong);
      font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      text-transform: uppercase;
    }
    .header strong,
    .meta strong,
    .value strong {
      display: block;
      color: var(--mk-text);
      font-size: 13px;
      font-weight: 760;
    }
    .header span,
    .meta span,
    .value span {
      display: block;
      margin-top: 2px;
      color: var(--mk-muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .headerTitle > span:last-child {
      max-width: 210px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .header .eyebrow,
    .pointManagerTop .eyebrow {
      margin: 0 0 5px;
      color: var(--mk-accent-strong);
      font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      text-transform: uppercase;
    }
    .headerActions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .saveHeaderButton,
    .secondaryButton,
    .iconButton {
      min-height: 32px;
      padding: 0 10px;
      border: 1px solid var(--mk-accent);
      border-radius: 8px;
      background: var(--mk-accent);
      color: #111111;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 750;
      white-space: nowrap;
      transition:
        transform 100ms ease,
        border-color 150ms ease,
        background 150ms ease;
    }
    button:hover:not(:disabled) {
      border-color: var(--mk-accent-strong);
    }
    button:active:not(:disabled) {
      transform: translateY(1px);
    }
    .secondaryButton {
      border-color: var(--mk-border-strong);
      background: var(--mk-surface-2);
      color: var(--mk-text);
    }
    .iconButton {
      border: 1px solid var(--mk-border-strong);
      background: var(--mk-surface-2);
      color: var(--mk-muted);
      cursor: pointer;
    }
    .message {
      margin: 0;
      padding: 12px 14px;
      color: var(--mk-muted);
      overflow-wrap: anywhere;
    }
    .message.error {
      color: #fca5a5;
    }
    .capture {
      display: grid;
      gap: 7px;
      padding: 12px 14px;
      border-top: 1px solid var(--mk-border);
      background: rgba(255, 255, 255, 0.02);
    }
    .capture > span {
      color: var(--mk-muted);
      font-size: 12px;
    }
    .capture .message {
      padding: 0;
      font-size: 12px;
    }
    .captureButton {
      min-height: 34px;
      border: 1px solid var(--mk-accent);
      border-radius: 8px;
      background: var(--mk-accent);
      color: #111111;
      font: inherit;
      font-weight: 750;
      cursor: pointer;
    }
    .pointManager {
      display: grid;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--mk-border);
      background: #101011;
    }
    .pointManagerTop,
    .pointChoice {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .pointManagerTop {
      justify-content: space-between;
    }
    .detectedHeader {
      margin-top: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--mk-border);
    }
    .pointManagerTop strong,
    .pointChoiceText strong {
      color: var(--mk-text);
      font-size: 12px;
      font-weight: 730;
    }
    .pointManagerTop span,
    .pointChoiceText span {
      display: block;
      color: var(--mk-muted);
      font-size: 11px;
    }
    .pointManagerControls {
      display: flex;
      gap: 6px;
    }
    .pointManagerControls button,
    .deleteButton,
    .saveSmallButton,
    .detailsButton {
      min-height: 28px;
      padding: 0 8px;
      border: 1px solid var(--mk-border-strong);
      border-radius: 8px;
      background: var(--mk-surface-2);
      color: var(--mk-text);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .pointChoice {
      min-height: 32px;
    }
    .pointChoice input {
      width: 16px;
      height: 16px;
      margin: 0;
      flex: 0 0 auto;
      accent-color: var(--mk-accent);
    }
    .pointChoiceText {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .rowActions {
      margin-top: 7px;
    }
    .rowActions .deleteButton {
      min-height: 24px;
      padding: 0 7px;
      font-size: 11px;
    }
    .deleteButton {
      border-color: rgba(239, 68, 68, 0.4);
      color: #fca5a5;
    }
    .saveSmallButton {
      border-color: rgba(245, 158, 11, 0.72);
      color: var(--mk-accent-strong);
    }
    .detailsButton {
      border-color: var(--mk-border-strong);
      color: var(--mk-muted);
    }
    .saveSmallButton:disabled {
      border-color: var(--mk-border);
      color: var(--mk-quiet);
      cursor: default;
    }
    .pointManagerHint {
      margin: 0;
      color: var(--mk-muted);
      font-size: 12px;
    }
    .rows {
      display: grid;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
      padding: 12px 14px;
      border-top: 1px solid var(--mk-border);
      background: transparent;
    }
    .row:first-child {
      border-top: 0;
    }
    .row.cheapest {
      background: linear-gradient(90deg, rgba(34, 197, 94, 0.14), rgba(34, 197, 94, 0.03));
      box-shadow: inset 3px 0 0 var(--mk-success);
    }
    .row.failed {
      background: linear-gradient(90deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.03));
    }
    .value {
      text-align: right;
      max-width: 168px;
    }
    .value strong {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 14px;
      letter-spacing: 0;
    }
    .value .original,
    .locationMeta {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .row.failed .value {
      max-width: 190px;
    }
    .failureActions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    @media (max-width: 430px) {
      .panel {
        width: calc(100vw - 18px);
      }
      .header {
        align-items: flex-start;
        flex-direction: column;
      }
      .headerTitle > span:last-child {
        max-width: 100%;
      }
      .headerActions {
        width: 100%;
        justify-content: flex-start;
      }
      .pointManagerTop {
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .pointManagerControls {
        flex-wrap: wrap;
      }
      .pointChoice {
        align-items: flex-start;
      }
      .row {
        grid-template-columns: 1fr;
      }
      .value {
        max-width: none;
        text-align: left;
      }
      .failureActions {
        justify-content: flex-start;
      }
    }
  `;
}
