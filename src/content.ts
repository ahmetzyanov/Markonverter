import { buildComparisonRows, makeErrorResult, makeSuccessResult } from "./shared/comparison";
import { formatCurrency } from "./shared/currency";
import { RuntimeRequest, RuntimeResponse } from "./shared/messages";
import { ComparisonResult, ExtensionSettings, PickupPoint, PriceQuote, ProductIdentity } from "./shared/types";
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
        return makeSuccessResult(pickupPoint.id, price, settings.defaultCurrency, settings);
      } catch (error) {
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

  captureStatus = { tone: "normal", message: `Saved: ${candidate.name}` };
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
      "border:1px solid #ccd5df",
      "border-radius:8px",
      "background:#fff",
      "box-shadow:0 8px 18px rgba(15,23,42,.12)",
      "font:13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
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
      "border:1px solid #1166cc",
      "border-radius:6px",
      "background:#1166cc",
      "color:#fff",
      "cursor:pointer",
      "font:inherit",
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
  header.innerHTML = `<div><strong>Pickup prices</strong><span>${escapeHtml(model.product.title || "Ozon product")}</span></div>`;

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
      meta.innerHTML = `<strong>${escapeHtml(row.pickupPoint.name)}</strong><span>${escapeHtml(row.pickupPoint.country)}</span>`;

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
        const delta =
          row.deltaFromCheapest && row.deltaFromCheapest > 0
            ? `+${formatCurrency(row.deltaFromCheapest, row.result.convertedCurrency)}`
            : row.isCheapest
              ? "best"
              : "";
        value.innerHTML = `<strong>${converted}</strong><span>${escapeHtml(original)} ${escapeHtml(delta)}</span>${
          delivery ? `<span>${escapeHtml(delivery)}</span>` : ""
        }`;
      } else {
        value.title = row.result.error;
        value.innerHTML = `<strong>Unavailable</strong><span>${escapeHtml(readableResultError(row.result.error))}</span>`;
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
  top.innerHTML = `<strong>Saved in Markonverter</strong><span>${allPickupPoints.length} total</span>`;

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
    label.innerHTML = `<strong>${escapeHtml(point.name)}</strong><span>${escapeHtml(point.country)} - ${escapeHtml(point.currency)}</span>`;

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
  detectedHeader.innerHTML = `<strong>Detected on Ozon</strong><span>${detected.length} found</span>`;
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
    text.innerHTML = `<strong>${escapeHtml(candidate.name)}</strong><span>${escapeHtml(candidate.country)} - ${escapeHtml(candidate.currency)}${
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
      color-scheme: light;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .panel {
      width: min(360px, calc(100vw - 24px));
      margin: 12px 0;
      border: 1px solid #d6dde6;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12);
      overflow: hidden;
      font-size: 13px;
      line-height: 1.35;
      z-index: 2147483647;
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
      padding: 12px;
      border-bottom: 1px solid #edf1f5;
      background: #f8fafc;
    }
    .header strong,
    .meta strong,
    .value strong {
      display: block;
      color: #172033;
      font-size: 13px;
      font-weight: 650;
    }
    .header span,
    .meta span,
    .value span {
      display: block;
      margin-top: 2px;
      color: #647084;
      font-size: 12px;
      overflow-wrap: anywhere;
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
      padding: 0 9px;
      border: 1px solid #1166cc;
      border-radius: 6px;
      background: #1166cc;
      color: #ffffff;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      white-space: nowrap;
    }
    .secondaryButton {
      border-color: #ccd5df;
      background: #ffffff;
      color: #172033;
    }
    .iconButton {
      border: 1px solid #ccd5df;
      background: #ffffff;
      color: #172033;
      cursor: pointer;
    }
    .message {
      margin: 0;
      padding: 12px;
      color: #415066;
    }
    .message.error {
      color: #a33131;
    }
    .capture {
      display: grid;
      gap: 7px;
      padding: 12px;
      border-top: 1px solid #edf1f5;
      background: #fbfcfe;
    }
    .capture > span {
      color: #647084;
      font-size: 12px;
    }
    .capture .message {
      padding: 0;
      font-size: 12px;
    }
    .captureButton {
      min-height: 34px;
      border: 1px solid #1166cc;
      border-radius: 6px;
      background: #1166cc;
      color: #ffffff;
      font: inherit;
      cursor: pointer;
    }
    .pointManager {
      display: grid;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid #edf1f5;
      background: #fbfcfe;
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
      margin-top: 6px;
      padding-top: 10px;
      border-top: 1px solid #edf1f5;
    }
    .pointManagerTop strong,
    .pointChoiceText strong {
      color: #172033;
      font-size: 12px;
      font-weight: 650;
    }
    .pointManagerTop span,
    .pointChoiceText span {
      display: block;
      color: #647084;
      font-size: 11px;
    }
    .pointManagerControls {
      display: flex;
      gap: 6px;
    }
    .pointManagerControls button,
    .deleteButton,
    .saveSmallButton {
      min-height: 28px;
      padding: 0 8px;
      border: 1px solid #ccd5df;
      border-radius: 6px;
      background: #ffffff;
      color: #172033;
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
      border-color: #f0c5c5;
      color: #9a2f2f;
    }
    .saveSmallButton {
      border-color: #1166cc;
      color: #1166cc;
    }
    .saveSmallButton:disabled {
      border-color: #ccd5df;
      color: #647084;
      cursor: default;
    }
    .pointManagerHint {
      margin: 0;
      color: #647084;
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
      padding: 11px 12px;
      border-top: 1px solid #edf1f5;
    }
    .row:first-child {
      border-top: 0;
    }
    .row.cheapest {
      background: #eefaf2;
    }
    .row.failed {
      background: #fff7f7;
    }
    .value {
      text-align: right;
      max-width: 150px;
    }
  `;
}
