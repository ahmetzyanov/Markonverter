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

  // src/shared/settings.ts
  function manualQuoteKey(productId, pickupPointId) {
    return `${productId}:${pickupPointId}`;
  }

  // src/shared/ozon-fixtures.ts
  var OZON_FIXTURE_STORE_KEY = "markonverter.ozonFixtures";
  var OZON_FIXTURE_STORE_VERSION = 1;
  var MAX_OZON_FIXTURE_RECORDS = 30;
  var MAX_OZON_FIXTURE_BODY_CHARS = 75e4;
  var MAX_OZON_FIXTURE_REQUEST_BODY_CHARS = 2e4;
  function emptyOzonFixtureStore() {
    return {
      version: OZON_FIXTURE_STORE_VERSION,
      records: []
    };
  }
  function createOzonFixtureRecord(input, now = /* @__PURE__ */ new Date()) {
    const url = cleanText(input.url, 3e3);
    const responseText = typeof input.responseText === "string" ? input.responseText : "";
    if (!isRelevantOzonFixtureUrl(url) || !responseText) {
      return null;
    }
    const responseLength = Number.isFinite(input.responseLength) && input.responseLength && input.responseLength > 0 ? Math.floor(input.responseLength) : responseText.length;
    const truncatedResponse = truncateText(responseText, MAX_OZON_FIXTURE_BODY_CHARS);
    const requestBody = input.requestBody ? truncateText(input.requestBody, MAX_OZON_FIXTURE_REQUEST_BODY_CHARS).text : void 0;
    const method = cleanText(input.method || "GET", 12).toUpperCase() || "GET";
    return {
      id: fixtureRecordId(method, url, responseLength, truncatedResponse.text),
      capturedAt: now.toISOString(),
      source: cleanText(input.source || "network", 80),
      method,
      url,
      status: sanitizeStatus(input.status),
      contentType: cleanText(input.contentType || "", 160),
      pageUrl: cleanText(input.pageUrl || "", 3e3),
      requestBody,
      responseText: truncatedResponse.text,
      responseLength,
      responseTruncated: truncatedResponse.truncated
    };
  }
  function appendOzonFixtureRecords(store, inputs, now = /* @__PURE__ */ new Date()) {
    const records = [...normalizeOzonFixtureStore(store).records];
    for (const input of inputs) {
      const record = createOzonFixtureRecord(input, now);
      if (!record) {
        continue;
      }
      const existingIndex = records.findIndex((existing) => existing.id === record.id);
      if (existingIndex >= 0) {
        records.splice(existingIndex, 1);
      }
      records.push(record);
    }
    return {
      version: OZON_FIXTURE_STORE_VERSION,
      records: records.slice(-MAX_OZON_FIXTURE_RECORDS)
    };
  }
  function normalizeOzonFixtureStore(value) {
    const candidate = value;
    const records = Array.isArray(candidate?.records) ? candidate.records.map(normalizeOzonFixtureRecord).filter((record) => Boolean(record)) : [];
    return {
      version: OZON_FIXTURE_STORE_VERSION,
      records: records.slice(-MAX_OZON_FIXTURE_RECORDS)
    };
  }
  function normalizeOzonFixtureRecord(value) {
    const candidate = value;
    if (!candidate || typeof candidate.responseText !== "string" || typeof candidate.url !== "string") {
      return null;
    }
    return createOzonFixtureRecord(
      {
        source: candidate.source || "network",
        method: candidate.method || "GET",
        url: candidate.url,
        status: candidate.status,
        contentType: candidate.contentType,
        pageUrl: candidate.pageUrl || "",
        requestBody: candidate.requestBody,
        responseText: candidate.responseText,
        responseLength: candidate.responseLength
      },
      parseDate(candidate.capturedAt) || /* @__PURE__ */ new Date()
    );
  }
  function isRelevantOzonFixtureUrl(url) {
    return /(?:^|\/\/)(?:[^/]+\.)?ozon\.(?:ru|kz)\//i.test(url) && /(composer-api|entrypoint-api|delivery|address|location|geo|pvz|pickup)/i.test(url);
  }
  function cleanText(value, maxLength) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
  }
  function truncateText(value, maxLength) {
    return value.length > maxLength ? {
      text: value.slice(0, maxLength),
      truncated: true
    } : {
      text: value,
      truncated: false
    };
  }
  function sanitizeStatus(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : void 0;
  }
  function fixtureRecordId(method, url, responseLength, responseText) {
    return `${method}:${url}:${responseLength}:${hashText(responseText.slice(0, 2e4))}`;
  }
  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
  function parseDate(value) {
    if (typeof value !== "string") {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // src/marketplaces/ozon/adapter.ts
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

  // src/marketplaces/wildberries/adapter.ts
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

  // src/marketplaces/ozon/private-api.ts
  async function fetchOzonPrivatePrice(request) {
    const productUrl = new URL(request.productUrl);
    const pathWithSearch = `${productUrl.pathname}${productUrl.search}`;
    const activation = request.allowSessionMutatingLocationActivation ? await activateOzonPickupLocation(pathWithSearch, request.pickupExternalLocationId) : { confirmed: false, aliases: [] };
    const acceptedLocationIds = normalizeLocationIds([request.pickupExternalLocationId, ...activation.aliases]);
    const candidates = buildEndpointCandidates(pathWithSearch, acceptedLocationIds, {
      includeLocationCandidates: request.allowSessionMutatingLocationActivation === true,
      includeSelectionCandidates: request.allowSessionMutatingLocationActivation === true
    });
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
        const location2 = inspectResponseLocation(json, acceptedLocationIds);
        if (location2.hasConflictingExplicitLocation && !location2.hasAcceptedExplicitLocation) {
          errors.push(`${candidate.label}: response did not confirm requested pickup point (confirmed a different pickup point)`);
          continue;
        }
        if (!location2.hasAcceptedLocation && !activation.confirmed) {
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
  async function activateOzonPickupLocation(pathWithSearch, pickupExternalLocationId) {
    const candidates = buildLocationActivationCandidates(pathWithSearch, pickupExternalLocationId);
    const aliases = /* @__PURE__ */ new Set();
    let confirmed = false;
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate.url, {
          method: candidate.method,
          credentials: "include",
          headers: candidate.headers,
          body: candidate.body
        });
        if (!response.ok) {
          continue;
        }
        const json = parseMaybeJson(await response.text());
        const activation = inspectActivationResponse(json, pickupExternalLocationId);
        confirmed ||= activation.confirmed;
        activation.aliases.forEach((alias) => aliases.add(alias));
      } catch {
      }
    }
    aliases.delete(pickupExternalLocationId);
    return {
      confirmed,
      aliases: [...aliases].slice(0, 6)
    };
  }
  function buildLocationActivationCandidates(pathWithSearch, pickupExternalLocationId) {
    const jsonHeaders = {
      "content-type": "application/json",
      "x-o3-app-name": "dweb_client",
      "x-o3-app-version": "release"
    };
    return buildLocationActivationModalVariants(pathWithSearch, pickupExternalLocationId).flatMap(({ label, modalPath }) => {
      const encodedModalPath = encodeURIComponent(modalPath);
      return [
        {
          label: `entrypoint-${label}`,
          method: "GET",
          url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedModalPath}`,
          headers: jsonHeaders
        },
        {
          label: `composer-${label}`,
          method: "GET",
          url: `/api/composer-api.bx/page/json/v2?url=${encodedModalPath}`,
          headers: jsonHeaders
        },
        {
          label: `entrypoint-post-${label}`,
          method: "POST",
          url: "/api/entrypoint-api.bx/page/json/v2",
          headers: jsonHeaders,
          body: JSON.stringify({
            url: modalPath,
            referer: pathWithSearch
          })
        },
        {
          label: `composer-post-${label}`,
          method: "POST",
          url: "/api/composer-api.bx/page/json/v2",
          headers: jsonHeaders,
          body: JSON.stringify({
            url: modalPath,
            referer: pathWithSearch
          })
        }
      ];
    });
  }
  function buildLocationActivationModalVariants(pathWithSearch, pickupExternalLocationId) {
    const encodedLocation = encodeURIComponent(pickupExternalLocationId);
    const encodedProductPath = encodeURIComponent(pathWithSearch);
    return [
      {
        label: "select-address-product-context",
        modalPath: `/modal/addressbook?select_address=${encodedLocation}&src_main=${encodedProductPath}&page_changed=true`
      },
      {
        label: "select-address-page-changed",
        modalPath: `/modal/addressbook?select_address=${encodedLocation}&page_changed=true`
      },
      {
        label: "select-address-legacy",
        modalPath: `/modal/addressbook?select_address=${encodedLocation}`
      }
    ];
  }
  function buildEndpointCandidates(pathWithSearch, pickupExternalLocationIds, options = {}) {
    const encodedUrl = encodeURIComponent(pathWithSearch);
    const locationIds = normalizeLocationIds(pickupExternalLocationIds);
    const jsonHeaders = {
      "content-type": "application/json",
      "x-o3-app-name": "dweb_client",
      "x-o3-app-version": "release"
    };
    return [
      {
        label: "composer-get-current-page",
        method: "GET",
        url: `/api/composer-api.bx/page/json/v2?url=${encodedUrl}`,
        headers: jsonHeaders
      },
      {
        label: "entrypoint-get-current-page",
        method: "GET",
        url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}`,
        headers: jsonHeaders
      },
      ...options.includeLocationCandidates ? locationIds.flatMap((pickupExternalLocationId) => {
        const encodedLocation = encodeURIComponent(pickupExternalLocationId);
        const deliveryCandidates = [
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
            label: "composer-post-delivery-address",
            method: "POST",
            url: "/api/composer-api.bx/page/json/v2",
            headers: jsonHeaders,
            body: JSON.stringify({
              url: pathWithSearch,
              deliveryAddressOid: pickupExternalLocationId
            })
          }
        ];
        const selectionCandidates = [
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
        return options.includeSelectionCandidates ? [...deliveryCandidates, ...selectionCandidates] : deliveryCandidates;
      }) : []
    ];
  }
  function normalizeLocationIds(pickupExternalLocationIds) {
    const rawIds = Array.isArray(pickupExternalLocationIds) ? pickupExternalLocationIds : [pickupExternalLocationIds];
    return [...new Set(rawIds.map((id) => id.trim()).filter(Boolean))];
  }
  function responseContainsAnyLocation(json, pickupExternalLocationIds) {
    return normalizeLocationIds(pickupExternalLocationIds).some((id) => responseContainsLocation(json, id));
  }
  function inspectResponseLocation(json, pickupExternalLocationIds) {
    const acceptedIds = normalizeLocationIds(pickupExternalLocationIds);
    let hasAcceptedExplicitLocation = false;
    let hasConflictingExplicitLocation = false;
    walk(json, [], (path, value) => {
      if (typeof value !== "string" && typeof value !== "number") {
        return;
      }
      const text = String(value).trim();
      if (!text || !isExplicitLocationConfirmationPath(path.join(".").toLowerCase())) {
        return;
      }
      if (acceptedIds.some((id) => text.includes(id))) {
        hasAcceptedExplicitLocation = true;
        return;
      }
      if (isLocationAlias(text)) {
        hasConflictingExplicitLocation = true;
      }
    });
    return {
      hasAcceptedLocation: responseContainsAnyLocation(json, acceptedIds),
      hasAcceptedExplicitLocation,
      hasConflictingExplicitLocation
    };
  }
  function inspectActivationResponse(json, pickupExternalLocationId) {
    const aliases = /* @__PURE__ */ new Set();
    let confirmed = false;
    walk(json, [], (path, value) => {
      if (typeof value !== "string" && typeof value !== "number") {
        return;
      }
      const text = String(value).trim();
      if (!text.includes(pickupExternalLocationId)) {
        return;
      }
      const joined = path.join(".").toLowerCase();
      if (!isExplicitLocationConfirmationPath(joined)) {
        return;
      }
      confirmed = true;
      scalarLocationAliasValues(path, value).forEach((alias) => aliases.add(alias));
    });
    walk(json, [], (path, value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return;
      }
      const localConfirmationValues = Object.entries(value).flatMap(
        ([key, child]) => scalarLocationValues([...path, key], child)
      );
      if (!localConfirmationValues.some((item) => item.includes(pickupExternalLocationId))) {
        return;
      }
      const entries = Object.entries(value);
      const hasSelectedFlag = entries.some(([key, child]) => isSelectionFlag(key, child));
      const selectedAliases = entries.flatMap(([key, child]) => scalarSelectedLocationAliasValues([...path, key], child));
      if (!hasSelectedFlag && selectedAliases.length === 0) {
        return;
      }
      confirmed = true;
      entries.flatMap(([key, child]) => scalarLocationAliasValues([...path, key], child)).forEach((item) => aliases.add(item));
    });
    aliases.delete(pickupExternalLocationId);
    return { confirmed, aliases: [...aliases] };
  }
  function scalarLocationValues(path, value) {
    if (typeof value !== "string" && typeof value !== "number" || !locationConfirmationPathScore(path.join(".").toLowerCase())) {
      return [];
    }
    return [String(value).trim()].filter(Boolean);
  }
  function scalarLocationAliasValues(path, value) {
    if (typeof value !== "string" && typeof value !== "number" || !locationAliasPathScore(path.join(".").toLowerCase())) {
      return [];
    }
    return [String(value).trim()].filter(isLocationAlias);
  }
  function scalarSelectedLocationAliasValues(path, value) {
    if (typeof value !== "string" && typeof value !== "number" || !isSelectedLocationPath(path.join(".").toLowerCase())) {
      return [];
    }
    return [String(value).trim()].filter(isLocationAlias);
  }
  function isLocationAlias(value) {
    return /^[a-z0-9_-]{4,120}$/i.test(value);
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
      if (!looksProductScoped || looksWrongKind || looksPresentationPriceMetadata(joined, key) || !key.includes("price") && typeof value !== "string") {
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
  function looksPresentationPriceMetadata(path, key) {
    if (/(^|\.)pricebadge(\.|$)/i.test(path)) {
      return true;
    }
    if (/(^|\.)(size|style|styletype|textstyle|font|typography|color|iconkey|iconcolor|theme|preset|trackinginfo)(\.|$)/i.test(path)) {
      return true;
    }
    return /(^|\.)(padding|margin|radius|width|height|layout|params)(\.|$)/i.test(path) && key !== "price";
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
  function locationAliasPathScore(path) {
    if (/(request|url|href|referrer|referer|query|param|tracking|analytics|debug|log|metrika|route)/i.test(path)) {
      return 0;
    }
    if (/(city|region|geo|coordinates|latitude|longitude)/i.test(path)) {
      return 0;
    }
    if (/(delivery|address|pickup|pickpoint|pvz|location)/i.test(path) && /(oid|id|uid)$/i.test(path)) {
      return 2;
    }
    if (/(selected|current|active|chosen)/i.test(path) && /(delivery|address|pickup|pickpoint|pvz|location)/i.test(path)) {
      return 1;
    }
    return 0;
  }
  function isExplicitLocationConfirmationPath(path) {
    if (/(request|url|href|referrer|referer|query|param|tracking|analytics|debug|log|metrika|route)/i.test(path)) {
      return false;
    }
    if (isSelectedLocationPath(path)) {
      return true;
    }
    if (/(addressbook|book|list|items|available|suggest|candidate)/i.test(path)) {
      return false;
    }
    return /(delivery|address|pickup|pickpoint|pvz|location)/i.test(path) && /(oid|id|uid)$/i.test(path);
  }
  function isSelectedLocationPath(path) {
    return /(selected|current|active|chosen)/i.test(path) && /(delivery|address|pickup|pickpoint|pvz|location)/i.test(path) && !/(request|url|href|referrer|referer|query|param|tracking|analytics|debug|log|metrika|route)/i.test(path);
  }
  function isSelectionFlag(key, value) {
    if (!/(selected|current|active|chosen)/i.test(key)) {
      return false;
    }
    return value === true || value === 1 || value === "true" || value === "selected" || value === "active";
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
    const text = value.trim();
    if (/^[a-z]+(?:_[a-z]+)*_\d+$/i.test(text)) {
      return null;
    }
    const currency = text.includes("\u20BD") || /руб|rub/i.test(text) ? "RUB" : text.includes("\u20B8") || /тг|тенге|kzt/i.test(text) ? "KZT" : currencyHint;
    if (!/\d[\d\s.,]{1,}/.test(text)) {
      return null;
    }
    const normalized = text.replace(/[^\d,.\s]/g, "").replace(/\s+/g, "").replace(",", ".");
    const amount = Number.parseFloat(normalized);
    return Number.isFinite(amount) ? { amount, currency, rawText: value } : null;
  }

  // src/content/panel/styles.ts
  function panelCss() {
    return `
    :host {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      container-type: inline-size;
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
      width: 100%;
      max-width: min(398px, calc(100vw - 24px));
      min-width: 0;
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
      max-width: min(246px, calc(100vw - 24px));
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
    .settingsButton {
      width: 32px;
      padding: 0;
      font-size: 17px;
      line-height: 1;
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
    .detailsButton,
    .confirmButton {
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
    .confirmButton.danger {
      border-color: var(--mk-danger);
      background: var(--mk-danger);
      color: #ffffff;
      font-weight: 750;
    }
    .saveSmallButton:disabled {
      border-color: var(--mk-border);
      color: var(--mk-quiet);
      cursor: default;
    }
    .panelConfirmation {
      display: grid;
      gap: 10px;
      padding: 12px 14px;
      border-top: 1px solid var(--mk-border);
      background: #151516;
    }
    .panelConfirmation.danger {
      box-shadow: inset 3px 0 0 var(--mk-danger);
    }
    .panelConfirmationText {
      min-width: 0;
    }
    .panelConfirmationText strong {
      display: block;
      color: var(--mk-text);
      font-size: 12px;
      font-weight: 730;
    }
    .panelConfirmationText span {
      display: block;
      margin-top: 3px;
      color: var(--mk-muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .panelConfirmationActions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      flex-wrap: wrap;
    }
    .pointManagerHint {
      margin: 0;
      color: var(--mk-muted);
      font-size: 12px;
    }
    .fixtureTools {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 14px;
      border-top: 1px solid var(--mk-border);
      background: #101011;
    }
    .fixtureToolsText {
      min-width: 0;
      flex: 1 1 auto;
    }
    .fixtureToolsText strong {
      display: block;
      color: var(--mk-text);
      font-size: 12px;
      font-weight: 730;
    }
    .fixtureToolsText span {
      display: block;
      color: var(--mk-muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .fixtureToolsText .fixtureError {
      color: #fca5a5;
    }
    .fixtureToolsActions {
      display: flex;
      flex: 0 0 auto;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
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
    @container (max-width: 330px) {
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

  // src/content/page/visible-price.ts
  function extractVisibleOzonPrice(currencyHint) {
    const selectors = ['[data-widget="webPrice"]', '[data-widget*="webPrice" i]', '[data-widget*="price" i]'];
    const seen = /* @__PURE__ */ new Set();
    const candidates = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (seen.has(element) || !isVisibleEnough(element)) {
          return;
        }
        seen.add(element);
        const text = compactText2(element.innerText || element.textContent || "");
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
      ...deliveryText ? { deliveryText } : {}
    };
  }
  function parseVisiblePriceCandidates(text, currencyHint) {
    const candidates = [];
    const pricePattern = /(\d[\d\s\u00a0]{1,14}(?:[,.]\d{1,2})?)\s*(₽|руб\.?|рублей|RUB|₸|тг|тенге|KZT)?/gi;
    let match;
    let index = 0;
    while (match = pricePattern.exec(text)) {
      const rawAmount = match[1];
      const amount = Number.parseFloat(rawAmount.replace(/[\s\u00a0]/g, "").replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e8) {
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
  function parseCurrencyMarker(value, fallback) {
    if (/₽|руб|RUB/i.test(value)) {
      return "RUB";
    }
    if (/₸|тг|тенге|KZT/i.test(value)) {
      return "KZT";
    }
    return fallback;
  }
  function extractVisibleDeliverySummary() {
    const selectors = ['[data-widget*="delivery" i]', '[data-widget*="address" i]'];
    for (const selector of selectors) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (!isVisibleEnough(element)) {
          continue;
        }
        const text = cleanDeliverySummaryText(element);
        if (text && text.length <= 160 && /(сегодня|завтра|достав|получ|today|tomorrow|delivery|\d)/i.test(text)) {
          return text;
        }
      }
    }
    return null;
  }
  function isVisibleEnough(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 20 && rect.height > 8 && rect.bottom > 0 && rect.right > 0;
  }
  function cleanDeliverySummaryText(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll("button, [role='button']").forEach((node) => node.remove());
    return stripActionText(compactText2(clone.innerText || clone.textContent || ""));
  }
  function stripActionText(text) {
    return compactText2(
      text.replace(/(?:^|[\s,;|•·-])(?:Редактировать|Изменить|Удалить|Edit|Delete|Remove)(?=$|[\s,;|•·-])/giu, " ")
    );
  }
  function compactText2(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  // src/marketplaces/ozon/pickup-capture.ts
  var STRONG_ID_KEYS = /* @__PURE__ */ new Set([
    "deliveryAddressOid",
    "deliveryAddressId",
    "deliveryAddressUid",
    "addressOid",
    "addressId",
    "addressUid",
    "selectAddress",
    "select_address",
    "locationUid",
    "pickupPointId",
    "pickPointId",
    "pvzId",
    "pointId"
  ]);
  var WEAK_ID_KEYS = /* @__PURE__ */ new Set(["locationId", "cityId", "geoId", "regionId"]);
  var RELEVANCE_RE = /(delivery|address|pickup|pickpoint|pvz|пвз|пункт|получ|достав|location|geo|city|region)/i;
  var BAD_ID_RE = /(product|sku|item|seller|brand|category|image|price|cart|widget|layout|session|fingerprint|analytics|banner)/i;
  var SERVICE_LABEL_RE = /(?:^|[\s,{])\\?["']?(?:url|href|action|layoutId|layoutVersion|pageType|ruleId|referer|referrer|widgetStates?|analytics|tracking|component|state|params?|query)\\?["']?\s*[:=]/i;
  var TECHNICAL_LABEL_RE = /^(?:api|network|content)\.[a-z0-9._/?=&%-]+$/i;
  var TECHNICAL_ENDPOINT_LABEL_RE = /\b(?:composer|entrypoint)(?:-[a-z0-9]+)*-(?:addressbook|delivery|geo)\b/i;
  var UI_ACTION_LABEL_RE = /^(?:удалить|редактировать|изменить|delete|remove|add|save|saved|edit|options|hide|open|refresh pvz|show in panel)$/i;
  var BARE_OZON_POINT_LABEL_RE = /^пункт\s+ozon(?:\s*[•·|,;:.-]+)?$/i;
  var KZ_RE = /(kazakhstan|казахстан|kz\b|алматы|астана|караганда|шымкент|атырау|актобе|павлодар|усть-каменогорск)/i;
  var RU_RE = /(russia|россия|ru\b|москва|санкт-петербург|екатеринбург|казань|новосибирск|краснодар)/i;
  function extractOzonPickupCandidatesFromSources(sources) {
    const candidates = [];
    for (const source of sources) {
      const labelText = `${source.source} ${source.urlHint || ""}`;
      const context = {
        relevanceText: `${labelText} ${source.textHint || ""}`,
        labelText,
        sameDomLabelText: `${labelText} ${source.textHint || ""}`,
        textHint: source.textHint || ""
      };
      collectFromUnknown(parseMaybeJson2(source.value), source.source, context, candidates);
      if (typeof source.value === "string") {
        collectFromText(source.value, source.source, context, candidates);
      }
    }
    return dedupeCandidates2(candidates).sort((a, b) => b.score - a.score);
  }
  function isGenericOzonPickupName(name, externalLocationId) {
    const label = compact(name);
    const id = compact(externalLocationId);
    if (!label) {
      return true;
    }
    if (id && label.toLowerCase() === id.toLowerCase()) {
      return true;
    }
    if (/^[a-z0-9_-]{4,80}$/i.test(label)) {
      return true;
    }
    if (/^ozon pickup [a-z0-9_-]{4,80}$/i.test(label)) {
      return true;
    }
    if (id && label.toLowerCase() === `pickup ${id}`.toLowerCase()) {
      return true;
    }
    return isUnsafeOzonPickupName(label, id);
  }
  function shouldReplaceOzonPickupCandidate(existing, candidate) {
    if (isUnsafeOzonPickupName(candidate.name, candidate.externalLocationId)) {
      return false;
    }
    if (isUnsafeOzonPickupName(existing.name, existing.externalLocationId)) {
      return true;
    }
    const existingLabelScore = scorePickupLabel(existing.name, existing.externalLocationId);
    const candidateLabelScore = scorePickupLabel(candidate.name, candidate.externalLocationId);
    if (candidateLabelScore > existingLabelScore && candidate.score >= existing.score - 35) {
      return true;
    }
    if (candidateLabelScore < existingLabelScore && isGenericOzonPickupName(candidate.name, candidate.externalLocationId)) {
      return false;
    }
    if (candidate.score > existing.score) {
      return true;
    }
    return candidate.score === existing.score && candidateLabelScore >= existingLabelScore && candidate.name.length > existing.name.length;
  }
  function shouldUseOzonPickupName(currentName, candidateName, externalLocationId) {
    if (isUnsafeOzonPickupName(currentName, externalLocationId) && isCanonicalGenericOzonPickupName(candidateName, externalLocationId)) {
      return true;
    }
    return isGenericOzonPickupName(currentName, externalLocationId) && scorePickupLabel(candidateName, externalLocationId) > scorePickupLabel(currentName, externalLocationId);
  }
  function safeOzonPickupName(name, externalLocationId) {
    const label = compact(name);
    if (label && !isUnsafeOzonPickupName(label, externalLocationId)) {
      return label;
    }
    return externalLocationId ? `Ozon pickup ${externalLocationId}` : "Ozon pickup";
  }
  function collectFromUnknown(value, source, context, candidates, path = [], depth = 0) {
    if (depth > 8 || value == null) {
      return;
    }
    if (typeof value === "string") {
      const parsed = parseMaybeJson2(value);
      if (parsed !== value) {
        collectFromUnknown(parsed, source, context, candidates, path, depth + 1);
      } else {
        collectFromText(value, source, context, candidates);
      }
      return;
    }
    if (Array.isArray(value)) {
      collectFromOrderedPickupArray(value, source, context, candidates);
      value.slice(0, 150).forEach((item, index) => {
        collectFromUnknown(item, source, context, candidates, [...path, String(index)], depth + 1);
      });
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    const object = value;
    collectFromObject(object, source, context, path, candidates);
    for (const [key, child] of Object.entries(object).slice(0, 250)) {
      collectFromUnknown(child, source, context, candidates, [...path, key], depth + 1);
    }
  }
  function collectFromObject(object, source, context, path, candidates) {
    const keys = Object.keys(object);
    const pathText = [...path, ...keys].join(".");
    const relevantObject = RELEVANCE_RE.test(pathText) || RELEVANCE_RE.test(context.relevanceText);
    const objectText = objectStrings(object).join(" ");
    const name = extractName(object, context.labelText);
    const country = inferCountry(`${context.relevanceText} ${objectText}`);
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
      const bestName = name || extractNameNearId(context.labelText, id, context.labelText.indexOf(id));
      candidates.push({
        externalLocationId: id,
        name: bestName || `Ozon pickup ${id}`,
        country,
        currency,
        source,
        score: keyScore + (relevantObject ? 20 : 0) + (bestName ? 10 : 0) + (country === "KZ" ? 2 : 0),
        comment: `Captured from ${source}`
      });
    }
  }
  function collectFromText(text, source, context, candidates) {
    if (!RELEVANCE_RE.test(`${source} ${context.relevanceText} ${text.slice(0, 2e3)}`)) {
      return;
    }
    const patterns = [
      /(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'=:\s]+([a-z0-9_-]{4,80})/gi,
      /(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'\s]*[:=]["'\s]*([a-z0-9_-]{4,80})/gi,
      /[?&](?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)=([a-z0-9_-]{4,80})/gi
    ];
    for (const pattern of patterns) {
      let match;
      while (match = pattern.exec(text)) {
        const id = normalizeId(match[1]);
        if (!id) {
          continue;
        }
        const country = inferCountry(`${context.relevanceText} ${text.slice(Math.max(0, match.index - 200), match.index + 300)}`);
        const name = extractNameNearId(text, id, match.index) || extractNameNearId(context.labelText, id, context.labelText.indexOf(id)) || extractSameDomSourceLabel(source, context.sameDomLabelText, id);
        candidates.push({
          externalLocationId: id,
          name: name || `Ozon pickup ${id}`,
          country,
          currency: country === "KZ" ? "KZT" : "RUB",
          source,
          score: 35 + (name ? 30 : 0),
          comment: `Captured from ${source}`
        });
      }
    }
  }
  function collectFromOrderedPickupArray(value, source, context, candidates) {
    const labels = orderedPickupLabelsInText(context.textHint).map((label) => ({
      label,
      pointNumber: extractOzonPointNumber(label)
    }));
    if (labels.length < 2) {
      return;
    }
    const entries = orderedPickupEntriesFromArray(value);
    if (entries.length < 2 || entries.length < labels.length) {
      return;
    }
    const uniqueIds = new Set(entries.map((entry) => entry.externalLocationId));
    const uniqueLabels = new Set(labels.map((label) => compact(label.label).toLowerCase()));
    if (uniqueIds.size !== entries.length || uniqueLabels.size !== labels.length) {
      return;
    }
    const mappings = orderedPickupLabelMappings(entries, labels);
    mappings.forEach(({ entry, label }) => {
      const name = label.label;
      if (isUnsafeOzonPickupName(name, entry.externalLocationId)) {
        return;
      }
      const country = inferCountry(`${context.relevanceText} ${name}`);
      candidates.push({
        externalLocationId: entry.externalLocationId,
        name,
        country,
        currency: country === "KZ" ? "KZT" : "RUB",
        source,
        score: 85,
        comment: `Captured from ordered Ozon selector rows in ${source}`
      });
    });
  }
  function orderedPickupLabelMappings(entries, labels) {
    const mappings = [];
    const usedEntries = /* @__PURE__ */ new Set();
    const usedLabels = /* @__PURE__ */ new Set();
    const labelIndexesByNumber = /* @__PURE__ */ new Map();
    labels.forEach((label, index) => {
      if (!label.pointNumber) {
        return;
      }
      labelIndexesByNumber.set(label.pointNumber, [...labelIndexesByNumber.get(label.pointNumber) || [], index]);
    });
    entries.forEach((entry, entryIndex) => {
      if (!entry.pointNumber) {
        return;
      }
      const labelIndexes = labelIndexesByNumber.get(entry.pointNumber);
      if (!labelIndexes || labelIndexes.length !== 1) {
        return;
      }
      const labelIndex = labelIndexes[0];
      mappings.push({ entry, label: labels[labelIndex] });
      usedEntries.add(entryIndex);
      usedLabels.add(labelIndex);
    });
    const remainingEntries = entries.filter((_entry, index) => !usedEntries.has(index));
    const remainingLabels = labels.filter((_label, index) => !usedLabels.has(index));
    if (remainingLabels.length === 0) {
      return mappings;
    }
    if (remainingEntries.length === remainingLabels.length) {
      remainingEntries.forEach((entry, index) => {
        mappings.push({ entry, label: remainingLabels[index] });
      });
      return mappings;
    }
    if (mappings.length > 0) {
      return mappings;
    }
    if (entries.length > labels.length && labels.every((label) => label.pointNumber)) {
      return labels.map((label, index) => ({ entry: entries[index], label }));
    }
    return [];
  }
  function orderedPickupEntriesFromArray(value) {
    const entries = [];
    for (const item of value.slice(0, 150)) {
      const text = valueSearchText(item);
      if (!text || !RELEVANCE_RE.test(text)) {
        continue;
      }
      const ids = orderedPickupIdsInText(text);
      if (ids.length === 0) {
        continue;
      }
      if (ids.length > 1) {
        return [];
      }
      const id = ids[0];
      const ownName = extractNameNearId(text, id, text.indexOf(id));
      if (scorePickupLabel(ownName, id) >= 5) {
        continue;
      }
      const pointNumber = extractOzonPointNumber(`${ownName} ${text.slice(0, 800)}`);
      entries.push({ externalLocationId: id, pointNumber });
    }
    return entries;
  }
  function valueSearchText(value) {
    if (typeof value === "string") {
      return value;
    }
    if (value == null) {
      return "";
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  function extractSameDomSourceLabel(source, sourceText, externalLocationId) {
    return /^(?:content\.current-delivery|dom\.ozon-delivery-row)$/i.test(source) ? extractUsefulLabel(sourceText, externalLocationId) : "";
  }
  function orderedPickupIdsInText(text) {
    const ids = [];
    for (const pattern of pickupIdPatterns()) {
      let match;
      while (match = pattern.exec(text)) {
        const id = normalizeId(match[1]);
        if (id && !ids.includes(id)) {
          ids.push(id);
        }
      }
    }
    return ids;
  }
  function orderedPickupLabelsInText(text) {
    const labels = [];
    for (const rawLabel of extractOzonPointLabels(selectorLabelScope(text))) {
      const label = pickBestLabel([rawLabel], "");
      if (label && !labels.some((item) => compact(item).toLowerCase() === compact(label).toLowerCase())) {
        labels.push(label);
      }
    }
    return labels;
  }
  function selectorLabelScope(text) {
    const marker = text.search(
      /(?:выберите\s+(?:пункт|адрес)|выбор\s+(?:пункта|адреса|способа)|куда\s+доставить|delivery selector|select address)/i
    );
    return marker >= 0 ? text.slice(marker) : text;
  }
  function extractOzonPointNumber(text) {
    return compact(text.match(/(?:№|N[°o.]?)\s*([\d-]{3,})/i)?.[1] || "");
  }
  function pickupIdPatterns() {
    return [
      /(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'=:\s]+([a-z0-9_-]{4,80})/gi,
      /(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'\s]*[:=]["'\s]*([a-z0-9_-]{4,80})/gi,
      /[?&](?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)=([a-z0-9_-]{4,80})/gi
    ];
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
      "subtitle",
      "description",
      "caption",
      "text",
      "name",
      "title",
      "city"
    ];
    for (const key of exactKeys) {
      const value = stringValue(object[key]);
      const label = value ? extractUsefulLabel(value, "") : "";
      if (label) {
        return label;
      }
    }
    for (const [key, rawValue] of Object.entries(object)) {
      const value = stringValue(rawValue);
      const label = value ? extractUsefulLabel(value, "") : "";
      if (label && /(address|name|title|city|street|пвз|пункт)/i.test(key)) {
        return label;
      }
    }
    const sourceLabel = sourceText.match(/(?:пункт выдачи|пвз|pickup point|адрес)[:\s-]+([^|]{8,120})/i)?.[1];
    return sourceLabel ? extractUsefulLabel(sourceLabel, "") : "";
  }
  function extractNameNearId(text, id, matchIndex) {
    if (!text || matchIndex < 0) {
      return "";
    }
    const start = Math.max(0, matchIndex - 600);
    const end = Math.min(text.length, matchIndex + id.length + 900);
    const snippet = decodeTextSnippet(text.slice(start, end));
    const localIdIndex = snippet.indexOf(id);
    const scopedText = localIdIndex >= 0 ? textScopeNearId(snippet, localIdIndex, id) : snippet;
    const labels = [];
    const structuredLabels = extractStructuredLabels(scopedText);
    const scopedTextIsJson = isJsonLikeSnippet(scopedText);
    labels.push(...structuredLabels);
    labels.push(...extractOzonPointLabels(scopedText));
    if (localIdIndex >= 0) {
      if (scopedText.includes("<") || structuredLabels.length === 0 && !scopedTextIsJson) {
        labels.push(stripMarkup(scopedText));
      }
      const scopedIdIndex = scopedText.indexOf(id);
      if (scopedIdIndex >= 0 && structuredLabels.length === 0 && !scopedTextIsJson) {
        labels.push(stripMarkup(scopedText.slice(scopedIdIndex + id.length)));
      }
    }
    return pickBestLabel(labels, id);
  }
  function textScopeNearId(text, idIndex, id) {
    const tagStart = text.lastIndexOf("<", idIndex);
    const openingTagEnd = text.indexOf(">", idIndex + id.length);
    const closingTagStart = openingTagEnd >= 0 ? text.indexOf("</", openingTagEnd) : -1;
    const closingTagEnd = closingTagStart >= 0 ? text.indexOf(">", closingTagStart) : -1;
    if (tagStart >= 0 && openingTagEnd >= 0 && closingTagStart > openingTagEnd && closingTagEnd > closingTagStart) {
      return text.slice(tagStart, closingTagEnd + 1);
    }
    const objectStart = text.lastIndexOf("{", idIndex);
    const objectEnd = text.indexOf("}", idIndex + id.length);
    const jsonScope = jsonScopeNearId(text, idIndex);
    if (jsonScope) {
      return jsonScope;
    }
    if (objectStart >= 0 && objectEnd > idIndex) {
      return text.slice(objectStart, objectEnd + 1);
    }
    const itemStart = Math.max(
      0,
      Math.max(text.lastIndexOf("\n", idIndex), text.lastIndexOf("|", idIndex), text.lastIndexOf("</", idIndex))
    );
    const nextBreaks = [text.indexOf("\n", idIndex + id.length), text.indexOf("|", idIndex + id.length), text.indexOf("<", idIndex + id.length)].filter((index) => index >= 0).sort((a, b) => a - b);
    const itemEnd = nextBreaks[0] ?? Math.min(text.length, idIndex + id.length + 320);
    return text.slice(itemStart, itemEnd);
  }
  function jsonScopeNearId(text, idIndex) {
    const starts = [];
    let start = text.lastIndexOf("{", idIndex);
    while (start >= 0 && starts.length < 8 && idIndex - start < 2500) {
      starts.push(start);
      start = text.lastIndexOf("{", start - 1);
    }
    const scopes = starts.map((scopeStart) => {
      const scopeEnd = findMatchingBrace(text, scopeStart);
      return scopeEnd > idIndex ? text.slice(scopeStart, scopeEnd + 1) : "";
    }).filter(Boolean).sort((a, b) => a.length - b.length);
    const scopedToSinglePickup = scopes.filter((scope) => countPickupIdsInText(scope) <= 1);
    return scopedToSinglePickup.find((scope) => extractStructuredLabels(scope).some((label) => isUsefulLabel(compact(label)))) || scopedToSinglePickup[0] || "";
  }
  function findMatchingBrace(text, start) {
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote) {
        if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = "";
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
    }
    return -1;
  }
  function extractStructuredLabels(text) {
    const labels = [];
    const pattern = /(?:fullAddress|formattedAddress|addressText|shortAddress|displayName|address|subtitle|description|caption|title|name|city|street|text)["'\s]*[:=]\s*["']([^"']{3,260})/gi;
    let match;
    while (match = pattern.exec(text)) {
      if (match.index > 0 && /[\w-]/.test(text[match.index - 1] || "")) {
        continue;
      }
      labels.push(match[1]);
    }
    const attributePattern = /(?:aria-label|title|data-address|data-title)=["']([^"']{3,260})/gi;
    while (match = attributePattern.exec(text)) {
      labels.push(match[1]);
    }
    return labels;
  }
  function countPickupIdsInText(text) {
    const ids = /* @__PURE__ */ new Set();
    const patterns = [
      /(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'=:\s]+([a-z0-9_-]{4,80})/gi,
      /(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'\s]*[:=]["'\s]*([a-z0-9_-]{4,80})/gi,
      /[?&](?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)=([a-z0-9_-]{4,80})/gi
    ];
    for (const pattern of patterns) {
      let match;
      while (match = pattern.exec(text)) {
        const id = normalizeId(match[1]);
        if (id) {
          ids.add(id);
        }
      }
    }
    return ids.size;
  }
  function extractOzonPointLabels(text) {
    const labels = [];
    const pattern = /Пункт\s+Ozon\s*№\s*[\d-]+(?:(?!Пункт\s+Ozon\s*№|Срок\s+хранения|Добавить\s+адрес|Дом\s)[^|<>{}\[\]\n\r]){0,170}/gi;
    let match;
    while (match = pattern.exec(text)) {
      labels.push(match[0]);
    }
    return labels;
  }
  function pickBestLabel(labels, externalLocationId) {
    let best = "";
    let bestScore = 0;
    for (const rawLabel of labels) {
      const label = cleanLabel(rawLabel, externalLocationId);
      if (!label || !isUsefulLabel(label)) {
        continue;
      }
      const score = scorePickupLabel(label, externalLocationId);
      if (score > bestScore || score === bestScore && label.length > best.length && label.length <= 180) {
        best = label;
        bestScore = score;
      }
    }
    return best;
  }
  function extractUsefulLabel(value, externalLocationId) {
    return pickBestLabel([value, ...extractOzonPointLabels(value)], externalLocationId);
  }
  function cleanLabel(value, externalLocationId) {
    let withoutMarkup = stripMarkup(decodeTextSnippet(value));
    if (externalLocationId) {
      withoutMarkup = withoutMarkup.replace(new RegExp(externalLocationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
    }
    withoutMarkup = withoutMarkup.replace(/(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)\s*[:=]?\s*/gi, " ").replace(/(?:fullAddress|formattedAddress|addressText|shortAddress|displayName|address|subtitle|description|caption|title|name|city|street|text)\\?["']?\s*[:=]\s*\\?["']?/gi, " ").replace(/https?:\/\/\S+/gi, " ").replace(/\/modal\/addressbook\S*/gi, " ").replace(/^\s*(?:content\.current-delivery|dom\.ozon-delivery-row)\s+/i, " ").replace(/^\s*(?:доставка\s+и\s+возврат|доставка|способ\s+получения|адрес\s+доставки)\s+/i, " ").replace(/(?:пункты\s+выдачи\s+ozon|срок\s+хранения\s+заказа|со\s+склада\s+продавца|с\s+\d{1,2}\s+[а-я]+|сегодня|завтра|редактировать|изменить).*$/i, " ").replace(/\\[nrt]/gi, " ");
    return compact(withoutMarkup).replace(/^[\s"'=:,;{}()[\]<>.-]+/, "").replace(/[\s"'=:,;{}()[\]<>.-]+$/, "");
  }
  function decodeTextSnippet(value) {
    return value.replace(/\\u([\da-f]{4})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16))).replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/&quot;/gi, '"').replace(/&amp;/gi, "&").replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16))).replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number.parseInt(code, 10)));
  }
  function stripMarkup(value) {
    return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  }
  function isJsonLikeSnippet(value) {
    return /^\s*[{[]/.test(value) || /["'][a-z][\w-]*["']\s*:/i.test(value) || SERVICE_LABEL_RE.test(value);
  }
  function inferCountry(text) {
    if (/https?:\/\/(?:[^/]+\.)?ozon\.kz\b/i.test(text) || /\bozon\.kz\b/i.test(text)) {
      return "KZ";
    }
    if (/https?:\/\/(?:[^/]+\.)?ozon\.ru\b/i.test(text) || /\bozon\.ru\b/i.test(text)) {
      return "RU";
    }
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
    if (/^(?:null|undefined|none|true|false)$/i.test(trimmed)) {
      return "";
    }
    return /^[a-z0-9_-]{4,80}$/i.test(trimmed) ? trimmed : "";
  }
  function stringValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }
  function isUsefulLabel(value) {
    const ozonPointMatches = value.match(/Пункт\s+Ozon\s*№/gi);
    return value.length >= 3 && value.length <= 180 && !SERVICE_LABEL_RE.test(value) && !/\b(?:layoutId|layoutVersion|pageType|ruleId|referer|referrer|widgetStates?)\b/i.test(value) && !TECHNICAL_LABEL_RE.test(value) && !TECHNICAL_ENDPOINT_LABEL_RE.test(value) && !UI_ACTION_LABEL_RE.test(value) && !BARE_OZON_POINT_LABEL_RE.test(value) && !/%[0-9a-f]{2}/i.test(value) && !/\\?["'][,;]\\?["']/.test(value) && (value.match(/["']?[a-z][\w-]*["']?\s*[:=]/gi)?.length || 0) < 2 && !/^(url|href|action|items?|widgetStates?|addressbook|delivery|address|title|name|subtitle)$/i.test(value) && !/^[a-z0-9_-]{4,80}$/i.test(value) && !/^ozon pickup [a-z0-9_-]{4,80}$/i.test(value) && (ozonPointMatches?.length || 0) <= 1;
  }
  function isUnsafeOzonPickupName(name, externalLocationId) {
    const label = compact(name);
    if (!label || isCanonicalGenericOzonPickupName(label, externalLocationId)) {
      return false;
    }
    return !isUsefulLabel(label);
  }
  function isCanonicalGenericOzonPickupName(name, externalLocationId) {
    const label = compact(name);
    const id = compact(externalLocationId);
    if (!id) {
      return false;
    }
    return label.toLowerCase() === id.toLowerCase() || label.toLowerCase() === `pickup ${id}`.toLowerCase() || label.toLowerCase() === `ozon pickup ${id}`.toLowerCase();
  }
  function compact(value) {
    return value.replace(/\s+/g, " ").trim();
  }
  function scorePickupLabel(name, externalLocationId) {
    const label = compact(name);
    if (isGenericOzonPickupName(label, externalLocationId) || !isUsefulLabel(label)) {
      return 0;
    }
    let score = 1;
    if (/пункт\s+ozon\s*№|pvz|pickup point/i.test(label)) {
      score += 1;
    }
    if (/[,\d]/.test(label)) {
      score += 1;
    }
    if (/(ул\.?|улица|пр-кт|проспект|шоссе|пер\.?|переулок|дом|д\.|street|avenue|road)/i.test(label)) {
      score += 2;
    }
    if (/(москва|санкт-петербург|екатеринбург|казань|новосибирск|краснодар|алматы|астана|караганда|шымкент|атырау|актобе|павлодар|буинск)/i.test(label)) {
      score += 2;
    }
    return score;
  }
  function dedupeCandidates2(candidates) {
    const byId = /* @__PURE__ */ new Map();
    for (const candidate of candidates) {
      const existing = byId.get(candidate.externalLocationId);
      if (!existing || shouldReplaceOzonPickupCandidate(existing, candidate)) {
        byId.set(candidate.externalLocationId, candidate);
      }
    }
    return [...byId.values()];
  }

  // src/content/app.ts
  var PANEL_ID = "markonverter-panel-root";
  var PANEL_CONFIRMATION_ID = "markonverter-panel-confirmation";
  var MENU_ASSIST_ID = "markonverter-ozon-delivery-assist";
  var MENU_ASSIST_STYLE_ID = "markonverter-ozon-delivery-assist-style";
  var PAGE_ACTION_SELECTOR = "[data-markonverter-page-action]";
  var COLLECT_PICKUP_EVENT = "markonverter:collect-ozon-pickup";
  var PICKUP_CANDIDATES_EVENT = "markonverter:ozon-pickup-candidates";
  var NETWORK_FIXTURE_EVENT = "markonverter:ozon-network-fixture";
  var PANEL_STATE_KEY = "markonverter.panelState";
  var AUTOMATIC_OZON_PRICE_LOOKUP_DISABLED = "Automatic Ozon price lookup is disabled because it can change the selected Ozon pickup point. Select this point in Ozon, wait for the visible product price, then use Capture current.";
  var activeUrl = "";
  var activeRun = 0;
  var latestPickupCandidates = [];
  var latestSettings = null;
  var settingsLoadPromise = null;
  var pickupApiDiscoveryKey = "";
  var pickupApiDiscoveryPromise = null;
  var lastPanelModel = null;
  var captureStatus = null;
  var fixtureStatus = null;
  var ozonFixtureCount = 0;
  var fixtureFlushTimer = null;
  var pendingFixtureInputs = [];
  var isPanelCollapsed = false;
  var panelRecoveryTimer = null;
  var assistSyncTimer = null;
  var savedPickupNameSyncTimer = null;
  var pendingPanelConfirmationCancel = null;
  var suppressAssistObserverUntil = 0;
  var targetedPickupDiscoveryIds = /* @__PURE__ */ new Set();
  var pageActionHandlers = /* @__PURE__ */ new WeakMap();
  var autoCaptureInFlight = /* @__PURE__ */ new Set();
  var pageActionEventGuardInstalled = false;
  async function boot() {
    document.addEventListener(PICKUP_CANDIDATES_EVENT, handlePickupCandidatesEvent);
    document.addEventListener(NETWORK_FIXTURE_EVENT, handleNetworkFixtureEvent);
    if (document.readyState === "loading") {
      await new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
    }
    await loadPanelState();
    await refreshOzonFixtureSummary();
    installOzonDeliveryMenuAssist();
    installPanelRecovery();
    await runIfProductPage();
    setInterval(() => {
      if (location.href !== activeUrl || shouldRestoreProductPanel()) {
        void runIfProductPage();
      }
    }, 1e3);
  }
  function installPanelRecovery() {
    const observer = new MutationObserver(schedulePanelRecovery);
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  function schedulePanelRecovery() {
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
  function shouldRestoreProductPanel() {
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
  async function runIfProductPage() {
    const currentUrl = location.href;
    const pageChanged = currentUrl !== activeUrl;
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
    if (pageChanged) {
      targetedPickupDiscoveryIds.clear();
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
    let settings = settingsResponse.settings;
    latestSettings = settings;
    discoverOzonPickupCandidatesFromApi(product);
    mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
    settings = await repairUnsafeSavedPickupNames(settings);
    settings = await autoCaptureCurrentVisibleQuote(product, settings);
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
    const results = [];
    for (const pickupPoint of pickupPoints) {
      if (runId !== activeRun) {
        return;
      }
      const manualQuote = settings.manualQuotes[manualQuoteKey(product.productId, pickupPoint.id)];
      if (manualQuote) {
        results.push(
          makeSuccessResult(
            pickupPoint.id,
            {
              ...manualQuote.quote,
              source: "manual",
              capturedAt: manualQuote.capturedAt
            },
            settings.defaultCurrency,
            settings
          )
        );
      } else {
        results.push(makeErrorResult(pickupPoint.id, AUTOMATIC_OZON_PRICE_LOOKUP_DISABLED));
      }
    }
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
      if (mergePickupCandidates(candidates)) {
        renderLastPanel();
        scheduleOzonDeliveryAssistSync();
      }
    } catch {
    }
  }
  function handleNetworkFixtureEvent(event) {
    const detail = event.detail;
    if (!detail) {
      return;
    }
    try {
      const input = JSON.parse(detail);
      if (!isNetworkFixtureInput(input)) {
        return;
      }
      pendingFixtureInputs.push(input);
      scheduleFixtureFlush();
    } catch {
    }
  }
  function isNetworkFixtureInput(value) {
    const candidate = value;
    return Boolean(candidate) && typeof candidate?.source === "string" && typeof candidate.method === "string" && typeof candidate.url === "string" && typeof candidate.pageUrl === "string" && typeof candidate.responseText === "string";
  }
  function scheduleFixtureFlush() {
    if (fixtureFlushTimer !== null) {
      return;
    }
    fixtureFlushTimer = window.setTimeout(() => {
      fixtureFlushTimer = null;
      void flushPendingFixtures();
    }, 500);
  }
  async function flushPendingFixtures() {
    if (pendingFixtureInputs.length === 0) {
      return;
    }
    const inputs = pendingFixtureInputs.splice(0, pendingFixtureInputs.length);
    try {
      const store = appendOzonFixtureRecords(await readOzonFixtureStore(), inputs);
      await chrome.storage.local.set({ [OZON_FIXTURE_STORE_KEY]: store });
      ozonFixtureCount = store.records.length;
      renderLastPanel();
    } catch {
      pendingFixtureInputs.unshift(...inputs);
    }
  }
  function mergePickupCandidates(candidates) {
    const previousKey = pickupCandidateListKey(latestPickupCandidates);
    const byId = new Map(latestPickupCandidates.map((candidate) => [candidate.externalLocationId, candidate]));
    for (const candidate of candidates) {
      if (!candidate.externalLocationId || !candidate.name) {
        continue;
      }
      const existing = byId.get(candidate.externalLocationId);
      if (!existing || shouldReplaceOzonPickupCandidate(existing, candidate)) {
        byId.set(candidate.externalLocationId, candidate);
      }
    }
    latestPickupCandidates = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 20);
    const changed = pickupCandidateListKey(latestPickupCandidates) !== previousKey;
    if (changed) {
      scheduleSavedPickupNameSync();
      scheduleGenericPickupNameDiscovery();
    }
    return changed;
  }
  function pickupCandidateListKey(candidates) {
    return candidates.map((candidate) => `${candidate.externalLocationId}:${candidate.name}:${candidate.score}`).join("|");
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
    sources.push(...collectCurrentDeliveryPickupSources(urlHint));
    const deliveryText = collectDeliveryText();
    if (deliveryText) {
      sources.push({ source: "content.dom", value: deliveryText, textHint: deliveryText, urlHint });
    }
    return sources;
  }
  function discoverOzonPickupCandidatesFromApi(product) {
    const key = `${location.origin}:${product.productId}:${location.pathname}`;
    if (pickupApiDiscoveryKey === key && pickupApiDiscoveryPromise) {
      return;
    }
    pickupApiDiscoveryKey = key;
    const discoveryPromise = fetchOzonPickupCandidatesFromApi(product).then((candidates) => {
      if (candidates.length > 0 && mergePickupCandidates(candidates)) {
        renderLastPanel();
        scheduleOzonDeliveryAssistSync();
      }
    }).catch(() => void 0).finally(() => {
      if (pickupApiDiscoveryPromise === discoveryPromise) {
        pickupApiDiscoveryPromise = null;
      }
    });
    pickupApiDiscoveryPromise = discoveryPromise;
  }
  async function fetchOzonPickupCandidatesFromApi(product) {
    const sources = [];
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
          if (!text || text.length > 4e6) {
            return;
          }
          sources.push({
            source: `api.${endpoint.label}`,
            value: text,
            urlHint: location.href,
            textHint
          });
        } catch {
        }
      })
    );
    return extractOzonPickupCandidatesFromSources(sources);
  }
  function buildOzonPickupDiscoveryEndpoints(product) {
    const headers = {
      "content-type": "application/json",
      "x-o3-app-name": "dweb_client",
      "x-o3-app-version": "release"
    };
    const productUrl = new URL(product.url);
    const productPath = `${productUrl.pathname}${productUrl.search}`;
    const modalPaths = [
      "/modal/addressbook",
      "/modal/delivery",
      "/modal/geo"
    ];
    const endpoints = [];
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
  function scheduleGenericPickupNameDiscovery() {
    const genericCandidateIds = latestPickupCandidates.filter(
      (candidate) => isGenericOzonPickupName(candidate.name, candidate.externalLocationId) && !targetedPickupDiscoveryIds.has(candidate.externalLocationId)
    ).map((candidate) => candidate.externalLocationId).slice(0, 8);
    if (genericCandidateIds.length === 0) {
      return;
    }
    genericCandidateIds.forEach((externalLocationId) => targetedPickupDiscoveryIds.add(externalLocationId));
    const product = getCurrentProduct();
    if (product) {
      discoverOzonPickupCandidatesFromApi(product);
    }
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
  function collectCurrentDeliveryPickupSources(urlHint) {
    const sources = [];
    document.querySelectorAll('[data-widget*="delivery" i], [data-widget*="address" i], [href*="/modal/addressbook" i]').forEach((element) => {
      if (element.id === PANEL_ID || element.closest(`#${PANEL_ID}`) || element.closest(`#${MENU_ASSIST_ID}`)) {
        return;
      }
      if (element.closest('[role="dialog"], [aria-modal="true"], [data-widget*="dialog" i], [data-widget*="modal" i]')) {
        return;
      }
      if (!isVisible(element)) {
        return;
      }
      const text = cleanOzonDeliverySummaryText(element);
      if (!text || !/(достав|получ|пункт|пвз|адрес|город|pickup|delivery|address|\d)/i.test(text)) {
        return;
      }
      const label = visibleDeliveryPickupLabel(text);
      sources.push({
        source: "content.current-delivery",
        value: {
          name: label || text,
          address: label || text,
          ...collectOzonRowEvidence(element)
        },
        textHint: text,
        urlHint
      });
    });
    return sources;
  }
  function compactText3(value) {
    return value.replace(/\s+/g, " ").trim();
  }
  async function saveSelectedPickupPoint(product) {
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
      captureStatus = { tone: "normal", message: `Already saved: ${ozonCandidateDisplayName(candidate)}` };
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
    const candidateName = ozonCandidateDisplayName(candidate);
    captureStatus = {
      tone: "normal",
      message: quoteCaptured ? `Saved and captured current price: ${candidateName}` : `Saved: ${candidateName}`
    };
    await runIfProductPage();
    return response;
  }
  async function savePickupCandidate(candidate, product) {
    const name = ozonCandidateDisplayName(candidate);
    const pickupPoint = {
      id: crypto.randomUUID(),
      name,
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
  async function captureCurrentPriceForPickupPoint(pickupPoint, product) {
    const saved = await saveCurrentVisibleQuoteForPoint(pickupPoint, product, { requireConfirmation: true });
    if (saved) {
      captureStatus = { tone: "normal", message: `Captured current page price for ${ozonPickupDisplayName(pickupPoint)}` };
      await runIfProductPage();
    } else {
      renderLastPanel();
    }
  }
  async function saveCurrentVisibleQuoteForPoint(pickupPoint, product, options) {
    if (options.requireConfirmation) {
      const currentCandidate = await getBestPickupCandidate();
      const pickupPointName = ozonPickupDisplayName(pickupPoint);
      if (currentCandidate && currentCandidate.externalLocationId !== pickupPoint.externalLocationId) {
        const shouldContinue = await requestPanelConfirmation({
          title: "Capture visible price?",
          message: `The currently detected Ozon point looks like "${ozonCandidateDisplayName(currentCandidate)}", not "${pickupPointName}". Capture the visible page price for "${pickupPointName}" anyway?`,
          confirmText: "Capture price"
        });
        if (!shouldContinue) {
          captureStatus = { tone: "normal", message: "Price capture cancelled" };
          return false;
        }
      } else if (!currentCandidate) {
        const shouldContinue = await requestPanelConfirmation({
          title: "Capture visible price?",
          message: `I could not verify the selected Ozon point. Capture the visible page price for "${pickupPointName}" anyway?`,
          confirmText: "Capture price"
        });
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
    const updatedSettings = await saveManualQuoteForPoint(pickupPoint, product, quote);
    return Boolean(updatedSettings);
  }
  async function autoCaptureCurrentVisibleQuote(product, settings) {
    const visibleDeliveryText = collectCurrentDeliverySummaryText();
    if (!visibleDeliveryText) {
      return settings;
    }
    requestPagePickupCandidates();
    mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
    const pickupPoint = findSavedPickupPointForVisibleDelivery(settings, visibleDeliveryText);
    if (!pickupPoint) {
      return settings;
    }
    const quote = extractVisibleOzonPrice(pickupPoint.currency);
    if (!quote) {
      return settings;
    }
    const existing = settings.manualQuotes[manualQuoteKey(product.productId, pickupPoint.id)];
    if (existing && quoteMatchesManualQuote(existing, quote)) {
      return settings;
    }
    const lockKey = `${product.productId}:${pickupPoint.id}:${quote.amount}:${quote.currency}:${quote.rawText || ""}`;
    if (autoCaptureInFlight.has(lockKey)) {
      return settings;
    }
    autoCaptureInFlight.add(lockKey);
    try {
      const updatedSettings = await saveManualQuoteForPoint(pickupPoint, product, quote);
      if (!updatedSettings) {
        return settings;
      }
      captureStatus = { tone: "normal", message: `Auto captured current price for ${ozonPickupDisplayName(pickupPoint)}` };
      return updatedSettings;
    } finally {
      autoCaptureInFlight.delete(lockKey);
    }
  }
  async function repairUnsafeSavedPickupNames(settings) {
    let nextSettings = settings;
    for (const pickupPoint of settings.pickupPoints) {
      if (pickupPoint.marketplace !== "ozon" || pickupPoint.externalLocationId.trim() === "") {
        continue;
      }
      const repairedName = bestAvailableOzonPickupName(pickupPoint, settings);
      if (repairedName === pickupPoint.name) {
        continue;
      }
      const response = await runtimeRequest({
        type: "UPSERT_PICKUP_POINT",
        pickupPoint: {
          ...pickupPoint,
          name: repairedName
        }
      });
      if (response.ok && "settings" in response) {
        nextSettings = response.settings;
        latestSettings = nextSettings;
      }
    }
    return nextSettings;
  }
  function bestAvailableOzonPickupName(pickupPoint, settings) {
    const candidate = findSafeOzonNameCandidate(pickupPoint);
    const candidateName = candidate ? safeOzonPickupName(candidate.name, pickupPoint.externalLocationId) : "";
    if (candidateName && !isGenericOzonPickupName(candidateName, pickupPoint.externalLocationId)) {
      return candidateName;
    }
    const visibleName = visibleDeliveryPickupLabel(collectCurrentDeliverySummaryText());
    if (visibleName && canUseVisibleDeliveryNameForSavedPoint(settings, pickupPoint)) {
      return visibleName;
    }
    return safeOzonPickupName(candidateName || pickupPoint.name, pickupPoint.externalLocationId);
  }
  function findSafeOzonNameCandidate(pickupPoint) {
    const candidate = latestPickupCandidates.find(
      (item) => item.externalLocationId === pickupPoint.externalLocationId && shouldUseOzonPickupName(pickupPoint.name, item.name, pickupPoint.externalLocationId)
    );
    if (!candidate || isCandidateNameSharedAcrossExternalIds(candidate)) {
      return null;
    }
    return candidate;
  }
  function isCandidateNameSharedAcrossExternalIds(candidate) {
    const name = normalizedCandidateDisplayName(candidate);
    if (!name || isGenericOzonPickupName(name, candidate.externalLocationId)) {
      return false;
    }
    const matchingExternalIds = new Set(
      latestPickupCandidates.filter((item) => normalizedCandidateDisplayName(item) === name).map((item) => item.externalLocationId)
    );
    return matchingExternalIds.size > 1;
  }
  function normalizedCandidateDisplayName(candidate) {
    return compactText3(safeOzonPickupName(candidate.name, candidate.externalLocationId)).toLowerCase();
  }
  function quoteMatchesManualQuote(manualQuote, quote) {
    return manualQuote.quote.amount === quote.amount && manualQuote.quote.currency === quote.currency && (manualQuote.quote.rawText || "") === (quote.rawText || "");
  }
  function findSavedPickupPointForVisibleDelivery(settings, visibleDeliveryText) {
    const savedPoints = settings.pickupPoints.filter((point) => point.marketplace === "ozon" && point.externalLocationId.trim() !== "");
    const byExternalId = new Map(savedPoints.map((point) => [point.externalLocationId, point]));
    const candidateMatches = latestPickupCandidates.map((candidate) => {
      const point = byExternalId.get(candidate.externalLocationId);
      return point ? {
        point,
        score: scoreVisiblePickupMatch(`${candidate.name} ${ozonPickupDisplayName(point)} ${point.comment || ""}`, visibleDeliveryText, {
          allowSingleStrongToken: true
        })
      } : null;
    }).filter((match) => match !== null && match.score >= 10);
    const directMatches = savedPoints.map((point) => ({
      point,
      score: scoreVisiblePickupMatch(`${ozonPickupDisplayName(point)} ${point.comment || ""}`, visibleDeliveryText)
    })).filter((match) => match.score >= 18);
    const byPointId = /* @__PURE__ */ new Map();
    for (const match of [...candidateMatches, ...directMatches]) {
      const existing = byPointId.get(match.point.id);
      if (!existing || match.score > existing.score) {
        byPointId.set(match.point.id, match);
      }
    }
    const matches = [...byPointId.values()].sort((a, b) => b.score - a.score);
    const [best, second] = matches;
    if (!best) {
      return null;
    }
    if (second && second.score >= best.score - 6) {
      return null;
    }
    return best.point;
  }
  function scoreVisiblePickupMatch(pickupText, visibleDeliveryText, options = {}) {
    const pickupTokens = pickupMatchTokens(pickupText);
    const visibleTokens = pickupMatchTokens(visibleDeliveryText);
    let score = 0;
    let matchedTokens = 0;
    let hasNumericMatch = false;
    let hasStrongTextMatch = false;
    for (const token of pickupTokens) {
      if (!visibleTokens.has(token)) {
        continue;
      }
      matchedTokens += 1;
      if (/\d/.test(token)) {
        hasNumericMatch = true;
      }
      if (token.length >= 5 && /\p{L}/u.test(token)) {
        hasStrongTextMatch = true;
      }
      score += token.length >= 5 ? 10 : 5;
    }
    if (matchedTokens < 2 && !hasNumericMatch && !(options.allowSingleStrongToken && hasStrongTextMatch)) {
      return 0;
    }
    return score;
  }
  function collectCurrentDeliverySummaryText() {
    const chunks = [];
    document.querySelectorAll('[data-widget*="delivery" i], [data-widget*="address" i], [href*="/modal/addressbook" i]').forEach((element) => {
      if (element.id === PANEL_ID || element.closest(`#${PANEL_ID}`) || element.closest(`#${MENU_ASSIST_ID}`)) {
        return;
      }
      if (element.closest('[role="dialog"], [aria-modal="true"], [data-widget*="dialog" i], [data-widget*="modal" i]')) {
        return;
      }
      if (!isVisible(element)) {
        return;
      }
      const text = cleanOzonDeliverySummaryText(element);
      if (text && text.length <= 1200 && /(достав|получ|пункт|пвз|адрес|город|pickup|delivery|address|\d)/i.test(text)) {
        chunks.push(text);
      }
    });
    return compactText3(chunks.join(" | ")).slice(0, 2500);
  }
  function cleanOzonDeliverySummaryText(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll("button, [role='button']").forEach((node) => node.remove());
    return stripOzonActionText(compactText3(clone.innerText || clone.textContent || ""));
  }
  function visibleDeliveryPickupLabel(text) {
    const cleaned = stripOzonActionText(text).replace(/^(?:доставка\s+и\s+возврат|доставка|способ\s+получения|адрес\s+доставки)\s+/i, " ").replace(/(?:пункты\s+выдачи\s+ozon|срок\s+хранения\s+заказа|со\s+склада\s+продавца|с\s+\d{1,2}\s+[а-я]+|сегодня|завтра).*$/i, " ");
    const ozonPoint = compactText3(cleaned.match(/Пункт\s+Ozon\s*№\s*[\d-]+[^|<>{}\[\]\n\r]{0,140}/i)?.[0] || "");
    const label = compactText3(ozonPoint || cleaned).replace(/^[,;|•·\s-]+/, "").replace(/[,;|•·\s-]+$/, "");
    if (!label || label.length < 8 || label.length > 180) {
      return "";
    }
    return /(?:пункт\s+ozon\s*№|пвз|pickup|выдач)/i.test(label) || isAddressLikePickupRowText(label) ? label : "";
  }
  function canUseVisibleDeliveryNameForSavedPoint(settings, pickupPoint) {
    if (!isGenericOzonPickupName(pickupPoint.name, pickupPoint.externalLocationId)) {
      return false;
    }
    const genericSavedPoints = settings.pickupPoints.filter(
      (point) => point.marketplace === "ozon" && point.externalLocationId.trim() !== "" && isGenericOzonPickupName(point.name, point.externalLocationId)
    );
    return genericSavedPoints.length === 1 && genericSavedPoints[0]?.id === pickupPoint.id;
  }
  function stripOzonActionText(text) {
    return compactText3(
      text.replace(/(?:^|[\s,;|•·-])(?:Редактировать|Изменить|Удалить|Edit|Delete|Remove)(?=$|[\s,;|•·-])/giu, " ")
    );
  }
  async function saveManualQuoteForPoint(pickupPoint, product, quote) {
    const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
    const manualQuote = {
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
      return null;
    }
    latestSettings = response.settings;
    return response.settings;
  }
  async function deleteSavedPickupPoint(pickupPoint, product) {
    const pickupPointName = ozonPickupDisplayName(pickupPoint);
    const shouldDelete = await requestPanelConfirmation({
      title: "Delete pickup point?",
      message: `Delete "${pickupPointName}" from saved pickup points?`,
      confirmText: "Delete point",
      danger: true
    });
    if (!shouldDelete) {
      return;
    }
    captureStatus = { tone: "normal", message: `Deleted: ${pickupPointName}` };
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
    latestSettings = response.settings;
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
  function installOzonDeliveryMenuAssist() {
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
  function scheduleOzonDeliveryAssistSync() {
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
  async function syncCurrentOzonDeliveryMenuAssist() {
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
  function ensureOzonDeliveryMenuAssist() {
    ensureOzonDeliveryAssistStyles();
    const target = findOzonDeliveryContainer();
    const existing = document.getElementById(MENU_ASSIST_ID);
    if (!target) {
      existing?.remove();
      return;
    }
    if (existing && existing.parentElement === target) {
      const product2 = getCurrentProduct();
      if (product2) {
        void syncOzonDeliveryMenuAssist(target, existing, product2);
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
  function findOzonDeliveryContainer() {
    const candidates = Array.from(
      document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [data-widget*="dialog" i], [data-widget*="modal" i], [data-widget*="addressbook" i]'
      )
    );
    return candidates.find((element) => isLikelyOzonDeliverySelectorContainer(element)) || null;
  }
  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 120 && rect.height > 40 && rect.bottom > 0 && rect.right > 0;
  }
  function isLikelyOzonDeliverySelectorContainer(element) {
    if (element.id === PANEL_ID || element.closest(`#${PANEL_ID}`) || element.id === MENU_ASSIST_ID) {
      return false;
    }
    if (!isVisible(element)) {
      return false;
    }
    const text = (element.innerText || element.textContent || "").slice(0, 3e3);
    if (!/(пункт|пвз|получ|достав|адрес|город|pickup|delivery|address)/i.test(text)) {
      return false;
    }
    const role = (element.getAttribute("role") || "").toLowerCase();
    const modalEvidence = [
      role,
      element.getAttribute("aria-modal") || "",
      element.getAttribute("data-widget") || "",
      element.id,
      typeof element.className === "string" ? element.className : ""
    ].join(" ");
    const looksModal = role === "dialog" || /(true|modal|dialog|popup|drawer|overlay|addressbook|deliverydialog)/i.test(modalEvidence);
    if (!looksModal) {
      return false;
    }
    const hasSelectorCopy = /(выберите|выбор|адрес\s+доставки|пункт\s+выдач|пункты\s+выдачи|способ\s+получения|куда\s+доставить|pickup point|delivery selector|select address)/i.test(
      text
    );
    return hasSelectorCopy || countPickupRowMarkers(text) >= 2;
  }
  async function syncOzonDeliveryMenuAssist(target, assist, product) {
    requestPagePickupCandidates();
    const rows = collectOzonDeliveryRowCandidates(target);
    const rowCandidates = rows.flatMap((row) => row.candidate ? [row.candidate] : []);
    if (rowCandidates.length > 0 && mergePickupCandidates(rowCandidates)) {
      renderLastPanel();
    }
    const settings = await getLatestSettings();
    const savedExternalIds = getSavedOzonExternalIds(settings);
    suppressOzonAssistObserver();
    decorateOzonDeliveryRows(target, rows, savedExternalIds, product);
    renderOzonDeliveryAssist(assist, rows, savedExternalIds);
  }
  function suppressOzonAssistObserver() {
    suppressAssistObserverUntil = Date.now() + 300;
  }
  async function getLatestSettings() {
    if (latestSettings) {
      return latestSettings;
    }
    if (!settingsLoadPromise) {
      settingsLoadPromise = runtimeRequest({ type: "GET_SETTINGS" }).then((response) => {
        if (response.ok && "settings" in response) {
          latestSettings = response.settings;
          return response.settings;
        }
        return null;
      }).catch(() => null).finally(() => {
        settingsLoadPromise = null;
      });
    }
    return settingsLoadPromise;
  }
  function scheduleSavedPickupNameSync() {
    if (savedPickupNameSyncTimer !== null) {
      return;
    }
    savedPickupNameSyncTimer = window.setTimeout(() => {
      savedPickupNameSyncTimer = null;
      void syncSavedPickupNamesFromCandidates();
    }, 250);
  }
  async function syncSavedPickupNamesFromCandidates() {
    if (latestPickupCandidates.length === 0) {
      return;
    }
    let settings = await getLatestSettings();
    if (!settings) {
      return;
    }
    let didUpdate = false;
    for (const pickupPoint of settings.pickupPoints) {
      if (pickupPoint.marketplace !== "ozon" || pickupPoint.externalLocationId.trim() === "") {
        continue;
      }
      const candidate = findSafeOzonNameCandidate(pickupPoint);
      if (!candidate) {
        continue;
      }
      const response = await runtimeRequest({
        type: "UPSERT_PICKUP_POINT",
        pickupPoint: {
          ...pickupPoint,
          name: ozonCandidateDisplayName(candidate)
        }
      });
      if (!response.ok || !("settings" in response)) {
        continue;
      }
      settings = response.settings;
      latestSettings = settings;
      didUpdate = true;
    }
    if (didUpdate) {
      updateLastPanelSettings(settings);
      renderLastPanel();
      scheduleOzonDeliveryAssistSync();
    }
  }
  function updateLastPanelSettings(settings) {
    if (!lastPanelModel || !("settings" in lastPanelModel)) {
      return;
    }
    const ozonPoints = settings.pickupPoints.filter((point) => point.marketplace === "ozon");
    const byId = new Map(settings.pickupPoints.map((point) => [point.id, point]));
    const refreshPoint = (point) => byId.get(point.id) || point;
    if (lastPanelModel.state === "loading") {
      lastPanelModel = {
        ...lastPanelModel,
        settings,
        pickupPoints: lastPanelModel.pickupPoints?.map(refreshPoint)
      };
      return;
    }
    if (lastPanelModel.state === "empty") {
      lastPanelModel = {
        ...lastPanelModel,
        settings
      };
      return;
    }
    if (lastPanelModel.state === "noSelection") {
      lastPanelModel = {
        ...lastPanelModel,
        settings,
        allPickupPoints: ozonPoints
      };
      return;
    }
    if (lastPanelModel.state === "results") {
      lastPanelModel = {
        ...lastPanelModel,
        settings,
        pickupPoints: lastPanelModel.pickupPoints.map(refreshPoint)
      };
    }
  }
  function collectOzonDeliveryRowCandidates(container) {
    const byKey = /* @__PURE__ */ new Map();
    const seenRows = /* @__PURE__ */ new Set();
    const selectors = [
      "a",
      "button",
      "li",
      '[role="button"]',
      '[role="option"]',
      "[data-address-id]",
      "[data-address-oid]",
      "[data-delivery-address-id]",
      "[data-delivery-address-oid]",
      "[data-pickup-point-id]",
      "[data-pvz-id]",
      "[data-testid]",
      "div"
    ].join(",");
    for (const element of Array.from(container.querySelectorAll(selectors))) {
      const row = normalizeOzonPickupRow(element, container);
      if (!row || seenRows.has(row)) {
        continue;
      }
      seenRows.add(row);
      const candidate = extractOzonPickupCandidateFromRow(row);
      const rowText = getOzonRowText(row);
      const rowKey = candidate?.externalLocationId || rowMatchKey(rowText);
      const rect = row.getBoundingClientRect();
      const rank = (candidate?.score || 1) + (row.matches('a, button, [role="button"], [role="option"], li') ? 18 : 0) - Math.min(50, Math.round(rect.width * rect.height / 6e3));
      const existing = byKey.get(rowKey);
      if (!existing || rank > existing.rank) {
        byKey.set(rowKey, { row, candidate, rank, rowKey });
      }
    }
    return [...byKey.values()].sort(
      (a, b) => a.row.compareDocumentPosition(b.row) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
  }
  function normalizeOzonPickupRow(element, container) {
    if (element.id === MENU_ASSIST_ID || element.closest(`#${MENU_ASSIST_ID}`) || element.closest("[data-markonverter-pvz-action]")) {
      return null;
    }
    let current = element;
    let best = null;
    while (current && current !== container && current !== document.body) {
      if (isPotentialOzonPickupRow(current)) {
        best = current;
      }
      current = current.parentElement;
    }
    return best;
  }
  function isPotentialOzonPickupRow(element) {
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
    return /(пункт\s+ozon|пвз|pickup|выдач)/i.test(text) || hasOzonPickupIdEvidence(element) && isAddressLikePickupRowText(text);
  }
  function isOzonAddAddressControlText(text) {
    return /(?:^|\s)(?:добавить|добавьте|add)(?:\s|$)/i.test(text) && /(адрес|пункт\s+выдач|постамат|delivery|pickup)/i.test(text);
  }
  function hasOzonPickupIdEvidence(element) {
    const evidence = Object.entries(collectOzonRowEvidence(element)).map(([key, value]) => `${key}=${value}`).join(" ");
    return /(select_address|deliveryAddress|addressOid|addressId|addressUid|pickupPoint|pickPoint|pvz|data-address|href)/i.test(evidence);
  }
  function isAddressLikePickupRowText(text) {
    return /(ул\.?|улица|пр-кт|проспект|шоссе|пер\.?|переулок|мкр|микрорайон|дом|д\.|street|avenue|road)/i.test(text) || /(?:^|[\s,])\d{1,4}[а-яa-z]?(?:[\s,]|$)/i.test(text);
  }
  function extractOzonPickupCandidateFromRow(element) {
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
  function countPickupRowMarkers(text) {
    return (text.match(/(?:пункт\s+ozon|пвз|pickup|выдач)/gi) || []).length;
  }
  function matchDetectedPickupCandidateToRow(rowText) {
    const rowNumber = extractOzonVisiblePointNumber(rowText);
    const rowTokens = pickupMatchTokens(rowText);
    let best = null;
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
  function extractOzonVisiblePointNumber(text) {
    return compactText3(text.match(/(?:№|N[°o.]?)\s*([\d-]{3,})/i)?.[1] || "");
  }
  function rowMatchKey(text) {
    return extractOzonVisiblePointNumber(text) || pickupMatchTokens(text).values().next().value || compactText3(text).slice(0, 80);
  }
  function pickupMatchTokens(text) {
    const lowerText = text.toLowerCase();
    const normalized = lowerText.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, " ").split(/\s+/).filter(
      (token) => (token.length >= 4 || token.length >= 2 && /\d/.test(token)) && !/^(пункт|ozon|срок|хранения|заказа|дней|адрес|редактировать|изменить|удалить|delivery|pickup|edit|delete|remove)$/.test(
        token
      )
    );
    const numericAddressTokens = lowerText.match(/\d+[\p{L}]?/gu) || [];
    return new Set([...normalized, ...numericAddressTokens].slice(0, 50));
  }
  function getOzonRowText(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll("[data-markonverter-pvz-action]").forEach((node) => node.remove());
    return compactText3(clone.innerText || clone.textContent || "");
  }
  function pickupRowName(text) {
    const cleaned = compactText3(
      text.replace(
        /(?:^|[\s,;|•-])(?:Add|Saved|Refresh PVZ|Show in panel|Удалить|Редактировать|Изменить|Edit|Delete|Remove)(?=$|[\s,;|•-])/giu,
        " "
      ).replace(/(?:срок\s+хранения\s+заказа|storage\s+period).*$/i, " ")
    );
    return cleaned.length > 170 ? `${cleaned.slice(0, 167)}...` : cleaned;
  }
  function collectOzonRowEvidence(element) {
    const evidence = {};
    const elements = [element, ...Array.from(element.querySelectorAll("*")).slice(0, 80)];
    elements.forEach((item, elementIndex) => {
      Array.from(item.attributes).forEach((attribute, attributeIndex) => {
        if (!/(id|oid|uid|address|delivery|pickup|pick|pvz|location|href|title|aria-label|data)/i.test(attribute.name)) {
          return;
        }
        const value = attribute.value.trim();
        if (!value || value.length > 500) {
          return;
        }
        const key = evidence[attribute.name] === void 0 ? attribute.name : `${attribute.name}_${elementIndex}_${attributeIndex}`;
        evidence[key] = value;
      });
    });
    return evidence;
  }
  function decorateOzonDeliveryRows(target, rows, savedExternalIds, product) {
    const activeRows = new Set(rows.map((row) => row.row));
    target.querySelectorAll("[data-markonverter-pvz-action]").forEach((control) => {
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
        (child) => child instanceof HTMLElement && child.dataset.markonverterPvzAction === "true"
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
  function buildOzonRowAction(candidate, isSaved, product, stateKey) {
    const action = document.createElement("span");
    action.dataset.markonverterPvzAction = "true";
    action.dataset.markonverterActionState = stateKey;
    action.dataset.markonverterExternalLocationId = candidate.externalLocationId;
    action.className = `markonverter-ozon-pvz-action${isSaved ? " is-saved" : ""}`;
    action.textContent = isSaved ? "Saved" : "Add";
    action.title = isSaved ? "Already saved in Markonverter" : `Add ${ozonCandidateDisplayName(candidate)} to Markonverter`;
    action.setAttribute("role", "button");
    action.tabIndex = isSaved ? -1 : 0;
    action.setAttribute("aria-disabled", String(isSaved));
    bindGuardedPageAction(action, () => {
      if (!isSaved) {
        void saveDetectedPickupCandidate(candidate, product);
      }
    });
    return action;
  }
  function markSavedPickupCandidateInPage(candidate) {
    document.querySelectorAll("[data-markonverter-pvz-action]").forEach((action) => {
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
  function renderOzonDeliveryAssist(assist, rows, savedExternalIds) {
    const identifiedRows = rows.filter((row) => row.candidate);
    const savedCount = identifiedRows.filter((row) => row.candidate && savedExternalIds.has(row.candidate.externalLocationId)).length;
    const statusText = rows.length > 0 ? `${rows.length} PVZ visible / ${savedCount} saved${identifiedRows.length < rows.length ? " / IDs loading" : ""}` : "PVZ list not loaded";
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
    bindGuardedPageAction(refreshButton, () => {
      requestPagePickupCandidates();
      const product = getCurrentProduct();
      if (product) {
        discoverOzonPickupCandidatesFromApi(product);
      }
      scheduleOzonDeliveryAssistSync();
    });
    const showButton = pageButton("Show in panel", "secondary");
    bindGuardedPageAction(showButton, () => {
      requestPagePickupCandidates();
      renderLastPanel();
      document.getElementById(PANEL_ID)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    assist.append(status, refreshButton, showButton);
  }
  function ensureOzonDeliveryAssistStyles() {
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
      pointer-events: auto !important;
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
  function pageButton(text, variant = "primary") {
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
  function bindGuardedPageAction(element, handler) {
    ensurePageActionEventGuard();
    element.dataset.markonverterPageAction = "true";
    pageActionHandlers.set(element, handler);
  }
  function ensurePageActionEventGuard() {
    if (pageActionEventGuardInstalled) {
      return;
    }
    pageActionEventGuardInstalled = true;
    ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click", "keydown"].forEach((type) => {
      window.addEventListener(type, handleGuardedPageActionEvent, true);
    });
  }
  function handleGuardedPageActionEvent(event) {
    const target = event.target instanceof Element ? event.target.closest(PAGE_ACTION_SELECTOR) : null;
    if (!target) {
      return;
    }
    if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type === "click" || event instanceof KeyboardEvent) {
      pageActionHandlers.get(target)?.(event);
    }
  }
  function renderPanel(shadow, model) {
    lastPanelModel = model;
    cancelPendingPanelConfirmation();
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
    header.innerHTML = isPanelCollapsed ? `<div class="headerTitle collapsedTitle"><strong>Markonverter</strong></div>` : `<div class="headerTitle"><span class="eyebrow">Markonverter</span><strong>Pickup prices</strong><span>${escapeHtml(model.product.title || "Ozon product")}</span></div>`;
    if (isPanelCollapsed) {
      header.title = "Expand Markonverter panel";
      header.addEventListener("click", (event) => {
        if (event.target.closest("button")) {
          return;
        }
        void setPanelCollapsed(false);
      });
    }
    const headerActions = document.createElement("div");
    headerActions.className = "headerActions";
    const panelSettings = "settings" in model ? model.settings : null;
    const currentSaveCandidate = panelSettings ? getFirstUnsavedPickupCandidate(panelSettings) : null;
    let saveButton = null;
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
    settingsButton.className = "iconButton settingsButton";
    settingsButton.setAttribute("aria-label", "Open settings");
    settingsButton.title = "Settings";
    settingsButton.textContent = "\u2699";
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
    appendOzonFixtureTools(root);
    shadow.append(root);
  }
  function renderLastPanel() {
    if (lastPanelModel) {
      renderPanel(ensurePanel(), lastPanelModel);
    }
  }
  function cancelPendingPanelConfirmation() {
    if (!pendingPanelConfirmationCancel) {
      return;
    }
    const cancel = pendingPanelConfirmationCancel;
    pendingPanelConfirmationCancel = null;
    cancel();
  }
  async function requestPanelConfirmation(options) {
    cancelPendingPanelConfirmation();
    const shadow = ensurePanel();
    const panel = shadow.querySelector(".panel");
    if (!panel || isPanelCollapsed) {
      return false;
    }
    return new Promise((resolve) => {
      const existing = shadow.getElementById(PANEL_CONFIRMATION_ID);
      existing?.remove();
      const wrapper = document.createElement("div");
      wrapper.id = PANEL_CONFIRMATION_ID;
      wrapper.className = `panelConfirmation${options.danger ? " danger" : ""}`;
      wrapper.tabIndex = -1;
      const text = document.createElement("div");
      text.className = "panelConfirmationText";
      const title = document.createElement("strong");
      title.textContent = options.title;
      const message = document.createElement("span");
      message.textContent = options.message;
      text.append(title, message);
      const actions = document.createElement("div");
      actions.className = "panelConfirmationActions";
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "confirmButton secondaryButton";
      cancelButton.textContent = options.cancelText || "Cancel";
      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className = `confirmButton${options.danger ? " danger" : ""}`;
      confirmButton.textContent = options.confirmText;
      actions.append(cancelButton, confirmButton);
      wrapper.append(text, actions);
      let resolved = false;
      const finish = (confirmed) => {
        if (resolved) {
          return;
        }
        resolved = true;
        wrapper.remove();
        if (pendingPanelConfirmationCancel === cancelCurrent) {
          pendingPanelConfirmationCancel = null;
        }
        resolve(confirmed);
      };
      const cancelCurrent = () => finish(false);
      pendingPanelConfirmationCancel = cancelCurrent;
      cancelButton.addEventListener("click", () => finish(false), { once: true });
      confirmButton.addEventListener("click", () => finish(true), { once: true });
      wrapper.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          finish(false);
        }
      });
      panel.append(wrapper);
      wrapper.scrollIntoView({ block: "nearest" });
      cancelButton.focus();
    });
  }
  async function loadPanelState() {
    try {
      const stored = await chrome.storage.local.get(PANEL_STATE_KEY);
      isPanelCollapsed = normalizePanelState(stored[PANEL_STATE_KEY]).collapsed;
    } catch {
      isPanelCollapsed = false;
    }
  }
  function normalizePanelState(value) {
    const candidate = value;
    return { collapsed: candidate?.collapsed === true };
  }
  async function setPanelCollapsed(collapsed) {
    isPanelCollapsed = collapsed;
    renderLastPanel();
    try {
      await chrome.storage.local.set({ [PANEL_STATE_KEY]: { collapsed } });
    } catch {
    }
    if (!collapsed) {
      await runIfProductPage();
    }
  }
  function appendCaptureStatus(root) {
    if (captureStatus) {
      root.append(messageNode(captureStatus.message, captureStatus.tone));
    }
  }
  function appendOzonFixtureTools(root) {
    const wrapper = document.createElement("div");
    wrapper.className = "fixtureTools";
    const text = document.createElement("div");
    text.className = "fixtureToolsText";
    const statusLine = fixtureStatus ? `<span class="${fixtureStatus.tone === "error" ? "fixtureError" : ""}">${escapeHtml(fixtureStatus.message)}</span>` : "";
    text.innerHTML = `<span class="eyebrow">Ozon fixtures</span><strong>${ozonFixtureCount} captured</strong>${statusLine}`;
    const actions = document.createElement("div");
    actions.className = "fixtureToolsActions";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "detailsButton";
    copyButton.textContent = "Copy";
    copyButton.title = "Copy recorded Ozon API fixtures";
    copyButton.addEventListener("click", () => {
      void copyOzonFixtures();
    });
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "deleteButton";
    clearButton.textContent = "Clear";
    clearButton.title = "Clear recorded Ozon API fixtures";
    clearButton.addEventListener("click", () => {
      void clearOzonFixtures();
    });
    actions.append(copyButton, clearButton);
    wrapper.append(text, actions);
    root.append(wrapper);
  }
  async function refreshOzonFixtureSummary() {
    try {
      ozonFixtureCount = (await readOzonFixtureStore()).records.length;
    } catch {
      ozonFixtureCount = 0;
    }
  }
  async function readOzonFixtureStore() {
    const stored = await chrome.storage.local.get(OZON_FIXTURE_STORE_KEY);
    return normalizeOzonFixtureStore(stored[OZON_FIXTURE_STORE_KEY]);
  }
  async function copyOzonFixtures() {
    await flushPendingFixtures();
    const store = await readOzonFixtureStore();
    ozonFixtureCount = store.records.length;
    if (store.records.length === 0) {
      fixtureStatus = { tone: "error", message: "No fixtures yet" };
      renderLastPanel();
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(store, null, 2));
      fixtureStatus = { tone: "normal", message: `Copied ${store.records.length}` };
    } catch {
      fixtureStatus = { tone: "error", message: "Clipboard blocked" };
    }
    renderLastPanel();
  }
  async function clearOzonFixtures() {
    if (ozonFixtureCount > 0 && !await requestPanelConfirmation({
      title: "Clear Ozon fixtures?",
      message: "Clear recorded Ozon API fixtures from this browser?",
      confirmText: "Clear fixtures",
      danger: true
    })) {
      return;
    }
    pendingFixtureInputs = [];
    await chrome.storage.local.set({ [OZON_FIXTURE_STORE_KEY]: emptyOzonFixtureStore() });
    ozonFixtureCount = 0;
    fixtureStatus = { tone: "normal", message: "Cleared" };
    renderLastPanel();
  }
  function getSavedOzonExternalIds(settings) {
    return new Set(
      (settings?.pickupPoints || []).filter((point) => point.marketplace === "ozon" && point.externalLocationId.trim() !== "").map((point) => point.externalLocationId)
    );
  }
  function isPickupCandidateSaved(candidate, settings) {
    return getSavedOzonExternalIds(settings).has(candidate.externalLocationId);
  }
  function getFirstUnsavedPickupCandidate(settings) {
    return latestPickupCandidates.find((candidate) => !isPickupCandidateSaved(candidate, settings)) || null;
  }
  function ozonCandidateDisplayName(candidate) {
    return safeOzonPickupName(candidate.name, candidate.externalLocationId);
  }
  function ozonPickupDisplayName(pickupPoint) {
    if (pickupPoint.marketplace !== "ozon") {
      return pickupPoint.name;
    }
    return safeOzonPickupName(pickupPoint.name, pickupPoint.externalLocationId);
  }
  function appendPickupRows(root, settings, comparedPickupPoints, results, product) {
    const rows = buildPanelComparisonRows(settings, comparedPickupPoints, results);
    if (rows.length > 0) {
      root.append(renderPickupRows(rows, settings, product));
    }
  }
  function buildPanelComparisonRows(settings, comparedPickupPoints, results) {
    const comparedRows = buildComparisonRows(comparedPickupPoints, results);
    const comparedByPointId = new Map(comparedRows.map((row) => [row.pickupPoint.id, row]));
    return settings.pickupPoints.filter((point) => point.marketplace === "ozon").map((pickupPoint) => {
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
  function isComparisonPointSelected(pickupPoint, settings) {
    return settings.comparisonPickupPointIds ? settings.comparisonPickupPointIds.includes(pickupPoint.id) : true;
  }
  function renderPickupRows(rows, settings, product) {
    const list = document.createElement("div");
    list.className = "rows";
    for (const row of rows) {
      const item = document.createElement("div");
      item.className = `row${row.isCheapest ? " cheapest" : ""}${row.result?.status === "error" ? " failed" : ""}${row.isSelected ? "" : " unselected"}`;
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
      metaText.innerHTML = `<strong>${escapeHtml(ozonPickupDisplayName(row.pickupPoint))}</strong><span class="locationMeta">${escapeHtml(
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
        const manualLabel = row.result.originalPrice.source === "manual" ? `Captured ${formatCapturedAt(row.result.originalPrice.capturedAt)}` : "";
        const delta = row.deltaFromCheapest && row.deltaFromCheapest > 0 ? `+${formatCurrency(row.deltaFromCheapest, row.result.convertedCurrency)}` : row.isCheapest ? "best" : "";
        value.innerHTML = `<strong>${converted}</strong><span class="original">${escapeHtml(original)} ${escapeHtml(delta)}</span>${delivery ? `<span>${escapeHtml(delivery)}</span>` : ""}${manualLabel ? `<span>${escapeHtml(manualLabel)}</span>` : ""}`;
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
  function appendDetectedPickupCandidates(root, settings, product, showEmptyHint) {
    const list = detectedPickupCandidateList(settings, product, showEmptyHint);
    if (list) {
      root.append(list);
    }
  }
  function detectedPickupCandidateList(settings, product, showEmptyHint) {
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
      text.innerHTML = `<strong>${escapeHtml(ozonCandidateDisplayName(candidate))}</strong><span>${escapeHtml(candidate.country)} / ${escapeHtml(
        candidate.currency
      )}</span>`;
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
  async function saveDetectedPickupCandidate(candidate, product) {
    const candidateName = ozonCandidateDisplayName(candidate);
    captureStatus = { tone: "normal", message: `Saving: ${candidateName}` };
    renderLastPanel();
    const response = await savePickupCandidate(candidate, product);
    if (!response.ok || !("settings" in response)) {
      captureStatus = { tone: "error", message: response.ok ? "Pickup point was not saved" : response.error };
      renderLastPanel();
      return;
    }
    captureStatus = { tone: "normal", message: `Saved: ${candidateName}` };
    await syncCurrentOzonDeliveryMenuAssist();
    await runIfProductPage();
    await syncCurrentOzonDeliveryMenuAssist();
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
    if (error === AUTOMATIC_OZON_PRICE_LOOKUP_DISABLED) {
      return "Select this point in Ozon, wait for the price, then use Capture current.";
    }
    if (error.includes("response did not confirm requested pickup point")) {
      return "Ozon did not confirm this pickup point, so the current address may have been reused.";
    }
    return error.length > 150 ? `${error.slice(0, 147)}...` : error;
  }
  function formatCapturedAt(value) {
    if (!value) {
      return "from page";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "from page";
    }
    return date.toLocaleString(void 0, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  async function copyFailureDiagnostics(pickupPoint, error, product) {
    const diagnostics = {
      product,
      pickupPoint: {
        id: pickupPoint.id,
        name: ozonPickupDisplayName(pickupPoint),
        country: pickupPoint.country,
        currency: pickupPoint.currency,
        externalLocationId: pickupPoint.externalLocationId,
        comment: pickupPoint.comment
      },
      error,
      detectedPickupCandidates: latestPickupCandidates.slice(0, 5).map((candidate) => ({
        externalLocationId: candidate.externalLocationId,
        name: ozonCandidateDisplayName(candidate),
        country: candidate.country,
        currency: candidate.currency,
        source: candidate.source,
        score: candidate.score,
        comment: candidate.comment
      })),
      pageUrl: location.href,
      copiedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      captureStatus = { tone: "normal", message: "Copied pickup-point diagnostics" };
    } catch {
      captureStatus = { tone: "error", message: "Could not copy diagnostics. Browser clipboard access is blocked." };
    }
    renderLastPanel();
  }
  async function runtimeRequest(request) {
    return chrome.runtime.sendMessage(request);
  }
  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }

  // src/entrypoints/content.ts
  void boot();
})();
//# sourceMappingURL=content.js.map
