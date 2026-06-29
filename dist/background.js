// src/shared/types.ts
var SUPPORTED_CURRENCIES = ["RUB", "KZT"];
var DEFAULT_SETTINGS = {
  defaultCurrency: "RUB",
  ratesToRub: {
    RUB: 1,
    KZT: 0.17
  },
  pickupPoints: []
};

// src/shared/validation.ts
function normalizeSettings(value) {
  const candidate = value;
  return {
    defaultCurrency: candidate?.defaultCurrency && SUPPORTED_CURRENCIES.includes(candidate.defaultCurrency) ? candidate.defaultCurrency : DEFAULT_SETTINGS.defaultCurrency,
    ratesToRub: {
      RUB: sanitizeRate(candidate?.ratesToRub?.RUB, DEFAULT_SETTINGS.ratesToRub.RUB),
      KZT: sanitizeRate(candidate?.ratesToRub?.KZT, DEFAULT_SETTINGS.ratesToRub.KZT)
    },
    pickupPoints: Array.isArray(candidate?.pickupPoints) ? candidate.pickupPoints.filter(isPickupPointLike).map(normalizePickupPoint) : []
  };
}
function sanitizeRate(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
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

// src/background.ts
var SETTINGS_KEY = "markonverter.settings";
chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  void handleRequest(request).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});
async function handleRequest(request) {
  if (request.type === "GET_SETTINGS") {
    return { ok: true, settings: await getSettings() };
  }
  if (request.type === "SAVE_SETTINGS") {
    const settings = normalizeSettings(request.settings);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { ok: true, settings };
  }
  if (request.type === "OPEN_OPTIONS") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }
  return { ok: false, error: "Unknown request" };
}
async function ensureSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
}
async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}
//# sourceMappingURL=background.js.map
