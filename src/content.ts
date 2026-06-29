import { buildComparisonRows, makeErrorResult, makeSuccessResult } from "./shared/comparison";
import { formatCurrency } from "./shared/currency";
import { RuntimeRequest, RuntimeResponse } from "./shared/messages";
import { ComparisonResult, ExtensionSettings, PickupPoint, PriceQuote, ProductIdentity } from "./shared/types";
import { createMarketplaceAdapter } from "./marketplaces/registry";
import { fetchOzonPrivatePrice } from "./marketplaces/ozon-private-api";

const PANEL_ID = "markonverter-panel-root";

let activeUrl = "";
let activeRun = 0;

void boot();

async function boot(): Promise<void> {
  await runIfProductPage();
  setInterval(() => {
    if (location.href !== activeUrl) {
      void runIfProductPage();
    }
  }, 1000);
}

async function runIfProductPage(): Promise<void> {
  activeUrl = location.href;
  const runId = ++activeRun;
  const adapter = createMarketplaceAdapter("ozon", { requestOzonPrice });
  const url = new URL(location.href);

  if (!adapter.isProductPage(url)) {
    removePanel();
    return;
  }

  const product = adapter.getProductIdentity(url, document);
  if (!product) {
    removePanel();
    return;
  }

  const panel = ensurePanel();
  renderPanel(panel, { state: "loading", product });

  const settingsResponse = await runtimeRequest({ type: "GET_SETTINGS" });
  if (!settingsResponse.ok || !("settings" in settingsResponse)) {
    renderPanel(panel, { state: "fatal", product, message: settingsResponse.ok ? "Settings are unavailable" : settingsResponse.error });
    return;
  }

  const settings = settingsResponse.settings;
  const pickupPoints = settings.pickupPoints.filter((point) => point.marketplace === "ozon");
  if (pickupPoints.length === 0) {
    renderPanel(panel, { state: "empty", product, settings });
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

async function requestOzonPrice(request: {
  productId: string;
  productUrl: string;
  pickupExternalLocationId: string;
  currencyHint: "RUB" | "KZT";
}): Promise<PriceQuote> {
  return fetchOzonPrivatePrice(request);
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

type PanelModel =
  | { state: "loading"; product: ProductIdentity; settings?: ExtensionSettings; pickupPoints?: PickupPoint[] }
  | { state: "empty"; product: ProductIdentity; settings: ExtensionSettings }
  | { state: "fatal"; product: ProductIdentity; message: string }
  | {
      state: "results";
      product: ProductIdentity;
      settings: ExtensionSettings;
      pickupPoints: PickupPoint[];
      results: ComparisonResult[];
    };

function renderPanel(shadow: ShadowRoot, model: PanelModel): void {
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

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "iconButton";
  settingsButton.title = "Settings";
  settingsButton.textContent = "...";
  settingsButton.addEventListener("click", () => {
    void runtimeRequest({ type: "OPEN_OPTIONS" });
  });
  header.append(settingsButton);
  root.append(header);

  if (model.state === "loading") {
    root.append(messageNode(`Checking ${model.pickupPoints?.length || "configured"} pickup points...`));
  } else if (model.state === "empty") {
    root.append(messageNode("No Ozon pickup points configured."));
  } else if (model.state === "fatal") {
    root.append(messageNode(model.message, "error"));
  } else {
    const rows = buildComparisonRows(model.pickupPoints, model.results);
    const list = document.createElement("div");
    list.className = "rows";

    for (const row of rows) {
      const item = document.createElement("div");
      item.className = `row${row.isCheapest ? " cheapest" : ""}${row.result.status === "error" ? " failed" : ""}`;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = `<strong>${escapeHtml(row.pickupPoint.name)}</strong><span>${escapeHtml(row.pickupPoint.country)}</span>`;

      const value = document.createElement("div");
      value.className = "value";
      if (row.result.status === "success") {
        const original = formatCurrency(row.result.originalPrice.amount, row.result.originalPrice.currency);
        const converted = formatCurrency(row.result.convertedAmount, row.result.convertedCurrency);
        const delta =
          row.deltaFromCheapest && row.deltaFromCheapest > 0
            ? `+${formatCurrency(row.deltaFromCheapest, row.result.convertedCurrency)}`
            : row.isCheapest
              ? "best"
              : "";
        value.innerHTML = `<strong>${converted}</strong><span>${escapeHtml(original)} ${escapeHtml(delta)}</span>`;
      } else {
        value.innerHTML = `<strong>Unavailable</strong><span>${escapeHtml(row.result.error)}</span>`;
      }

      item.append(meta, value);
      list.append(item);
    }
    root.append(list);
  }

  shadow.append(root);
}

function messageNode(text: string, tone: "normal" | "error" = "normal"): HTMLElement {
  const node = document.createElement("p");
  node.className = `message ${tone}`;
  node.textContent = text;
  return node;
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
    .iconButton {
      width: 32px;
      height: 32px;
      border: 1px solid #ccd5df;
      border-radius: 6px;
      background: #ffffff;
      cursor: pointer;
      font-size: 15px;
    }
    .message {
      margin: 0;
      padding: 12px;
      color: #415066;
    }
    .message.error {
      color: #a33131;
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
