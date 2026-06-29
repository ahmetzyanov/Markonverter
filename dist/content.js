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
          errors.push(`${candidate.label}: response did not confirm requested pickup point`);
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
        label: "composer-get-delivery-address",
        method: "GET",
        url: `/api/composer-api.bx/page/json/v2?url=${encodedUrl}&deliveryAddressOid=${encodedLocation}`,
        headers: jsonHeaders
      },
      {
        label: "entrypoint-get-delivery-address",
        method: "GET",
        url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}&deliveryAddressOid=${encodedLocation}`,
        headers: jsonHeaders
      },
      {
        label: "composer-get-selected-location",
        method: "GET",
        url: `/api/composer-api.bx/page/json/v2?url=${encodedUrl}&select_location=${encodedLocation}`,
        headers: jsonHeaders
      },
      {
        label: "entrypoint-get-selected-location",
        method: "GET",
        url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}&select_location=${encodedLocation}`,
        headers: jsonHeaders
      },
      {
        label: "composer-post-delivery-address",
        method: "POST",
        url: "/api/composer-api.bx/page/json/v2",
        headers: jsonHeaders,
        body: JSON.stringify({
          url: pathWithSearch,
          deliveryAddressOid: pickupExternalLocationId
        })
      },
      {
        label: "composer-post-selected-location",
        method: "POST",
        url: "/api/composer-api.bx/page/json/v2",
        headers: jsonHeaders,
        body: JSON.stringify({
          url: pathWithSearch,
          select_location: pickupExternalLocationId
        })
      },
      {
        label: "composer-post-location-both",
        method: "POST",
        url: "/api/composer-api.bx/page/json/v2",
        headers: jsonHeaders,
        body: JSON.stringify({
          url: pathWithSearch,
          deliveryAddressOid: pickupExternalLocationId,
          select_location: pickupExternalLocationId
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
      if (found || typeof value !== "string" && typeof value !== "number") {
        return;
      }
      const path = _path.join(".").toLowerCase();
      if (!locationConfirmationPathScore(path)) {
        return;
      }
      found = String(value).includes(needle);
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
    const deliveryText = extractOzonDeliveryText(json);
    return { amount: best.amount, currency: best.currency, rawText: best.rawText, ...deliveryText ? { deliveryText } : {} };
  }
  function extractOzonDeliveryText(json) {
    const candidates = [];
    walk(json, [], (path, value) => {
      if (typeof value !== "string") {
        return;
      }
      const text = compactText(value);
      if (!text || text.length < 3 || text.length > 160 || !/\p{L}|\d/u.test(text)) {
        return;
      }
      const joined = path.join(".").toLowerCase();
      if (!joined.includes("deliver") && !joined.includes("\u0434\u043E\u0441\u0442\u0430\u0432") && !joined.includes("eta") && !joined.includes("time")) {
        return;
      }
      if (/(price|amount|cost|address|coordinates|geo|url|request|tracking|analytics)/i.test(joined) || /(^|\.)(oid|uid|id)$/i.test(joined)) {
        return;
      }
      candidates.push({
        text,
        score: (/(eta|time|date|period|interval|deadline|subtitle|title|text)/i.test(joined) ? 20 : 0) + (/(today|tomorrow|сегодня|завтра|дн|час|мин|\d)/i.test(text) ? 15 : 0) + (joined.includes("widgetstates") ? 5 : 0)
      });
    });
    candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    return candidates[0]?.text || null;
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
  function locationConfirmationPathScore(path) {
    if (/(request|url|href|referrer|referer|query|param|tracking|analytics|debug|log|metrika|route)/i.test(path)) {
      return 0;
    }
    if (/(selected|current|active|chosen)/i.test(path) && /(delivery|address|pickup|pickpoint|pvz|location|geo|city|region)/i.test(path)) {
      return 2;
    }
    if (/(delivery|address|pickup|pickpoint|pvz|location|geo|city|region)/i.test(path)) {
      return 1;
    }
    return 0;
  }
  function compactText(value) {
    return value.replace(/\s+/g, " ").trim();
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

  // src/marketplaces/ozon-pickup-capture.ts
  var STRONG_ID_KEYS = /* @__PURE__ */ new Set([
    "deliveryAddressOid",
    "deliveryAddressId",
    "addressOid",
    "addressId",
    "locationUid",
    "pickupPointId",
    "pickPointId",
    "pvzId",
    "pointId"
  ]);
  var WEAK_ID_KEYS = /* @__PURE__ */ new Set(["locationId", "cityId", "geoId", "regionId"]);
  var RELEVANCE_RE = /(delivery|address|pickup|pickpoint|pvz|пвз|пункт|получ|достав|location|geo|city|region)/i;
  var BAD_ID_RE = /(product|sku|item|seller|brand|category|image|price|cart|widget|layout|session|fingerprint|analytics|banner)/i;
  var KZ_RE = /(kazakhstan|казахстан|kz\b|алматы|астана|караганда|шымкент|атырау|актобе|павлодар|усть-каменогорск)/i;
  var RU_RE = /(russia|россия|ru\b|москва|санкт-петербург|екатеринбург|казань|новосибирск|краснодар)/i;
  function extractOzonPickupCandidatesFromSources(sources) {
    const candidates = [];
    for (const source of sources) {
      const sourceText = `${source.source} ${source.urlHint || ""} ${source.textHint || ""}`;
      collectFromUnknown(parseMaybeJson2(source.value), source.source, sourceText, candidates);
      if (typeof source.value === "string") {
        collectFromText(source.value, source.source, sourceText, candidates);
      }
    }
    return dedupeCandidates2(candidates).sort((a, b) => b.score - a.score);
  }
  function collectFromUnknown(value, source, sourceText, candidates, path = [], depth = 0) {
    if (depth > 8 || value == null) {
      return;
    }
    if (typeof value === "string") {
      const parsed = parseMaybeJson2(value);
      if (parsed !== value) {
        collectFromUnknown(parsed, source, sourceText, candidates, path, depth + 1);
      } else {
        collectFromText(value, source, sourceText, candidates);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 150).forEach((item, index) => {
        collectFromUnknown(item, source, sourceText, candidates, [...path, String(index)], depth + 1);
      });
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    const object = value;
    collectFromObject(object, source, sourceText, path, candidates);
    for (const [key, child] of Object.entries(object).slice(0, 250)) {
      collectFromUnknown(child, source, sourceText, candidates, [...path, key], depth + 1);
    }
  }
  function collectFromObject(object, source, sourceText, path, candidates) {
    const keys = Object.keys(object);
    const pathText = [...path, ...keys].join(".");
    const relevantObject = RELEVANCE_RE.test(pathText) || RELEVANCE_RE.test(sourceText);
    const objectText = objectStrings(object).join(" ");
    const name = extractName(object, sourceText);
    const country = inferCountry(`${sourceText} ${objectText}`);
    const currency = country === "KZ" ? "KZT" : "RUB";
    for (const [key, rawValue] of Object.entries(object)) {
      const id = normalizeId(rawValue);
      if (!id || BAD_ID_RE.test(key)) {
        continue;
      }
      const keyScore = scoreIdKey(key);
      if (keyScore === 0 || keyScore < 35 && !relevantObject) {
        continue;
      }
      candidates.push({
        externalLocationId: id,
        name: name || `Ozon pickup ${id}`,
        country,
        currency,
        source,
        score: keyScore + (relevantObject ? 20 : 0) + (name ? 10 : 0) + (country === "KZ" ? 2 : 0),
        comment: `Captured from ${source}`
      });
    }
  }
  function collectFromText(text, source, sourceText, candidates) {
    if (!RELEVANCE_RE.test(`${source} ${sourceText} ${text.slice(0, 2e3)}`)) {
      return;
    }
    const patterns = [
      /(?:deliveryAddressOid|deliveryAddressId|addressOid|addressId|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'=:\s]+([a-z0-9_-]{4,80})/gi,
      /(?:deliveryAddressOid|deliveryAddressId|addressOid|addressId|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'\s]*[:=]["'\s]*([a-z0-9_-]{4,80})/gi
    ];
    for (const pattern of patterns) {
      let match;
      while (match = pattern.exec(text)) {
        const id = normalizeId(match[1]);
        if (!id) {
          continue;
        }
        const country = inferCountry(`${sourceText} ${text.slice(Math.max(0, match.index - 200), match.index + 300)}`);
        candidates.push({
          externalLocationId: id,
          name: `Ozon pickup ${id}`,
          country,
          currency: country === "KZ" ? "KZT" : "RUB",
          source,
          score: 35,
          comment: `Captured from ${source}`
        });
      }
    }
  }
  function scoreIdKey(key) {
    if (STRONG_ID_KEYS.has(key)) {
      return 60;
    }
    if (WEAK_ID_KEYS.has(key)) {
      return 20;
    }
    if (/(delivery|address|pickup|pick|pvz|location).*(oid|id|uid)$/i.test(key)) {
      return 45;
    }
    if (/(oid|id|uid)$/i.test(key) && RELEVANCE_RE.test(key)) {
      return 25;
    }
    return 0;
  }
  function extractName(object, sourceText) {
    const exactKeys = [
      "fullAddress",
      "formattedAddress",
      "address",
      "addressText",
      "shortAddress",
      "displayName",
      "name",
      "title",
      "city"
    ];
    for (const key of exactKeys) {
      const value = stringValue(object[key]);
      if (value && isUsefulLabel(value)) {
        return compact(value);
      }
    }
    for (const [key, rawValue] of Object.entries(object)) {
      const value = stringValue(rawValue);
      if (value && /(address|name|title|city|street|пвз|пункт)/i.test(key) && isUsefulLabel(value)) {
        return compact(value);
      }
    }
    const sourceLabel = sourceText.match(/(?:пункт выдачи|пвз|pickup point|адрес)[:\s-]+([^|]{8,120})/i)?.[1];
    return sourceLabel ? compact(sourceLabel) : "";
  }
  function inferCountry(text) {
    if (KZ_RE.test(text) || /\.kz\b/i.test(text)) {
      return "KZ";
    }
    if (RU_RE.test(text) || /\.ru\b/i.test(text)) {
      return "RU";
    }
    return "RU";
  }
  function objectStrings(object) {
    return Object.values(object).filter((value) => typeof value === "string").slice(0, 30);
  }
  function parseMaybeJson2(value) {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    if (!trimmed || !/^[{[]/.test(trimmed)) {
      return value;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  function normalizeId(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return String(value);
    }
    if (typeof value !== "string") {
      return "";
    }
    const trimmed = value.trim().replace(/^["']|["']$/g, "");
    return /^[a-z0-9_-]{4,80}$/i.test(trimmed) ? trimmed : "";
  }
  function stringValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }
  function isUsefulLabel(value) {
    return value.length >= 3 && value.length <= 180 && !/^[a-z0-9_-]{4,80}$/i.test(value);
  }
  function compact(value) {
    return value.replace(/\s+/g, " ").trim();
  }
  function dedupeCandidates2(candidates) {
    const byId = /* @__PURE__ */ new Map();
    for (const candidate of candidates) {
      const existing = byId.get(candidate.externalLocationId);
      if (!existing || candidate.score > existing.score || candidate.name.length > existing.name.length && candidate.score === existing.score) {
        byId.set(candidate.externalLocationId, candidate);
      }
    }
    return [...byId.values()];
  }

  // src/content.ts
  var PANEL_ID = "markonverter-panel-root";
  var COLLECT_PICKUP_EVENT = "markonverter:collect-ozon-pickup";
  var PICKUP_CANDIDATES_EVENT = "markonverter:ozon-pickup-candidates";
  var activeUrl = "";
  var activeRun = 0;
  var latestPickupCandidates = [];
  var lastPanelModel = null;
  var captureStatus = null;
  var isPointManagerOpen = false;
  void boot();
  async function boot() {
    document.addEventListener(PICKUP_CANDIDATES_EVENT, handlePickupCandidatesEvent);
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.type !== "SAVE_SELECTED_OZON_PICKUP") {
        return false;
      }
      void saveCurrentSelectedPickupPoint().then(sendResponse).catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
      return true;
    });
    if (document.readyState === "loading") {
      await new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
    }
    await runIfProductPage();
    setInterval(() => {
      if (location.href !== activeUrl) {
        void runIfProductPage();
      }
    }, 1e3);
  }
  async function runIfProductPage() {
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
  function getComparisonPickupPoints(settings, allPickupPoints) {
    if (!settings.comparisonPickupPointIds) {
      return allPickupPoints;
    }
    const selectedIds = new Set(settings.comparisonPickupPointIds);
    return allPickupPoints.filter((point) => selectedIds.has(point.id));
  }
  async function requestOzonPrice(request) {
    return fetchOzonPrivatePrice(request);
  }
  function getCurrentProduct() {
    const adapter = createMarketplaceAdapter("ozon", { requestOzonPrice });
    const url = new URL(location.href);
    return adapter.isProductPage(url) ? adapter.getProductIdentity(url, document) : null;
  }
  function handlePickupCandidatesEvent(event) {
    const detail = event.detail;
    if (!detail) {
      return;
    }
    try {
      const candidates = JSON.parse(detail);
      mergePickupCandidates(candidates);
    } catch {
    }
  }
  function mergePickupCandidates(candidates) {
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
  function requestPagePickupCandidates() {
    document.dispatchEvent(new CustomEvent(COLLECT_PICKUP_EVENT));
  }
  async function getBestPickupCandidate() {
    requestPagePickupCandidates();
    mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
    await new Promise((resolve) => setTimeout(resolve, 250));
    mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
    return latestPickupCandidates[0] || null;
  }
  function collectFallbackCaptureSources() {
    const sources = [];
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
  function collectStorage(name, storage, sources, urlHint) {
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
    }
  }
  function collectDeliveryText() {
    const chunks = [];
    document.querySelectorAll(
      '[data-widget*="address" i], [data-widget*="delivery" i], [data-widget*="geo" i], [data-widget*="user" i], [href*="delivery" i], button, a'
    ).forEach((element) => {
      const text = element.innerText || element.textContent || "";
      if (/(достав|получ|пункт|пвз|адрес|город|pickup|delivery|address)/i.test(text)) {
        chunks.push(text);
      }
    });
    return chunks.slice(0, 30).join(" | ").slice(0, 8e3);
  }
  async function saveCurrentSelectedPickupPoint() {
    const product = getCurrentProduct();
    if (!product) {
      return { ok: false, error: "Open an Ozon product page to save the selected pickup point" };
    }
    return saveSelectedPickupPoint(product);
  }
  async function saveSelectedPickupPoint(product) {
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
    const pickupPoint = {
      id: crypto.randomUUID(),
      name: candidate.name,
      marketplace: "ozon",
      country: candidate.country,
      currency: candidate.currency,
      externalLocationId: candidate.externalLocationId,
      comment: candidate.comment || `Captured from ${product.url}`
    };
    const response = await runtimeRequest({ type: "UPSERT_PICKUP_POINT", pickupPoint });
    if (!response.ok || !("settings" in response)) {
      captureStatus = { tone: "error", message: response.ok ? "Pickup point was not saved" : response.error };
      renderLastPanel();
      return { ok: false, error: captureStatus.message };
    }
    captureStatus = { tone: "normal", message: `Saved: ${candidate.name}` };
    await runIfProductPage();
    return response;
  }
  async function deleteSavedPickupPoint(pickupPoint, product) {
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
  async function toggleComparisonPoint(pickupPointId, isSelected, settings, product) {
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
  async function updateComparisonSelection(pickupPointIds, product) {
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
          const delta = row.deltaFromCheapest && row.deltaFromCheapest > 0 ? `+${formatCurrency(row.deltaFromCheapest, row.result.convertedCurrency)}` : row.isCheapest ? "best" : "";
          value.innerHTML = `<strong>${converted}</strong><span>${escapeHtml(original)} ${escapeHtml(delta)}</span>${delivery ? `<span>${escapeHtml(delivery)}</span>` : ""}`;
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
  function renderLastPanel() {
    if (lastPanelModel) {
      renderPanel(ensurePanel(), lastPanelModel);
    }
  }
  function pointManager(settings, visiblePickupPoints, product) {
    const allPickupPoints = settings.pickupPoints.filter((point) => point.marketplace === "ozon");
    const selectedIds = settings.comparisonPickupPointIds ? new Set(settings.comparisonPickupPointIds) : null;
    const wrapper = document.createElement("div");
    wrapper.className = "pointManager";
    const top = document.createElement("div");
    top.className = "pointManagerTop";
    top.innerHTML = `<strong>Saved points</strong><span>${allPickupPoints.length} total</span>`;
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
    return wrapper;
  }
  function captureControl(product) {
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
  function messageNode(text, tone = "normal") {
    const node = document.createElement("p");
    node.className = `message ${tone}`;
    node.textContent = text;
    return node;
  }
  function openOptionsPage() {
    void runtimeRequest({ type: "OPEN_OPTIONS" }).then((response) => {
      if (!response.ok) {
        window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener");
      }
    }).catch(() => {
      window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener");
    });
  }
  function readableResultError(error) {
    if (error.includes("response did not confirm requested pickup point")) {
      return "Ozon did not confirm this pickup point, so the current address may have been reused.";
    }
    return error.length > 150 ? `${error.slice(0, 147)}...` : error;
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
    .deleteButton {
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
