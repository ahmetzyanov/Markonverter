"use strict";
(() => {
  // src/marketplaces/ozon-pickup-capture.ts
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
  var UI_ACTION_LABEL_RE = /^(?:удалить|delete|remove|add|save|saved|edit|options|hide|open|refresh pvz|show in panel)$/i;
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
      const bestName = name || extractNameNearId(sourceText, id, sourceText.indexOf(id));
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
  function collectFromText(text, source, sourceText, candidates) {
    if (!RELEVANCE_RE.test(`${source} ${sourceText} ${text.slice(0, 2e3)}`)) {
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
        const country = inferCountry(`${sourceText} ${text.slice(Math.max(0, match.index - 200), match.index + 300)}`);
        const name = extractNameNearId(text, id, match.index) || extractNameNearId(sourceText, id, sourceText.indexOf(id));
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
    return sourceLabel && isUsefulLabel(compact(sourceLabel)) ? compact(sourceLabel) : "";
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
    return scopes.find((scope) => extractStructuredLabels(scope).some((label) => isUsefulLabel(compact(label)))) || "";
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
  function extractOzonPointLabels(text) {
    const labels = [];
    const pattern = /Пункт\s+Ozon\s*№\s*[\d-]+[^|<>{}\[\]\n\r]{0,170}/gi;
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
  function cleanLabel(value, externalLocationId) {
    const withoutMarkup = stripMarkup(decodeTextSnippet(value)).replace(new RegExp(externalLocationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ").replace(/(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)\s*[:=]?\s*/gi, " ").replace(/(?:fullAddress|formattedAddress|addressText|shortAddress|displayName|address|subtitle|description|caption|title|name|city|street|text)\\?["']?\s*[:=]\s*\\?["']?/gi, " ").replace(/https?:\/\/\S+/gi, " ").replace(/\/modal\/addressbook\S*/gi, " ").replace(/\\[nrt]/gi, " ");
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
    const ozonPointMatches = value.match(/Пункт\s+Ozon\s*№/gi);
    return value.length >= 3 && value.length <= 180 && !SERVICE_LABEL_RE.test(value) && !/\b(?:layoutId|layoutVersion|pageType|ruleId|referer|referrer|widgetStates?)\b/i.test(value) && !TECHNICAL_LABEL_RE.test(value) && !TECHNICAL_ENDPOINT_LABEL_RE.test(value) && !UI_ACTION_LABEL_RE.test(value) && !/%[0-9a-f]{2}/i.test(value) && !/\\?["'][,;]\\?["']/.test(value) && (value.match(/["']?[a-z][\w-]*["']?\s*[:=]/gi)?.length || 0) < 2 && !/^(url|href|action|items?|widgetStates?|addressbook|delivery|address|title|name|subtitle)$/i.test(value) && !/^[a-z0-9_-]{4,80}$/i.test(value) && !/^ozon pickup [a-z0-9_-]{4,80}$/i.test(value) && (ozonPointMatches?.length || 0) <= 1;
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
  function dedupeCandidates(candidates) {
    const byId = /* @__PURE__ */ new Map();
    for (const candidate of candidates) {
      const existing = byId.get(candidate.externalLocationId);
      if (!existing || shouldReplaceOzonPickupCandidate(existing, candidate)) {
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
