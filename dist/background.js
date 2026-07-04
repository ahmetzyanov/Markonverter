// src/shared/i18n.ts
var DEFAULT_LANGUAGE_PREFERENCE = "ru";
var SUPPORTED_LANGUAGES = ["ru", "en"];
var SUPPORTED_LANGUAGE_PREFERENCES = ["auto", ...SUPPORTED_LANGUAGES];
function normalizeLanguagePreference(value) {
  return SUPPORTED_LANGUAGE_PREFERENCES.includes(value) ? value : DEFAULT_LANGUAGE_PREFERENCE;
}

// src/shared/types.ts
var SUPPORTED_CURRENCIES = ["RUB", "KZT"];
var SUPPORTED_CURRENCY_RATE_PROVIDERS = ["manual", "cbr", "nbk", "exchangeRateApi"];
var DEFAULT_SETTINGS = {
  language: DEFAULT_LANGUAGE_PREFERENCE,
  debug: false,
  defaultCurrency: "RUB",
  currencyRateProvider: "cbr",
  ratesToRub: {
    RUB: 1,
    KZT: 0.17
  },
  pickupPoints: [],
  comparisonPickupPointIds: null,
  manualQuotes: {}
};

// src/shared/validation.ts
var MAX_REASONABLE_KZT_TO_RUB_RATE = 1;
function normalizeSettings(value) {
  const candidate = value;
  const pickupPoints = Array.isArray(candidate?.pickupPoints) ? candidate.pickupPoints.filter(isPickupPointLike).map(normalizePickupPoint) : [];
  return {
    language: normalizeLanguagePreference(candidate?.language),
    debug: candidate?.debug === true,
    defaultCurrency: candidate?.defaultCurrency && SUPPORTED_CURRENCIES.includes(candidate.defaultCurrency) ? candidate.defaultCurrency : DEFAULT_SETTINGS.defaultCurrency,
    currencyRateProvider: SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(candidate?.currencyRateProvider) ? candidate?.currencyRateProvider : DEFAULT_SETTINGS.currencyRateProvider,
    currencyRateMeta: normalizeCurrencyRateMeta(candidate?.currencyRateMeta),
    ratesToRub: {
      RUB: sanitizeRate(candidate?.ratesToRub?.RUB, DEFAULT_SETTINGS.ratesToRub.RUB),
      KZT: sanitizeRate(candidate?.ratesToRub?.KZT, DEFAULT_SETTINGS.ratesToRub.KZT, MAX_REASONABLE_KZT_TO_RUB_RATE)
    },
    pickupPoints,
    comparisonPickupPointIds: normalizeComparisonPickupPointIds(candidate?.comparisonPickupPointIds, pickupPoints),
    manualQuotes: normalizeManualQuotes(candidate?.manualQuotes, pickupPoints)
  };
}
function sanitizeRate(value, fallback, max = Number.POSITIVE_INFINITY) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? value : fallback;
}
function normalizeCurrencyRateMeta(value) {
  const candidate = value;
  if (!candidate || !SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(candidate.provider) || typeof candidate.updatedAt !== "string" || Number.isNaN(Date.parse(candidate.updatedAt))) {
    return void 0;
  }
  return {
    provider: candidate.provider,
    updatedAt: new Date(candidate.updatedAt).toISOString(),
    effectiveDate: typeof candidate.effectiveDate === "string" ? candidate.effectiveDate : void 0,
    fallbackUsed: candidate.fallbackUsed === true
  };
}
function isPickupPointLike(value) {
  const candidate = value;
  return typeof candidate?.id === "string" && typeof candidate.name === "string";
}
function normalizePickupPoint(pickupPoint) {
  return {
    id: pickupPoint.id,
    name: pickupPoint.name,
    marketplace: pickupPoint.marketplace === "wildberries" ? "wildberries" : "ozon",
    country: pickupPoint.country || "RU",
    currency: SUPPORTED_CURRENCIES.includes(pickupPoint.currency) ? pickupPoint.currency : "RUB",
    externalLocationId: pickupPoint.externalLocationId || "",
    comment: pickupPoint.comment || ""
  };
}
function normalizeComparisonPickupPointIds(value, pickupPoints) {
  if (!Array.isArray(value)) {
    return null;
  }
  const knownIds = new Set(pickupPoints.map((point) => point.id));
  return [...new Set(value.filter((id) => typeof id === "string" && knownIds.has(id)))];
}
function normalizeManualQuotes(value, pickupPoints) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const knownIds = new Set(pickupPoints.map((point) => point.id));
  const quotes = {};
  for (const rawQuote of Object.values(value)) {
    const quote = normalizeManualQuote(rawQuote, knownIds);
    if (quote) {
      quotes[`${quote.productId}:${quote.pickupPointId}`] = quote;
    }
  }
  return quotes;
}
function normalizeManualQuote(value, knownPickupPointIds) {
  const candidate = value;
  if (!candidate || typeof candidate.productId !== "string" || typeof candidate.productUrl !== "string" || typeof candidate.pickupPointId !== "string" || typeof candidate.capturedAt !== "string" || !knownPickupPointIds.has(candidate.pickupPointId)) {
    return null;
  }
  const quote = normalizePriceQuote(candidate.quote);
  if (!quote) {
    return null;
  }
  return {
    productId: candidate.productId,
    productUrl: candidate.productUrl,
    pickupPointId: candidate.pickupPointId,
    quote: {
      ...quote,
      source: "manual",
      capturedAt: candidate.capturedAt
    },
    capturedAt: candidate.capturedAt
  };
}
function normalizePriceQuote(value) {
  const candidate = value;
  const currency = typeof candidate?.currency === "string" && SUPPORTED_CURRENCIES.includes(candidate.currency) ? candidate.currency : null;
  if (!candidate || typeof candidate.amount !== "number" || !Number.isFinite(candidate.amount) || candidate.amount <= 0 || !currency) {
    return null;
  }
  return {
    amount: candidate.amount,
    currency,
    rawText: typeof candidate.rawText === "string" ? candidate.rawText : void 0,
    deliveryText: typeof candidate.deliveryText === "string" ? candidate.deliveryText : void 0
  };
}

// src/shared/exchange-rates.ts
var CURRENCY_RATE_CACHE_TTL_MS = 12 * 60 * 60 * 1e3;
var PROVIDER_FETCH_TIMEOUT_MS = 5e3;
var MAX_REASONABLE_KZT_TO_RUB_RATE2 = 1;
var REMOTE_CURRENCY_RATE_PROVIDERS = ["cbr", "nbk", "exchangeRateApi"];
function currencyRateProviderFallbackOrder(preferredProvider) {
  if (preferredProvider === "manual") {
    return [];
  }
  return [
    preferredProvider,
    ...REMOTE_CURRENCY_RATE_PROVIDERS.filter((provider) => provider !== preferredProvider)
  ];
}
function isCurrencyRateCacheFresh(settings, now = Date.now(), ttlMs = CURRENCY_RATE_CACHE_TTL_MS) {
  if (settings.currencyRateProvider === "manual") {
    return true;
  }
  const updatedAt = Date.parse(settings.currencyRateMeta?.updatedAt || "");
  return Number.isFinite(updatedAt) && updatedAt <= now && now - updatedAt < ttlMs;
}
async function fetchCurrencyRates(preferredProvider, fetcher = fetch) {
  if (preferredProvider === "manual") {
    throw new Error("Manual currency rates cannot be updated automatically");
  }
  const attemptedProviders = currencyRateProviderFallbackOrder(preferredProvider);
  const errors = [];
  for (const provider of attemptedProviders) {
    try {
      const quote = await fetchProviderQuote(provider, fetcher);
      return {
        provider: quote.provider,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        effectiveDate: quote.effectiveDate,
        fallbackUsed: provider !== preferredProvider,
        ratesToRub: {
          RUB: 1,
          KZT: quote.rateKztToRub
        },
        attemptedProviders
      };
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not update currency rates (${errors.join("; ")})`);
}
function applyCurrencyRateResult(settings, result, preferredProvider = settings.currencyRateProvider) {
  return normalizeSettings({
    ...settings,
    currencyRateProvider: preferredProvider,
    currencyRateMeta: {
      provider: result.provider,
      updatedAt: result.updatedAt,
      effectiveDate: result.effectiveDate,
      fallbackUsed: result.fallbackUsed
    },
    ratesToRub: result.ratesToRub
  });
}
async function fetchProviderQuote(provider, fetcher) {
  if (provider === "cbr") {
    return fetchCbrQuote(fetcher);
  }
  if (provider === "nbk") {
    return fetchNationalBankKzQuote(fetcher);
  }
  return fetchExchangeRateApiQuote(fetcher);
}
async function fetchCbrQuote(fetcher) {
  const text = await fetchText(fetcher, "https://www.cbr.ru/scripts/XML_daily.asp");
  const valuteBlock = matchXmlBlockWithTag(text, "Valute", "CharCode", "KZT", "CBR KZT rate");
  const vunitRate = parseDecimal(matchTag(valuteBlock, "VunitRate"));
  const value = parseDecimal(matchTag(valuteBlock, "Value"));
  const nominal = parseDecimal(matchTag(valuteBlock, "Nominal")) || 1;
  const rateKztToRub = vunitRate || value / nominal;
  return {
    provider: "cbr",
    rateKztToRub: assertKztToRubRate(rateKztToRub, "CBR KZT rate"),
    effectiveDate: text.match(/<ValCurs\b[^>]*Date="([^"]+)"/i)?.[1]
  };
}
async function fetchNationalBankKzQuote(fetcher) {
  const text = await fetchText(fetcher, "https://nationalbank.kz/rss/rates_all.xml");
  const itemBlock = matchXmlBlockWithTag(text, "item", "title", "RUB", "NBK RUB rate");
  const rubInKzt = parseDecimal(matchTag(itemBlock, "description"));
  const quant = parseDecimal(matchTag(itemBlock, "quant")) || 1;
  const rateKztToRub = quant / rubInKzt;
  return {
    provider: "nbk",
    rateKztToRub: assertKztToRubRate(rateKztToRub, "NBK RUB rate"),
    effectiveDate: matchTag(itemBlock, "pubDate")
  };
}
async function fetchExchangeRateApiQuote(fetcher) {
  const response = await fetchWithTimeout(fetcher, "https://open.er-api.com/v6/latest/RUB");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data.result && data.result !== "success") {
    throw new Error(`Unexpected result ${data.result}`);
  }
  const rubToKzt = typeof data.rates?.KZT === "number" ? data.rates.KZT : Number(data.rates?.KZT);
  return {
    provider: "exchangeRateApi",
    rateKztToRub: assertKztToRubRate(1 / rubToKzt, "ExchangeRate-API KZT rate"),
    effectiveDate: data.time_last_update_utc || data.time_next_update_utc
  };
}
async function fetchText(fetcher, url) {
  const response = await fetchWithTimeout(fetcher, url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}
async function fetchWithTimeout(fetcher, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, PROVIDER_FETCH_TIMEOUT_MS);
  try {
    return await fetcher(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
function matchXmlBlockWithTag(value, blockTagName, markerTagName, markerValue, label) {
  const blockPattern = new RegExp(`<${blockTagName}\\b[^>]*>[\\s\\S]*?<\\/${blockTagName}>`, "gi");
  for (const match of value.matchAll(blockPattern)) {
    const block = match[0];
    if (matchTag(block, markerTagName)?.trim().toUpperCase() === markerValue.toUpperCase()) {
      return block;
    }
  }
  throw new Error(`${label} was not found`);
}
function matchTag(value, tagName) {
  return value.match(new RegExp(`<${tagName}>\\s*([^<]+?)\\s*<\\/${tagName}>`, "i"))?.[1];
}
function parseDecimal(value) {
  if (!value) {
    return NaN;
  }
  return Number(value.replace(",", ".").replace(/\s+/g, ""));
}
function assertPositiveRate(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
function assertKztToRubRate(value, label) {
  const rate = assertPositiveRate(value, label);
  if (rate > MAX_REASONABLE_KZT_TO_RUB_RATE2) {
    throw new Error(`${label} is implausible`);
  }
  return rate;
}

// src/shared/settings.ts
function manualQuoteKey(productId, pickupPointId) {
  return `${productId}:${pickupPointId}`;
}
function upsertPickupPoint(settings, pickupPoint) {
  const normalized = normalizeSettings(settings);
  const nextPoint = normalizeSettings({ ...normalized, pickupPoints: [pickupPoint] }).pickupPoints[0];
  if (!nextPoint) {
    return normalized;
  }
  const nextPickupPoints = [...normalized.pickupPoints];
  const existingIndex = nextPickupPoints.findIndex(
    (existing) => existing.id === nextPoint.id || existing.marketplace === nextPoint.marketplace && existing.externalLocationId.trim() !== "" && existing.externalLocationId === nextPoint.externalLocationId
  );
  if (existingIndex >= 0) {
    nextPickupPoints[existingIndex] = {
      ...nextPoint,
      id: nextPickupPoints[existingIndex].id
    };
  } else {
    nextPickupPoints.push(nextPoint);
  }
  return normalizeSettings({
    ...normalized,
    pickupPoints: nextPickupPoints
  });
}
function deletePickupPoint(settings, pickupPointId) {
  const normalized = normalizeSettings(settings);
  const pickupPoints = normalized.pickupPoints.filter((point) => point.id !== pickupPointId);
  const comparisonPickupPointIds = normalized.comparisonPickupPointIds?.filter((id) => id !== pickupPointId) ?? null;
  const manualQuotes = Object.fromEntries(
    Object.entries(normalized.manualQuotes).filter(([, quote]) => quote.pickupPointId !== pickupPointId)
  );
  return normalizeSettings({
    ...normalized,
    pickupPoints,
    comparisonPickupPointIds,
    manualQuotes
  });
}
function setComparisonPickupPointIds(settings, pickupPointIds) {
  const normalized = normalizeSettings(settings);
  return normalizeSettings({
    ...normalized,
    comparisonPickupPointIds: pickupPointIds
  });
}
function upsertManualQuote(settings, manualQuote) {
  const normalized = normalizeSettings(settings);
  return normalizeSettings({
    ...normalized,
    manualQuotes: {
      ...normalized.manualQuotes,
      [manualQuoteKey(manualQuote.productId, manualQuote.pickupPointId)]: manualQuote
    }
  });
}

// src/entrypoints/background.ts
var SETTINGS_KEY = "markonverter.settings";
var staleRateRefresh = null;
chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  void handleRequest(request).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});
chrome.action.onClicked.addListener(() => {
  void openOptionsPage();
});
async function handleRequest(request) {
  if (request.type === "GET_SETTINGS") {
    return { ok: true, settings: await getSettingsWithFreshRates() };
  }
  if (request.type === "SAVE_SETTINGS") {
    const settings = normalizeSettings(request.settings);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { ok: true, settings };
  }
  if (request.type === "REFRESH_CURRENCY_RATES") {
    const { settings, result } = await refreshAndStoreCurrencyRates(await getStoredSettings(), request.provider);
    return { ok: true, settings, rateResult: result };
  }
  if (request.type === "UPSERT_PICKUP_POINT") {
    const settings = upsertPickupPoint(await getStoredSettings(), request.pickupPoint);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { ok: true, settings };
  }
  if (request.type === "DELETE_PICKUP_POINT") {
    const settings = deletePickupPoint(await getStoredSettings(), request.pickupPointId);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { ok: true, settings };
  }
  if (request.type === "SET_COMPARISON_PICKUP_POINT_IDS") {
    const settings = setComparisonPickupPointIds(await getStoredSettings(), request.pickupPointIds);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { ok: true, settings };
  }
  if (request.type === "SAVE_MANUAL_QUOTE") {
    const settings = upsertManualQuote(await getStoredSettings(), request.manualQuote);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { ok: true, settings };
  }
  if (request.type === "OPEN_OPTIONS") {
    await openOptionsPage();
    return { ok: true };
  }
  return { ok: false, error: "Unknown request" };
}
async function openOptionsPage() {
  const url = chrome.runtime.getURL("options.html");
  try {
    await chrome.tabs.create({ url });
  } catch {
    await chrome.runtime.openOptionsPage();
  }
}
async function ensureSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
}
async function getStoredSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}
async function getSettingsWithFreshRates() {
  const settings = await getStoredSettings();
  if (isCurrencyRateCacheFresh(settings)) {
    return settings;
  }
  staleRateRefresh ||= refreshAndStoreCurrencyRates(settings).then(({ settings: settings2 }) => settings2).catch((error) => {
    console.warn("Markonverter currency rate update failed", error);
    return settings;
  }).finally(() => {
    staleRateRefresh = null;
  });
  return staleRateRefresh;
}
async function refreshAndStoreCurrencyRates(settings, provider = settings.currencyRateProvider) {
  const result = await fetchCurrencyRates(provider);
  const nextSettings = applyCurrencyRateResult(settings, result, provider);
  await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
  return { settings: nextSettings, result };
}
//# sourceMappingURL=background.js.map
