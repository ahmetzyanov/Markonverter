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

chrome.action.onClicked.addListener(() => {
  void openOptionsPage();
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
  return { ok: false, error: "Unknown request" };
}

async function openOptionsPage(): Promise<void> {
  const url = chrome.runtime.getURL("options.html");
  try {
    await chrome.tabs.create({ url });
  } catch {
    await chrome.runtime.openOptionsPage();
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
