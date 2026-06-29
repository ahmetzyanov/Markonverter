"use strict";
(() => {
  // src/shared/currency.ts
  function convertAmount(amount, from, to, ratesToRub) {
    assertPositiveRate(from, ratesToRub[from]);
    assertPositiveRate(to, ratesToRub[to]);
    return amount * ratesToRub[from] / ratesToRub[to];
  }
  function roundMoney(amount) {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }
  function formatCurrency(amount, currency) {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "KZT" ? 0 : 2
    }).format(amount);
  }
  function assertPositiveRate(currency, rate) {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Invalid ${currency} exchange rate`);
    }
  }

  // src/shared/comparison.ts
  function makeSuccessResult(pickupPointId, originalPrice, targetCurrency, settings) {
    return {
      pickupPointId,
      status: "success",
      originalPrice,
      convertedAmount: roundMoney(
        convertAmount(originalPrice.amount, originalPrice.currency, targetCurrency, settings.ratesToRub)
      ),
      convertedCurrency: targetCurrency
    };
  }
  function makeErrorResult(pickupPointId, error) {
    return {
      pickupPointId,
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }
  function buildComparisonRows(pickupPoints, results) {
    const resultByPoint = new Map(results.map((result) => [result.pickupPointId, result]));
    const successfulAmounts = results.filter((result) => result.status === "success").map((result) => result.convertedAmount);
    const cheapest = successfulAmounts.length > 0 ? Math.min(...successfulAmounts) : void 0;
    return pickupPoints.map((pickupPoint) => {
      const result = resultByPoint.get(pickupPoint.id) ?? makeErrorResult(pickupPoint.id, "No result");
      const isCheapest = result.status === "success" && cheapest !== void 0 && result.convertedAmount === cheapest;
      return {
        pickupPoint,
        result,
        isCheapest,
        deltaFromCheapest: result.status === "success" && cheapest !== void 0 ? roundMoney(result.convertedAmount - cheapest) : void 0
      };
    });
  }

  // src/marketplaces/ozon.ts
  var OZON_PRODUCT_RE = /\/product\/(?:[^/?#]+-)?(\d+)(?:[/?#]|$)/;
  function createOzonAdapter(context) {
    return {
      id: "ozon",
      name: "Ozon",
      supported: true,
      isProductPage(url) {
        return isOzonHost(url.hostname) && OZON_PRODUCT_RE.test(url.pathname);
      },
      getProductIdentity(url, document2) {
        const match = url.pathname.match(OZON_PRODUCT_RE);
        if (!match) {
          return null;
        }
        return {
          marketplace: "ozon",
          productId: match[1],
          url: url.toString(),
          title: document2.querySelector("h1")?.textContent?.trim() || document2.title || void 0
        };
      },
      async fetchPrice(product, pickupPoint, _settings) {
        if (!context.requestOzonPrice) {
          throw new Error("Ozon page bridge is not available");
        }
        return context.requestOzonPrice({
          productId: product.productId,
          productUrl: product.url,
          pickupExternalLocationId: pickupPoint.externalLocationId,
          currencyHint: pickupPoint.currency
        });
      },
      formatError(error) {
        if (error instanceof Error) {
          return error.message;
        }
        return String(error);
      }
    };
  }
  function isOzonHost(hostname) {
    return hostname === "ozon.ru" || hostname.endsWith(".ozon.ru") || hostname === "ozon.kz" || hostname.endsWith(".ozon.kz");
  }

  // src/marketplaces/wildberries.ts
  var wildberriesPlaceholder = {
    id: "wildberries",
    name: "Wildberries",
    supported: false,
    isProductPage() {
      return false;
    },
    getProductIdentity() {
      return null;
    },
    async fetchPrice() {
      throw new Error("Wildberries integration is not implemented yet");
    },
    formatError(error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  // src/marketplaces/registry.ts
  function createMarketplaceAdapter(marketplaceId, context = {}) {
    if (marketplaceId === "ozon") {
      return createOzonAdapter(context);
    }
    return wildberriesPlaceholder;
  }

  // src/marketplaces/ozon-private-api.ts
  async function fetchOzonPrivatePrice(request) {
    const productUrl = new URL(request.productUrl);
    const pathWithSearch = `${productUrl.pathname}${productUrl.search}`;
    const candidates = buildEndpointCandidates(pathWithSearch, request.pickupExternalLocationId);
    const errors = [];
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate.url, {
          method: candidate.method,
          credentials: "include",
          headers: candidate.headers,
          body: candidate.body
        });
        if (!response.ok) {
          errors.push(`${candidate.label}: HTTP ${response.status}`);
          continue;
        }
        const json = await response.json();
        if (!responseContainsLocation(json, request.pickupExternalLocationId)) {
          errors.push(`${candidate.label}: response did not confirm requested pickup location`);
          continue;
        }
        const price = extractOzonPrice(json, request.currencyHint);
        if (!price) {
          errors.push(`${candidate.label}: no unambiguous product price in response`);
          continue;
        }
        return price;
      } catch (error) {
        errors.push(`${candidate.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`Ozon private API did not return a verified product price. ${errors.join("; ")}`);
  }
  function buildEndpointCandidates(pathWithSearch, pickupExternalLocationId) {
    const encodedUrl = encodeURIComponent(pathWithSearch);
    const encodedLocation = encodeURIComponent(pickupExternalLocationId);
    const jsonHeaders = {
      "content-type": "application/json",
      "x-o3-app-name": "dweb_client",
      "x-o3-app-version": "release"
    };
    return [
      {
        label: "composer-get-location",
        method: "GET",
        url: `/api/composer-api.bx/page/json/v2?url=${encodedUrl}&deliveryAddressOid=${encodedLocation}`,
        headers: jsonHeaders
      },
      {
        label: "entrypoint-get-location",
        method: "GET",
        url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}&deliveryAddressOid=${encodedLocation}`,
        headers: jsonHeaders
      },
      {
        label: "composer-post-location",
        method: "POST",
        url: "/api/composer-api.bx/page/json/v2",
        headers: jsonHeaders,
        body: JSON.stringify({
          url: pathWithSearch,
          deliveryAddressOid: pickupExternalLocationId
        })
      }
    ];
  }
  function responseContainsLocation(json, pickupExternalLocationId) {
    const needle = pickupExternalLocationId.trim();
    if (!needle) {
      return false;
    }
    let found = false;
    walk(json, [], (_path, value) => {
      if (found || typeof value !== "string") {
        return;
      }
      found = value.includes(needle);
    });
    return found;
  }
  function extractOzonPrice(json, currencyHint) {
    const candidates = [];
    for (const [path, value] of preferredPricePaths(json)) {
      const parsed = parsePrice(value, currencyHint);
      if (parsed) {
        candidates.push({ ...parsed, score: 100, path });
      }
    }
    walk(json, [], (path, value) => {
      const key = path[path.length - 1]?.toLowerCase() || "";
      const joined = path.join(".").toLowerCase();
      const looksProductScoped = joined.includes("webprice") || joined.includes("finalprice") || joined.includes("cardprice") || joined.includes("price") || joined.includes("product");
      const looksWrongKind = joined.includes("oldprice") || joined.includes("originalprice") || joined.includes("delivery") || joined.includes("installment") || joined.includes("bonus") || joined.includes("points");
      if (!looksProductScoped || looksWrongKind || !key.includes("price") && typeof value !== "string") {
        return;
      }
      const parsed = parsePrice(value, currencyHint);
      if (!parsed || parsed.amount < 1 || parsed.amount > 1e8) {
        return;
      }
      candidates.push({
        ...parsed,
        score: (joined.includes("final") ? 15 : 0) + (joined.includes("webprice") ? 12 : 0) + (parsed.currency ? 5 : 0),
        path: joined
      });
    });
    const unique = dedupeCandidates(candidates);
    unique.sort((a, b) => b.score - a.score);
    const [best, second] = unique;
    if (!best) {
      return null;
    }
    if (second && best.score === second.score && best.amount !== second.amount) {
      return null;
    }
    return { amount: best.amount, currency: best.currency, rawText: best.rawText };
  }
  function preferredPricePaths(json) {
    const roots = findWidgetStates(json);
    const candidates = [];
    for (const root of roots) {
      for (const [key, rawValue] of Object.entries(root)) {
        const lowerKey = key.toLowerCase();
        if (!lowerKey.includes("webprice") && !lowerKey.includes("price")) {
          continue;
        }
        const value = parseMaybeJson(rawValue);
        const paths = [
          ["price"],
          ["finalPrice"],
          ["cardPrice"],
          ["mainPrice"],
          ["price", "price"],
          ["price", "text"],
          ["mainState", "price"],
          ["state", "price"]
        ];
        for (const path of paths) {
          const nested = getPath(value, path);
          if (nested !== void 0) {
            candidates.push([`${key}.${path.join(".")}`, nested]);
          }
        }
      }
    }
    return candidates;
  }
  function findWidgetStates(json) {
    const roots = [];
    walk(json, [], (path, value) => {
      if (path[path.length - 1] === "widgetStates" && value && typeof value === "object" && !Array.isArray(value)) {
        roots.push(value);
      }
    });
    return roots;
  }
  function parseMaybeJson(value) {
    if (typeof value !== "string") {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  function getPath(value, path) {
    let current = value;
    for (const segment of path) {
      if (!current || typeof current !== "object" || !(segment in current)) {
        return void 0;
      }
      current = current[segment];
    }
    return current;
  }
  function dedupeCandidates(candidates) {
    const byKey = /* @__PURE__ */ new Map();
    for (const candidate of candidates) {
      const key = `${candidate.amount}:${candidate.currency}:${candidate.rawText || ""}`;
      const existing = byKey.get(key);
      if (!existing || candidate.score > existing.score) {
        byKey.set(key, candidate);
      }
    }
    return [...byKey.values()];
  }
  function walk(value, path, visitor) {
    visitor(path, value);
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 200).forEach((item, index) => walk(item, [...path, String(index)], visitor));
      return;
    }
    for (const [key, child] of Object.entries(value).slice(0, 300)) {
      walk(child, [...path, key], visitor);
    }
  }
  function parsePrice(value, currencyHint) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? { amount: value, currency: currencyHint } : null;
    }
    if (typeof value !== "string") {
      return null;
    }
    const currency = value.includes("\u20BD") || /руб/i.test(value) ? "RUB" : value.includes("\u20B8") || /тг|тенге/i.test(value) ? "KZT" : currencyHint;
    if (!/\d[\d\s.,]{1,}/.test(value)) {
      return null;
    }
    const normalized = value.replace(/[^\d,.\s]/g, "").replace(/\s+/g, "").replace(",", ".");
    const amount = Number.parseFloat(normalized);
    return Number.isFinite(amount) ? { amount, currency, rawText: value } : null;
  }

  // src/content.ts
  var PANEL_ID = "markonverter-panel-root";
  var activeUrl = "";
  var activeRun = 0;
  void boot();
  async function boot() {
    await runIfProductPage();
    setInterval(() => {
      if (location.href !== activeUrl) {
        void runIfProductPage();
      }
    }, 1e3);
  }
  async function runIfProductPage() {
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
      pickupPoints.map(async (pickupPoint) => {
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
  async function requestOzonPrice(request) {
    return fetchOzonPrivatePrice(request);
  }
  function ensurePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing?.shadowRoot) {
      return existing.shadowRoot;
    }
    const host = document.createElement("aside");
    host.id = PANEL_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const anchor = document.querySelector('[data-widget="webPrice"]') || document.querySelector('[data-widget*="price" i]') || document.querySelector("h1")?.parentElement;
    if (anchor?.parentElement) {
      anchor.parentElement.insertBefore(host, anchor.nextSibling);
    } else {
      document.documentElement.append(host);
    }
    return shadow;
  }
  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }
  function renderPanel(shadow, model) {
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
          const delta = row.deltaFromCheapest && row.deltaFromCheapest > 0 ? `+${formatCurrency(row.deltaFromCheapest, row.result.convertedCurrency)}` : row.isCheapest ? "best" : "";
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
  function messageNode(text, tone = "normal") {
    const node = document.createElement("p");
    node.className = `message ${tone}`;
    node.textContent = text;
    return node;
  }
  async function runtimeRequest(request) {
    return chrome.runtime.sendMessage(request);
  }
  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }
  function panelCss() {
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
})();
//# sourceMappingURL=content.js.map
