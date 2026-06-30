import { RuntimeRequest, RuntimeResponse } from "./shared/messages";
import { CurrencyRateProvider, CurrencyRateRefreshResult, DEFAULT_SETTINGS, ExtensionSettings } from "./shared/types";
import { applyCurrencyRateResult, fetchCurrencyRates, isCurrencyRateCacheFresh } from "./shared/exchange-rates";
import { deletePickupPoint, setComparisonPickupPointIds, upsertManualQuote, upsertPickupPoint } from "./shared/settings";
import { normalizeSettings } from "./shared/validation";

const SETTINGS_KEY = "markonverter.settings";
let staleRateRefresh: Promise<ExtensionSettings> | null = null;

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});

chrome.runtime.onMessage.addListener((request: RuntimeRequest, _sender, sendResponse) => {
  void handleRequest(request)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies RuntimeResponse);
    });
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  void handleActionClick(tab);
});

async function handleRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
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
  if (request.type === "SAVE_SELECTED_OZON_PICKUP") {
    return { ok: false, error: "Open an Ozon product page to save the selected pickup point" };
  }
  return { ok: false, error: "Unknown request" };
}

async function handleActionClick(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !tab.url || !isOzonProductUrl(tab.url)) {
    await openOptionsPage();
    return;
  }

  try {
    const response = (await chrome.tabs.sendMessage(tab.id, { type: "SAVE_SELECTED_OZON_PICKUP" } satisfies RuntimeRequest)) as
      | RuntimeResponse
      | undefined;
    await showActionFeedback(tab.id, response?.ok ? "OK" : "!");
    if (!response?.ok) {
      console.warn("Markonverter pickup save failed", response?.error || "No response from Ozon page");
    }
  } catch (error) {
    await showActionFeedback(tab.id, "!");
    console.warn("Markonverter pickup save failed", error);
  }
}

async function openOptionsPage(): Promise<void> {
  const url = chrome.runtime.getURL("options.html");
  try {
    await chrome.tabs.create({ url });
  } catch {
    await chrome.runtime.openOptionsPage();
  }
}

async function showActionFeedback(tabId: number, text: string): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: text === "OK" ? "#2f8f4e" : "#b42318" });
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: "" });
  }, 2500);
}

function isOzonProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.hostname === "ozon.ru" || url.hostname.endsWith(".ozon.ru") || url.hostname === "ozon.kz" || url.hostname.endsWith(".ozon.kz")) &&
      /\/product\/(?:[^/?#]+-)?\d+(?:[/?#]|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

async function ensureSettings(): Promise<void> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
}

async function getStoredSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

async function getSettingsWithFreshRates(): Promise<ExtensionSettings> {
  const settings = await getStoredSettings();
  if (isCurrencyRateCacheFresh(settings)) {
    return settings;
  }

  staleRateRefresh ||= refreshAndStoreCurrencyRates(settings)
    .then(({ settings }) => settings)
    .catch((error) => {
      console.warn("Markonverter currency rate update failed", error);
      return settings;
    })
    .finally(() => {
      staleRateRefresh = null;
    });

  return staleRateRefresh;
}

async function refreshAndStoreCurrencyRates(
  settings: ExtensionSettings,
  provider: CurrencyRateProvider = settings.currencyRateProvider
): Promise<{ settings: ExtensionSettings; result: CurrencyRateRefreshResult }> {
  const result = await fetchCurrencyRates(provider);
  const nextSettings = applyCurrencyRateResult(settings, result, provider);
  await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
  return { settings: nextSettings, result };
}
