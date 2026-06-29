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

// src/shared/settings.ts
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
chrome.action.onClicked.addListener((tab) => {
  void handleActionClick(tab);
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
  if (request.type === "UPSERT_PICKUP_POINT") {
    const settings = upsertPickupPoint(await getSettings(), request.pickupPoint);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { ok: true, settings };
  }
  if (request.type === "OPEN_OPTIONS") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }
  if (request.type === "SAVE_SELECTED_OZON_PICKUP") {
    return { ok: false, error: "Open an Ozon product page to save the selected pickup point" };
  }
  return { ok: false, error: "Unknown request" };
}
async function handleActionClick(tab) {
  if (!tab.id || !tab.url || !isOzonProductUrl(tab.url)) {
    await chrome.runtime.openOptionsPage();
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SAVE_SELECTED_OZON_PICKUP" });
    await showActionFeedback(tab.id, response?.ok ? "OK" : "!");
    if (!response?.ok) {
      console.warn("Markonverter pickup save failed", response?.error || "No response from Ozon page");
    }
  } catch (error) {
    await showActionFeedback(tab.id, "!");
    console.warn("Markonverter pickup save failed", error);
  }
}
async function showActionFeedback(tabId, text) {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: text === "OK" ? "#2f8f4e" : "#b42318" });
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: "" });
  }, 2500);
}
function isOzonProductUrl(value) {
  try {
    const url = new URL(value);
    return (url.hostname === "ozon.ru" || url.hostname.endsWith(".ozon.ru") || url.hostname === "ozon.kz" || url.hostname.endsWith(".ozon.kz")) && /\/product\/(?:[^/?#]+-)?\d+(?:[/?#]|$)/.test(url.pathname);
  } catch {
    return false;
  }
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
