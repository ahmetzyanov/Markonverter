"use strict";
(() => {
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
      collectFromUnknown(parseMaybeJson(source.value), source.source, sourceText, candidates);
      if (typeof source.value === "string") {
        collectFromText(source.value, source.source, sourceText, candidates);
      }
    }
    return dedupeCandidates(candidates).sort((a, b) => b.score - a.score);
  }
  function collectFromUnknown(value, source, sourceText, candidates, path = [], depth = 0) {
    if (depth > 8 || value == null) {
      return;
    }
    if (typeof value === "string") {
      const parsed = parseMaybeJson(value);
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
  function parseMaybeJson(value) {
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
  function dedupeCandidates(candidates) {
    const byId = /* @__PURE__ */ new Map();
    for (const candidate of candidates) {
      const existing = byId.get(candidate.externalLocationId);
      if (!existing || candidate.score > existing.score || candidate.name.length > existing.name.length && candidate.score === existing.score) {
        byId.set(candidate.externalLocationId, candidate);
      }
    }
    return [...byId.values()];
  }

  // src/ozon-page-probe.ts
  var COLLECT_EVENT = "markonverter:collect-ozon-pickup";
  var CANDIDATES_EVENT = "markonverter:ozon-pickup-candidates";
  install();
  function install() {
    document.addEventListener(COLLECT_EVENT, () => emitCandidates(collectSources("manual")));
    window.addEventListener("load", () => emitCandidates(collectSources("load")));
    queueMicrotask(() => emitCandidates(collectSources("initial")));
    patchFetch();
    patchXhr();
  }
  function emitCandidates(sources) {
    const candidates = extractOzonPickupCandidatesFromSources(sources);
    if (candidates.length === 0) {
      return;
    }
    document.dispatchEvent(
      new CustomEvent(CANDIDATES_EVENT, {
        detail: JSON.stringify(candidates.slice(0, 20))
      })
    );
  }
  function collectSources(reason) {
    const sources = [];
    const urlHint = location.href;
    collectStorage("localStorage", localStorage, sources, urlHint);
    collectStorage("sessionStorage", sessionStorage, sources, urlHint);
    if (document.cookie) {
      sources.push({ source: `cookie.${reason}`, value: document.cookie, urlHint });
    }
    for (const key of ["__NUXT__", "__NEXT_DATA__", "__INITIAL_STATE__", "__APOLLO_STATE__", "__PRELOADED_STATE__"]) {
      const value = window[key];
      if (value) {
        sources.push({ source: `window.${key}`, value, urlHint });
      }
    }
    const deliveryText = collectDeliveryText();
    if (deliveryText) {
      sources.push({ source: `dom.${reason}`, value: deliveryText, textHint: deliveryText, urlHint });
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
          sources.push({ source: `${name}.${key}`, value, urlHint });
        }
      }
    } catch {
    }
  }
  function collectDeliveryText() {
    const selectors = [
      '[data-widget*="address" i]',
      '[data-widget*="delivery" i]',
      '[data-widget*="geo" i]',
      '[data-widget*="user" i]',
      '[href*="delivery" i]',
      "button",
      "a"
    ];
    const chunks = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        const text = element.innerText || element.textContent || "";
        if (/(достав|получ|пункт|пвз|адрес|город|pickup|delivery|address)/i.test(text)) {
          chunks.push(text);
        }
      });
    }
    return chunks.slice(0, 30).join(" | ").slice(0, 8e3);
  }
  function patchFetch() {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = fetchUrl(args[0]);
      inspectResponse(url, response.clone());
      return response;
    };
  }
  function patchXhr() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
      this.markonverterUrl = String(url);
      const forwardOpen = originalOpen;
      return forwardOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function send(...args) {
      this.addEventListener("loadend", () => {
        const xhr = this;
        if (!isRelevantUrl(xhr.markonverterUrl || "")) {
          return;
        }
        inspectPayload(xhr.markonverterUrl || "xhr", xhr.responseText);
      });
      return originalSend.call(this, ...args);
    };
  }
  function inspectResponse(url, response) {
    if (!isRelevantUrl(url)) {
      return;
    }
    response.text().then((text) => inspectPayload(url, text)).catch(() => void 0);
  }
  function inspectPayload(url, text) {
    if (!text || text.length > 4e6) {
      return;
    }
    emitCandidates([
      {
        source: `network.${url}`,
        value: text,
        urlHint: location.href,
        textHint: collectDeliveryText()
      }
    ]);
  }
  function fetchUrl(input) {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.href;
    }
    return input.url;
  }
  function isRelevantUrl(url) {
    return /(composer-api|entrypoint-api|delivery|address|location|geo|pvz|pickup)/i.test(url);
  }
})();
//# sourceMappingURL=ozon-page-probe.js.map
