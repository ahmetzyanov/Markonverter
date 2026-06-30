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
const MENU_ASSIST_STYLE_ID = "markonverter-ozon-delivery-assist-style";
const COLLECT_PICKUP_EVENT = "markonverter:collect-ozon-pickup";
const PICKUP_CANDIDATES_EVENT = "markonverter:ozon-pickup-candidates";
const PANEL_STATE_KEY = "markonverter.panelState";

let activeUrl = "";
let activeRun = 0;
let latestPickupCandidates: OzonPickupCandidate[] = [];
let latestSettings: ExtensionSettings | null = null;
let settingsLoadPromise: Promise<ExtensionSettings | null> | null = null;
let pickupApiDiscoveryKey = "";
let pickupApiDiscoveryPromise: Promise<void> | null = null;
let lastPanelModel: PanelModel | null = null;
let captureStatus: { tone: "normal" | "error"; message: string } | null = null;
let isPanelCollapsed = false;
let panelRecoveryTimer: number | null = null;
let assistSyncTimer: number | null = null;
let suppressAssistObserverUntil = 0;

void boot();

async function boot(): Promise<void> {
  document.addEventListener(PICKUP_CANDIDATES_EVENT, handlePickupCandidatesEvent);
  if (document.readyState === "loading") {
    await new Promise<void>((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
  }
  await loadPanelState();
  installOzonDeliveryMenuAssist();
  installPanelRecovery();
  await runIfProductPage();
  setInterval(() => {
    if (location.href !== activeUrl || shouldRestoreProductPanel()) {
      void runIfProductPage();
    }
  }, 1000);
}

function installPanelRecovery(): void {
  const observer = new MutationObserver(schedulePanelRecovery);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function schedulePanelRecovery(): void {
  if (panelRecoveryTimer !== null) {
    return;
  }
  panelRecoveryTimer = window.setTimeout(() => {
    panelRecoveryTimer = null;
    if (shouldRestoreProductPanel()) {
      void runIfProductPage();
    }
  }, 100);
}

function shouldRestoreProductPanel(): boolean {
  if (document.getElementById(PANEL_ID)) {
    return false;
  }
  try {
    const adapter = createMarketplaceAdapter("ozon", { requestOzonPrice });
    return adapter.isProductPage(new URL(location.href));
  } catch {
    return false;
  }
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
  discoverOzonPickupCandidatesFromApi(product);
  if (isPanelCollapsed) {
    return;
  }

  const settingsResponse = await runtimeRequest({ type: "GET_SETTINGS" });
  if (!settingsResponse.ok || !("settings" in settingsResponse)) {
    renderPanel(panel, { state: "fatal", product, message: settingsResponse.ok ? "Settings are unavailable" : settingsResponse.error });
    return;
  }

  const settings = settingsResponse.settings;
  latestSettings = settings;
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
    if (mergePickupCandidates(candidates)) {
      renderLastPanel();
      scheduleOzonDeliveryAssistSync();
    }
  } catch {
    // Ignore malformed events from the page world.
  }
}

function mergePickupCandidates(candidates: OzonPickupCandidate[]): boolean {
  const previousKey = pickupCandidateListKey(latestPickupCandidates);
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
  return pickupCandidateListKey(latestPickupCandidates) !== previousKey;
}

function pickupCandidateListKey(candidates: OzonPickupCandidate[]): string {
  return candidates.map((candidate) => `${candidate.externalLocationId}:${candidate.name}:${candidate.score}`).join("|");
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

function discoverOzonPickupCandidatesFromApi(product: ProductIdentity): void {
  const key = `${location.origin}:${product.productId}:${location.pathname}`;
  if (pickupApiDiscoveryKey === key && pickupApiDiscoveryPromise) {
    return;
  }
  pickupApiDiscoveryKey = key;
  pickupApiDiscoveryPromise = fetchOzonPickupCandidatesFromApi(product)
    .then((candidates) => {
      if (candidates.length > 0 && mergePickupCandidates(candidates)) {
        renderLastPanel();
        scheduleOzonDeliveryAssistSync();
      }
    })
    .catch(() => undefined)
    .finally(() => {
      pickupApiDiscoveryPromise = null;
    });
}

async function fetchOzonPickupCandidatesFromApi(product: ProductIdentity): Promise<OzonPickupCandidate[]> {
  const sources: OzonCaptureSource[] = [];
  const textHint = collectDeliveryText();
  const endpoints = buildOzonPickupDiscoveryEndpoints(product);

  await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        const response = await fetch(endpoint.url, {
          method: endpoint.method,
          credentials: "include",
          headers: endpoint.headers,
          body: endpoint.body
        });
        if (!response.ok) {
          return;
        }
        const text = await response.text();
        if (!text || text.length > 4_000_000) {
          return;
        }
        sources.push({
          source: `api.${endpoint.label}`,
          value: text,
          urlHint: location.href,
          textHint
        });
      } catch {
        // Ozon private endpoints are best-effort discovery only.
      }
    })
  );

  return extractOzonPickupCandidatesFromSources(sources);
}

function buildOzonPickupDiscoveryEndpoints(product: ProductIdentity): Array<{
  label: string;
  url: string;
  method: "GET" | "POST";
  headers: HeadersInit;
  body?: string;
}> {
  const headers = {
    "content-type": "application/json",
    "x-o3-app-name": "dweb_client",
    "x-o3-app-version": "release"
  };
  const productUrl = new URL(product.url);
  const productPath = `${productUrl.pathname}${productUrl.search}`;
  const modalPaths = [
    "/modal/addressbook",
    "/modal/addressbook?select_address=",
    "/modal/delivery",
    "/modal/geo"
  ];
  const endpoints: Array<{
    label: string;
    url: string;
    method: "GET" | "POST";
    headers: HeadersInit;
    body?: string;
  }> = [];

  for (const modalPath of modalPaths) {
    const encodedModalPath = encodeURIComponent(modalPath);
    endpoints.push(
      {
        label: `composer-addressbook-${modalPath}`,
        method: "GET",
        url: `/api/composer-api.bx/page/json/v2?url=${encodedModalPath}`,
        headers
      },
      {
        label: `entrypoint-addressbook-${modalPath}`,
        method: "GET",
        url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedModalPath}`,
        headers
      },
      {
        label: `composer-post-addressbook-${modalPath}`,
        method: "POST",
        url: "/api/composer-api.bx/page/json/v2",
        headers,
        body: JSON.stringify({
          url: modalPath,
          referer: productPath
        })
      }
    );
  }

  return endpoints;
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

async function saveSelectedPickupPoint(product: ProductIdentity): Promise<RuntimeResponse> {
  captureStatus = { tone: "normal", message: "Checking Ozon pickup point..." };
  renderLastPanel();

  const candidate = await getBestPickupCandidate();
  if (!candidate) {
    captureStatus = {
      tone: "error",
      message: "No Ozon pickup point is available to save yet."
    };
    renderLastPanel();
    return { ok: false, error: captureStatus.message };
  }
  if (isPickupCandidateSaved(candidate, latestSettings)) {
    captureStatus = { tone: "normal", message: `Already saved: ${candidate.name}` };
    renderLastPanel();
    return { ok: true };
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

  const response = await runtimeRequest({ type: "UPSERT_PICKUP_POINT", pickupPoint });
  if (response.ok && "settings" in response) {
    latestSettings = response.settings;
    markSavedPickupCandidateInPage(candidate);
    scheduleOzonDeliveryAssistSync();
  }
  return response;
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
  latestSettings = response.settings;
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
  latestSettings = response.settings;
  scheduleOzonDeliveryAssistSync();
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
  latestSettings = response.settings;
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
    if (Date.now() < suppressAssistObserverUntil) {
      return;
    }
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

function scheduleOzonDeliveryAssistSync(): void {
  if (assistSyncTimer !== null) {
    return;
  }
  assistSyncTimer = window.setTimeout(() => {
    assistSyncTimer = null;
    if (getCurrentProduct()) {
      ensureOzonDeliveryMenuAssist();
    }
  }, 100);
}

async function syncCurrentOzonDeliveryMenuAssist(): Promise<void> {
  ensureOzonDeliveryAssistStyles();
  const target = findOzonDeliveryContainer();
  const assist = document.getElementById(MENU_ASSIST_ID);
  const product = getCurrentProduct();
  if (!target || !assist || !product || assist.parentElement !== target) {
    ensureOzonDeliveryMenuAssist();
    return;
  }
  await syncOzonDeliveryMenuAssist(target, assist, product);
}

function ensureOzonDeliveryMenuAssist(): void {
  ensureOzonDeliveryAssistStyles();
  const target = findOzonDeliveryContainer();
  const existing = document.getElementById(MENU_ASSIST_ID);
  if (!target) {
    existing?.remove();
    return;
  }
  if (existing && existing.parentElement === target) {
    const product = getCurrentProduct();
    if (product) {
      void syncOzonDeliveryMenuAssist(target, existing, product);
    }
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
      "box-sizing:border-box",
      "width:100%",
      "max-width:100%",
      "min-width:0",
      "flex-wrap:wrap",
      "gap:8px",
      "margin:8px 0",
      "padding:8px",
      "border:1px solid #2a2a2c",
      "border-radius:10px",
      "background:#141414",
      "box-shadow:0 12px 30px rgba(0,0,0,.34)",
      "font:13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "color:#fafafa",
      "overflow:hidden",
      "z-index:2147483647"
    ].join(";")
  );

  suppressOzonAssistObserver();
  target.prepend(assist);
  void syncOzonDeliveryMenuAssist(target, assist, product);
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

interface OzonPickupRowCandidate {
  row: HTMLElement;
  candidate: OzonPickupCandidate | null;
  rank: number;
  rowKey: string;
}

async function syncOzonDeliveryMenuAssist(target: HTMLElement, assist: HTMLElement, product: ProductIdentity): Promise<void> {
  requestPagePickupCandidates();
  const rows = collectOzonDeliveryRowCandidates(target);
  const rowCandidates = rows.flatMap((row) => (row.candidate ? [row.candidate] : []));
  if (rowCandidates.length > 0 && mergePickupCandidates(rowCandidates)) {
    renderLastPanel();
  }

  const settings = await getLatestSettings();
  const savedExternalIds = getSavedOzonExternalIds(settings);
  suppressOzonAssistObserver();
  decorateOzonDeliveryRows(target, rows, savedExternalIds, product);
  renderOzonDeliveryAssist(assist, rows, savedExternalIds);
}

function suppressOzonAssistObserver(): void {
  suppressAssistObserverUntil = Date.now() + 300;
}

async function getLatestSettings(): Promise<ExtensionSettings | null> {
  if (latestSettings) {
    return latestSettings;
  }
  if (!settingsLoadPromise) {
    settingsLoadPromise = runtimeRequest({ type: "GET_SETTINGS" })
      .then((response) => {
        if (response.ok && "settings" in response) {
          latestSettings = response.settings;
          return response.settings;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        settingsLoadPromise = null;
      });
  }
  return settingsLoadPromise;
}

function collectOzonDeliveryRowCandidates(container: HTMLElement): OzonPickupRowCandidate[] {
  const byKey = new Map<string, OzonPickupRowCandidate>();
  const seenRows = new Set<HTMLElement>();
  const selectors = [
    "a",
    "button",
    "li",
    '[role="button"]',
    '[role="option"]',
    '[data-address-id]',
    '[data-address-oid]',
    '[data-delivery-address-id]',
    '[data-delivery-address-oid]',
    '[data-pickup-point-id]',
    '[data-pvz-id]',
    '[data-testid]',
    "div"
  ].join(",");

  for (const element of Array.from(container.querySelectorAll<HTMLElement>(selectors))) {
    const row = normalizeOzonPickupRow(element, container);
    if (!row || seenRows.has(row)) {
      continue;
    }
    seenRows.add(row);
    const candidate = extractOzonPickupCandidateFromRow(row);
    const rowText = getOzonRowText(row);
    const rowKey = candidate?.externalLocationId || rowMatchKey(rowText);
    const rect = row.getBoundingClientRect();
    const rank =
      (candidate?.score || 1) +
      (row.matches('a, button, [role="button"], [role="option"], li') ? 18 : 0) -
      Math.min(50, Math.round((rect.width * rect.height) / 6000));
    const existing = byKey.get(rowKey);
    if (!existing || rank > existing.rank) {
      byKey.set(rowKey, { row, candidate, rank, rowKey });
    }
  }

  return [...byKey.values()].sort((a, b) =>
    a.row.compareDocumentPosition(b.row) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
}

function normalizeOzonPickupRow(element: HTMLElement, container: HTMLElement): HTMLElement | null {
  if (element.id === MENU_ASSIST_ID || element.closest(`#${MENU_ASSIST_ID}`) || element.closest("[data-markonverter-pvz-action]")) {
    return null;
  }

  let current: HTMLElement | null = element;
  let best: HTMLElement | null = null;

  while (current && current !== container && current !== document.body) {
    if (isPotentialOzonPickupRow(current)) {
      best = current;
    }
    current = current.parentElement;
  }

  return best;
}

function isPotentialOzonPickupRow(element: HTMLElement): boolean {
  if (element.id === MENU_ASSIST_ID || element.closest(`#${MENU_ASSIST_ID}`) || element.closest("[data-markonverter-pvz-action]")) {
    return false;
  }
  if (!isVisible(element)) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (rect.height > Math.min(320, window.innerHeight * 0.45)) {
    return false;
  }

  const text = getOzonRowText(element);
  if (text.length < 8 || text.length > 420) {
    return false;
  }
  if (/выберите\s+адрес\s+доставки/i.test(text)) {
    return false;
  }
  if (isOzonAddAddressControlText(text)) {
    return false;
  }
  if (countPickupRowMarkers(text) > 1) {
    return false;
  }
  return /(пункт\s+ozon|пвз|pickup|выдач)/i.test(text);
}

function isOzonAddAddressControlText(text: string): boolean {
  return /(?:^|\s)(?:добавить|добавьте|add)(?:\s|$)/i.test(text) && /(адрес|пункт\s+выдач|постамат|delivery|pickup)/i.test(text);
}

function extractOzonPickupCandidateFromRow(element: HTMLElement): OzonPickupCandidate | null {
  const text = getOzonRowText(element);
  const name = pickupRowName(text);
  const evidence = collectOzonRowEvidence(element);
  const candidates = extractOzonPickupCandidatesFromSources([
    {
      source: "dom.ozon-delivery-row",
      urlHint: location.href,
      textHint: text,
      value: {
        name,
        address: name,
        ...evidence
      }
    }
  ]);
  const candidate = candidates[0];
  if (candidate) {
    return {
      ...candidate,
      name: name || candidate.name,
      score: candidate.score + 15,
      comment: "Captured from visible Ozon delivery row"
    };
  }

  const matched = matchDetectedPickupCandidateToRow(text);
  if (!matched) {
    return null;
  }
  return {
    ...matched,
    name: name || matched.name,
    score: Math.max(1, matched.score - 1),
    comment: matched.comment || "Matched to visible Ozon delivery row"
  };
}

function countPickupRowMarkers(text: string): number {
  return (text.match(/(?:пункт\s+ozon|пвз|pickup|выдач)/gi) || []).length;
}

function matchDetectedPickupCandidateToRow(rowText: string): OzonPickupCandidate | null {
  const rowNumber = extractOzonVisiblePointNumber(rowText);
  const rowTokens = pickupMatchTokens(rowText);
  let best: { candidate: OzonPickupCandidate; score: number } | null = null;

  for (const candidate of latestPickupCandidates) {
    const candidateText = `${candidate.name} ${candidate.comment || ""}`;
    const candidateNumber = extractOzonVisiblePointNumber(candidateText);
    let score = 0;
    if (rowNumber && candidateNumber && rowNumber === candidateNumber) {
      score += 100;
    }
    const candidateTokens = pickupMatchTokens(candidateText);
    for (const token of rowTokens) {
      if (candidateTokens.has(token)) {
        score += token.length >= 5 ? 10 : 4;
      }
    }
    if (score < 14) {
      continue;
    }
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  return best?.candidate || null;
}

function extractOzonVisiblePointNumber(text: string): string {
  return compactText(text.match(/(?:№|N[°o.]?)\s*([\d-]{3,})/i)?.[1] || "");
}

function rowMatchKey(text: string): string {
  return extractOzonVisiblePointNumber(text) || pickupMatchTokens(text).values().next().value || compactText(text).slice(0, 80);
}

function pickupMatchTokens(text: string): Set<string> {
  const lowerText = text.toLowerCase();
  const normalized = lowerText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        (token.length >= 4 || (token.length >= 2 && /\d/.test(token))) &&
        !/^(пункт|ozon|срок|хранения|заказа|дней|адрес|delivery|pickup)$/.test(token)
    );
  const numericAddressTokens = lowerText.match(/\d+[\p{L}]?/gu) || [];
  return new Set([...normalized, ...numericAddressTokens].slice(0, 50));
}

function getOzonRowText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-markonverter-pvz-action]").forEach((node) => node.remove());
  return compactText(clone.innerText || clone.textContent || "");
}

function pickupRowName(text: string): string {
  const cleaned = compactText(text.replace(/\b(Add|Saved|Refresh PVZ|Show in panel)\b/gi, ""));
  return cleaned.length > 170 ? `${cleaned.slice(0, 167)}...` : cleaned;
}

function collectOzonRowEvidence(element: HTMLElement): Record<string, string> {
  const evidence: Record<string, string> = {};
  const elements = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*")).slice(0, 80)];
  elements.forEach((item, elementIndex) => {
    Array.from(item.attributes).forEach((attribute, attributeIndex) => {
      if (!/(id|oid|uid|address|delivery|pickup|pick|pvz|location|href|title|aria-label|data)/i.test(attribute.name)) {
        return;
      }
      const value = attribute.value.trim();
      if (!value || value.length > 500) {
        return;
      }
      const key = evidence[attribute.name] === undefined ? attribute.name : `${attribute.name}_${elementIndex}_${attributeIndex}`;
      evidence[key] = value;
    });
  });
  return evidence;
}

function decorateOzonDeliveryRows(
  target: HTMLElement,
  rows: OzonPickupRowCandidate[],
  savedExternalIds: Set<string>,
  product: ProductIdentity
): void {
  const activeRows = new Set(rows.map((row) => row.row));
  target.querySelectorAll<HTMLElement>("[data-markonverter-pvz-action]").forEach((control) => {
    if (!control.parentElement || !activeRows.has(control.parentElement)) {
      control.parentElement?.classList.remove("markonverter-ozon-pvz-row");
      control.remove();
    }
  });

  for (const { row, candidate } of rows) {
    if (!candidate) {
      continue;
    }
    const stateKey = `${candidate.externalLocationId}:${savedExternalIds.has(candidate.externalLocationId) ? "saved" : "add"}`;
    const existing = Array.from(row.children).find(
      (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.markonverterPvzAction === "true"
    );
    if (existing?.dataset.markonverterActionState === stateKey) {
      continue;
    }
    const action = buildOzonRowAction(candidate, savedExternalIds.has(candidate.externalLocationId), product, stateKey);
    row.classList.add("markonverter-ozon-pvz-row");
    if (existing) {
      existing.replaceWith(action);
    } else {
      row.append(action);
    }
  }
}

function buildOzonRowAction(
  candidate: OzonPickupCandidate,
  isSaved: boolean,
  product: ProductIdentity,
  stateKey: string
): HTMLElement {
  const action = document.createElement("span");
  action.dataset.markonverterPvzAction = "true";
  action.dataset.markonverterActionState = stateKey;
  action.dataset.markonverterExternalLocationId = candidate.externalLocationId;
  action.className = `markonverter-ozon-pvz-action${isSaved ? " is-saved" : ""}`;
  action.textContent = isSaved ? "Saved" : "Add";
  action.title = isSaved ? "Already saved in Markonverter" : `Add ${candidate.name} to Markonverter`;
  action.setAttribute("role", "button");
  action.tabIndex = isSaved ? -1 : 0;
  action.setAttribute("aria-disabled", String(isSaved));

  const save = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isSaved) {
      void saveDetectedPickupCandidate(candidate, product);
    }
  };
  action.addEventListener("click", save);
  action.addEventListener("keydown", (event) => {
    if (event instanceof KeyboardEvent && (event.key === "Enter" || event.key === " ")) {
      save(event);
    }
  });
  return action;
}

function markSavedPickupCandidateInPage(candidate: OzonPickupCandidate): void {
  document.querySelectorAll<HTMLElement>("[data-markonverter-pvz-action]").forEach((action) => {
    if (action.dataset.markonverterExternalLocationId !== candidate.externalLocationId) {
      return;
    }
    action.textContent = "Saved";
    action.title = "Already saved in Markonverter";
    action.classList.add("is-saved");
    action.dataset.markonverterActionState = `${candidate.externalLocationId}:saved`;
    if (action instanceof HTMLButtonElement) {
      action.disabled = true;
    } else {
      action.setAttribute("aria-disabled", "true");
      action.tabIndex = -1;
    }
  });
}

function renderOzonDeliveryAssist(assist: HTMLElement, rows: OzonPickupRowCandidate[], savedExternalIds: Set<string>): void {
  const identifiedRows = rows.filter((row) => row.candidate);
  const savedCount = identifiedRows.filter((row) => row.candidate && savedExternalIds.has(row.candidate.externalLocationId)).length;
  const statusText =
    rows.length > 0
      ? `${rows.length} PVZ visible / ${savedCount} saved${identifiedRows.length < rows.length ? " / IDs loading" : ""}`
      : "PVZ list not loaded";
  const stateKey = `${rows.length}:${identifiedRows.length}:${savedCount}:${statusText}`;
  if (assist.dataset.markonverterAssistState === stateKey) {
    return;
  }
  assist.dataset.markonverterAssistState = stateKey;
  assist.innerHTML = "";

  const status = document.createElement("span");
  status.className = "markonverter-assist-status";
  status.textContent = statusText;

  const refreshButton = pageButton("Refresh PVZ", "secondary");
  refreshButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    requestPagePickupCandidates();
    const product = getCurrentProduct();
    if (product) {
      discoverOzonPickupCandidatesFromApi(product);
    }
    scheduleOzonDeliveryAssistSync();
  });

  const showButton = pageButton("Show in panel", "secondary");
  showButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    requestPagePickupCandidates();
    renderLastPanel();
    document.getElementById(PANEL_ID)?.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  assist.append(status, refreshButton, showButton);
}

function ensureOzonDeliveryAssistStyles(): void {
  if (document.getElementById(MENU_ASSIST_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = MENU_ASSIST_STYLE_ID;
  style.textContent = `
    .markonverter-ozon-pvz-row {
      position: relative !important;
      box-sizing: border-box !important;
    }
    .markonverter-ozon-pvz-action {
      all: initial !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      box-sizing: border-box !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      position: absolute !important;
      right: 12px !important;
      bottom: 12px !important;
      width: auto !important;
      min-width: 44px !important;
      max-width: min(84px, calc(100% - 24px)) !important;
      height: 24px !important;
      min-height: 24px !important;
      max-height: 24px !important;
      margin: 0 !important;
      padding: 0 8px !important;
      border: 1px solid rgba(245, 158, 11, 0.78) !important;
      border-radius: 7px !important;
      background: #141414 !important;
      color: #fbbf24 !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      letter-spacing: 0 !important;
      text-align: center !important;
      text-decoration: none !important;
      text-transform: none !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      z-index: 2147483647 !important;
      contain: layout style paint !important;
      transition: border-color 150ms ease, background 150ms ease !important;
    }
    .markonverter-ozon-pvz-action.is-saved {
      border-color: rgba(34, 197, 94, 0.55) !important;
      color: #86efac !important;
      cursor: default !important;
      pointer-events: none !important;
    }
    .markonverter-ozon-pvz-action:hover:not(:disabled):not(.is-saved) {
      border-color: #fbbf24 !important;
      background: #1b1b1c !important;
    }
    .markonverter-assist-status {
      flex: 1 1 auto;
      min-width: 0;
      color: #a1a1aa;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
  `;
  document.head.append(style);
}

function pageButton(text: string, variant: "primary" | "secondary" = "primary"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  const isPrimary = variant === "primary";
  button.setAttribute(
    "style",
    [
      "min-height:32px",
      "box-sizing:border-box",
      "max-width:100%",
      "padding:0 10px",
      `border:1px solid ${isPrimary ? "#f59e0b" : "#3f3f46"}`,
      "border-radius:8px",
      `background:${isPrimary ? "#f59e0b" : "#1b1b1c"}`,
      `color:${isPrimary ? "#111" : "#fafafa"}`,
      "cursor:pointer",
      "font:inherit",
      "font-weight:700",
      "white-space:nowrap",
      "overflow:hidden",
      "text-overflow:ellipsis"
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

interface PanelComparisonRow {
  pickupPoint: PickupPoint;
  result: ComparisonResult | null;
  deltaFromCheapest?: number;
  isCheapest: boolean;
  isSelected: boolean;
}

function renderPanel(shadow: ShadowRoot, model: PanelModel): void {
  lastPanelModel = model;
  shadow.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = panelCss();
  shadow.append(style);

  const root = document.createElement("section");
  root.className = "panel";
  root.classList.toggle("collapsed", isPanelCollapsed);
  if (!document.body.contains(shadow.host)) {
    root.classList.add("floating");
  }

  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = isPanelCollapsed
    ? `<div class="headerTitle collapsedTitle"><strong>Markonverter</strong></div>`
    : `<div class="headerTitle"><span class="eyebrow">Markonverter</span><strong>Pickup prices</strong><span>${escapeHtml(model.product.title || "Ozon product")}</span></div>`;
  if (isPanelCollapsed) {
    header.title = "Expand Markonverter panel";
    header.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button")) {
        return;
      }
      void setPanelCollapsed(false);
    });
  }

  const headerActions = document.createElement("div");
  headerActions.className = "headerActions";

  const panelSettings = "settings" in model ? model.settings : null;
  const currentSaveCandidate = panelSettings ? getFirstUnsavedPickupCandidate(panelSettings) : null;
  let saveButton: HTMLButtonElement | null = null;
  if (currentSaveCandidate) {
    const candidateToSave = currentSaveCandidate;
    saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "saveHeaderButton";
    saveButton.title = `Add ${candidateToSave.name} to Markonverter`;
    saveButton.textContent = "Add current";
    saveButton.addEventListener("click", () => {
      void saveSelectedPickupPoint(model.product);
    });
  }

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "iconButton";
  settingsButton.title = "Settings";
  settingsButton.textContent = "Options";
  settingsButton.addEventListener("click", () => {
    openOptionsPage();
  });

  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "iconButton collapseButton";
  collapseButton.title = isPanelCollapsed ? "Expand Markonverter panel" : "Collapse Markonverter panel";
  collapseButton.textContent = isPanelCollapsed ? "Open" : "Hide";
  collapseButton.addEventListener("click", () => {
    void setPanelCollapsed(!isPanelCollapsed);
  });

  if (isPanelCollapsed) {
    headerActions.append(collapseButton);
  } else {
    if (saveButton) {
      headerActions.append(saveButton);
    }
    headerActions.append(settingsButton, collapseButton);
  }
  header.append(headerActions);
  root.append(header);

  if (isPanelCollapsed) {
    shadow.append(root);
    return;
  }

  if (model.state === "loading") {
    root.append(messageNode(`Checking ${model.pickupPoints?.length || "configured"} pickup points...`));
    if (captureStatus) {
      root.append(messageNode(captureStatus.message, captureStatus.tone));
    }
  } else if (model.state === "empty") {
    root.append(messageNode("No Ozon pickup points configured."));
    appendDetectedPickupCandidates(root, model.settings, model.product, true);
    appendCaptureStatus(root);
  } else if (model.state === "noSelection") {
    root.append(messageNode("No saved pickup points selected for comparison."));
    appendPickupRows(root, model.settings, [], [], model.product);
    appendDetectedPickupCandidates(root, model.settings, model.product, false);
    appendCaptureStatus(root);
  } else if (model.state === "fatal") {
    root.append(messageNode(model.message, "error"));
  } else {
    appendDetectedPickupCandidates(root, model.settings, model.product, false);
    appendPickupRows(root, model.settings, model.pickupPoints, model.results, model.product);
    appendCaptureStatus(root);
  }

  shadow.append(root);
}

function renderLastPanel(): void {
  if (lastPanelModel) {
    renderPanel(ensurePanel(), lastPanelModel);
  }
}

async function loadPanelState(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(PANEL_STATE_KEY);
    isPanelCollapsed = normalizePanelState(stored[PANEL_STATE_KEY]).collapsed;
  } catch {
    isPanelCollapsed = false;
  }
}

function normalizePanelState(value: unknown): { collapsed: boolean } {
  const candidate = value as Partial<{ collapsed: boolean }> | undefined;
  return { collapsed: candidate?.collapsed === true };
}

async function setPanelCollapsed(collapsed: boolean): Promise<void> {
  isPanelCollapsed = collapsed;
  renderLastPanel();
  try {
    await chrome.storage.local.set({ [PANEL_STATE_KEY]: { collapsed } });
  } catch {
    // Keep the current page responsive even if extension storage is temporarily unavailable.
  }
  if (!collapsed) {
    await runIfProductPage();
  }
}

function appendCaptureStatus(root: HTMLElement): void {
  if (captureStatus) {
    root.append(messageNode(captureStatus.message, captureStatus.tone));
  }
}

function getSavedOzonExternalIds(settings: ExtensionSettings | null): Set<string> {
  return new Set(
    (settings?.pickupPoints || [])
      .filter((point) => point.marketplace === "ozon" && point.externalLocationId.trim() !== "")
      .map((point) => point.externalLocationId)
  );
}

function isPickupCandidateSaved(candidate: OzonPickupCandidate, settings: ExtensionSettings | null): boolean {
  return getSavedOzonExternalIds(settings).has(candidate.externalLocationId);
}

function getFirstUnsavedPickupCandidate(settings: ExtensionSettings): OzonPickupCandidate | null {
  return latestPickupCandidates.find((candidate) => !isPickupCandidateSaved(candidate, settings)) || null;
}

function appendPickupRows(
  root: HTMLElement,
  settings: ExtensionSettings,
  comparedPickupPoints: PickupPoint[],
  results: ComparisonResult[],
  product: ProductIdentity
): void {
  const rows = buildPanelComparisonRows(settings, comparedPickupPoints, results);
  if (rows.length > 0) {
    root.append(renderPickupRows(rows, settings, product));
  }
}

function buildPanelComparisonRows(
  settings: ExtensionSettings,
  comparedPickupPoints: PickupPoint[],
  results: ComparisonResult[]
): PanelComparisonRow[] {
  const comparedRows = buildComparisonRows(comparedPickupPoints, results);
  const comparedByPointId = new Map(comparedRows.map((row) => [row.pickupPoint.id, row]));
  return settings.pickupPoints
    .filter((point) => point.marketplace === "ozon")
    .map((pickupPoint) => {
      const compared = comparedByPointId.get(pickupPoint.id);
      if (compared) {
        return { ...compared, isSelected: true };
      }
      return {
        pickupPoint,
        result: null,
        isCheapest: false,
        isSelected: isComparisonPointSelected(pickupPoint, settings)
      };
    });
}

function isComparisonPointSelected(pickupPoint: PickupPoint, settings: ExtensionSettings): boolean {
  return settings.comparisonPickupPointIds ? settings.comparisonPickupPointIds.includes(pickupPoint.id) : true;
}

function renderPickupRows(rows: PanelComparisonRow[], settings: ExtensionSettings, product: ProductIdentity): HTMLElement {
  const list = document.createElement("div");
  list.className = "rows";

  for (const row of rows) {
    const item = document.createElement("div");
    item.className = `row${row.isCheapest ? " cheapest" : ""}${row.result?.status === "error" ? " failed" : ""}${
      row.isSelected ? "" : " unselected"
    }`;

    const meta = document.createElement("div");
    meta.className = "meta";

    const metaHead = document.createElement("div");
    metaHead.className = "metaHead";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "compareToggle";
    checkbox.checked = row.isSelected;
    checkbox.title = row.isSelected ? "Remove this pickup point from comparison" : "Compare this pickup point";
    checkbox.addEventListener("change", () => {
      void toggleComparisonPoint(row.pickupPoint.id, checkbox.checked, settings, product);
    });

    const metaText = document.createElement("div");
    metaText.className = "metaText";
    metaText.innerHTML = `<strong>${escapeHtml(row.pickupPoint.name)}</strong><span class="locationMeta">${escapeHtml(
      row.pickupPoint.country
    )} / ${escapeHtml(row.pickupPoint.currency)}</span>`;
    metaHead.append(checkbox, metaText);

    const rowActions = document.createElement("div");
    rowActions.className = "rowActions";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "deleteButton";
    deleteButton.textContent = "Delete";
    deleteButton.title = "Delete saved pickup point";
    deleteButton.addEventListener("click", () => {
      void deleteSavedPickupPoint(row.pickupPoint, product);
    });
    rowActions.append(deleteButton);
    meta.append(metaHead, rowActions);

    const value = document.createElement("div");
    value.className = "value";
    if (!row.result) {
      const idle = document.createElement("strong");
      idle.textContent = row.isSelected ? "Waiting" : "Not compared";
      const hint = document.createElement("span");
      hint.textContent = row.isSelected ? "Waiting for Ozon response" : "Enable to fetch this point";
      value.append(idle, hint);
    } else if (row.result.status === "success") {
      const original = formatCurrency(row.result.originalPrice.amount, row.result.originalPrice.currency);
      const converted = formatCurrency(row.result.convertedAmount, row.result.convertedCurrency);
      const delivery = row.result.originalPrice.deliveryText;
      const manualLabel =
        row.result.originalPrice.source === "manual" ? `Captured ${formatCapturedAt(row.result.originalPrice.capturedAt)}` : "";
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
        void captureCurrentPriceForPickupPoint(row.pickupPoint, product);
      });
      const detailsButton = document.createElement("button");
      detailsButton.type = "button";
      detailsButton.className = "detailsButton";
      detailsButton.textContent = "Copy details";
      detailsButton.title = "Copy technical details for debugging this pickup point.";
      detailsButton.addEventListener("click", () => {
        void copyFailureDiagnostics(row.pickupPoint, error, product);
      });
      actions.append(captureButton, detailsButton);
      value.append(unavailable, reason, actions);
    }

    item.append(meta, value);
    list.append(item);
  }

  return list;
}

function appendDetectedPickupCandidates(
  root: HTMLElement,
  settings: ExtensionSettings,
  product: ProductIdentity,
  showEmptyHint: boolean
): void {
  const list = detectedPickupCandidateList(settings, product, showEmptyHint);
  if (list) {
    root.append(list);
  }
}

function detectedPickupCandidateList(settings: ExtensionSettings, product: ProductIdentity, showEmptyHint: boolean): HTMLElement | null {
  const savedExternalIds = getSavedOzonExternalIds(settings);
  const detected = latestPickupCandidates.filter((candidate) => !savedExternalIds.has(candidate.externalLocationId)).slice(0, 8);
  if (detected.length === 0 && !showEmptyHint) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "detectedCandidates";

  const detectedHeader = document.createElement("div");
  detectedHeader.className = "detectedCandidatesTop";
  detectedHeader.innerHTML = `<div><span class="eyebrow">Ozon page</span><strong>New pickup points</strong></div><span>${detected.length} new</span>`;
  wrapper.append(detectedHeader);

  if (detected.length === 0) {
    const hint = document.createElement("p");
    hint.className = "pointManagerHint";
    hint.textContent = "Open Ozon delivery selection, then choose or view a point so Markonverter can detect it.";
    wrapper.append(hint);
    return wrapper;
  }

  for (const candidate of detected) {
    const row = document.createElement("div");
    row.className = "detectedCandidate";

    const text = document.createElement("span");
    text.className = "detectedCandidateText";
    text.innerHTML = `<strong>${escapeHtml(candidate.name)}</strong><span>${escapeHtml(candidate.country)} / ${escapeHtml(candidate.currency)}</span>`;

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "saveSmallButton";
    saveButton.textContent = "Save";
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
  await syncCurrentOzonDeliveryMenuAssist();
  await runIfProductPage();
  await syncCurrentOzonDeliveryMenuAssist();
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
    .panel.collapsed {
      width: min(246px, calc(100vw - 24px));
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
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
    .collapsed .header {
      min-height: 42px;
      padding: 8px 10px 8px 12px;
      border-bottom: 0;
      cursor: pointer;
      background: #111111;
    }
    .headerTitle {
      min-width: 0;
    }
    .collapsedTitle strong {
      font-size: 13px;
      line-height: 1.1;
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
    .pointManagerTop .eyebrow,
    .detectedCandidatesTop .eyebrow {
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
    .collapsed .headerActions {
      flex-wrap: nowrap;
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
    .collapsed .collapseButton {
      min-height: 28px;
      padding: 0 9px;
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
    .pointManager,
    .detectedCandidates {
      display: grid;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--mk-border);
      background: #101011;
    }
    .pointManagerTop,
    .pointChoice,
    .detectedCandidatesTop,
    .detectedCandidate {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .pointManagerTop,
    .detectedCandidatesTop {
      justify-content: space-between;
    }
    .detectedHeader {
      margin-top: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--mk-border);
    }
    .pointManagerTop strong,
    .detectedCandidatesTop strong,
    .pointChoiceText strong,
    .detectedCandidateText strong {
      color: var(--mk-text);
      font-size: 12px;
      font-weight: 730;
    }
    .pointManagerTop span,
    .pointChoiceText span,
    .detectedCandidatesTop span,
    .detectedCandidateText span {
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
    .pointChoice input,
    .compareToggle {
      width: 16px;
      height: 16px;
      margin: 0;
      flex: 0 0 auto;
      accent-color: var(--mk-accent);
    }
    .pointChoiceText,
    .detectedCandidateText,
    .metaText {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .meta {
      min-width: 0;
    }
    .metaHead {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      min-width: 0;
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
      grid-template-columns: minmax(0, 1fr) minmax(96px, 44%);
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
    .row.unselected {
      opacity: 0.72;
    }
    .value {
      min-width: 0;
      text-align: right;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    .value strong {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 14px;
      letter-spacing: 0;
      overflow-wrap: anywhere;
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
      .pointManagerTop,
      .detectedCandidatesTop {
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .pointManagerControls {
        flex-wrap: wrap;
      }
      .pointChoice,
      .detectedCandidate {
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
