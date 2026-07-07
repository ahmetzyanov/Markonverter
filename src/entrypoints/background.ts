import { RuntimeRequest, RuntimeResponse } from "../shared/messages";
import { CurrencyRateProvider, CurrencyRateRefreshResult, DEFAULT_SETTINGS, ExtensionSettings } from "../shared/types";
import { applyCurrencyRateResult, fetchCurrencyRates, isCurrencyRateCacheFresh } from "../shared/exchange-rates";
import {
  deletePickupPoint,
  SETTINGS_KEY,
  setComparisonPickupPointIds,
  SettingsWriteResult,
  upsertManualQuote,
  upsertPickupPoint
} from "../shared/settings";
import { normalizeSettings } from "../shared/validation";
let staleRateRefresh: Promise<ExtensionSettings> | null = null;

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});

chrome.runtime.onMessage.addListener((request: RuntimeRequest, sender, sendResponse) => {
  void handleRequest(request, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies RuntimeResponse);
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(OZON_SWEEP_SESSION_PREFIX + tabId);
});

chrome.action.onClicked.addListener(() => {
  void openOptionsPage();
});

async function handleRequest(request: RuntimeRequest, sender: chrome.runtime.MessageSender): Promise<RuntimeResponse> {
  if (request.type === "OZON_SWEEP_SESSION_GET") {
    return { ok: true, entries: await readOzonSweepSession(sender.tab?.id) };
  }
  if (request.type === "OZON_SWEEP_SESSION_SET") {
    await mutateOzonSweepSession(sender.tab?.id, request.entries);
    return { ok: true };
  }
  if (request.type === "GET_SETTINGS") {
    return { ok: true, settings: await getSettingsWithFreshRates() };
  }
  if (request.type === "SAVE_SETTINGS") {
    return { ok: true, settings: await mutateSettings(() => normalizeSettings(request.settings)) };
  }
  if (request.type === "REFRESH_CURRENCY_RATES") {
    const { settings, result } = await refreshAndStoreCurrencyRates(await getStoredSettings(), request.provider);
    return { ok: true, settings, rateResult: result };
  }
  if (request.type === "UPSERT_PICKUP_POINT") {
    return applySettingsWrite((settings) => upsertPickupPoint(settings, request.pickupPoint));
  }
  if (request.type === "DELETE_PICKUP_POINT") {
    return { ok: true, settings: await mutateSettings((settings) => deletePickupPoint(settings, request.pickupPointId)) };
  }
  if (request.type === "SET_COMPARISON_PICKUP_POINT_IDS") {
    return {
      ok: true,
      settings: await mutateSettings((settings) => setComparisonPickupPointIds(settings, request.pickupPointIds))
    };
  }
  if (request.type === "SAVE_MANUAL_QUOTE") {
    return applySettingsWrite((settings) => upsertManualQuote(settings, request.manualQuote));
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

// Concurrent messages (two tabs, sweep + auto-capture) must not interleave
// their read-modify-write cycles, or the last writer silently drops the
// other's update. All settings writes are serialized through this queue.
let settingsWriteQueue: Promise<unknown> = Promise.resolve();

function mutateSettings(mutate: (settings: ExtensionSettings) => ExtensionSettings): Promise<ExtensionSettings> {
  const task = settingsWriteQueue.then(async () => {
    const settings = mutate(await getStoredSettings());
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return settings;
  });
  settingsWriteQueue = task.catch(() => undefined);
  return task;
}

const SETTINGS_WRITE_ERRORS = {
  invalid: "The write was rejected by validation",
  limit: "Saved Ozon pickup point limit reached"
} as const;

// A dropped write must not reply {ok: true}: the UI would report "saved" for a
// write that never happened.
async function applySettingsWrite(write: (settings: ExtensionSettings) => SettingsWriteResult): Promise<RuntimeResponse> {
  let outcome: SettingsWriteResult | undefined;
  const settings = await mutateSettings((current) => {
    outcome = write(current);
    return outcome.settings;
  });
  if (outcome && !outcome.saved) {
    return { ok: false, error: SETTINGS_WRITE_ERRORS[outcome.reason], reason: outcome.reason };
  }
  return { ok: true, settings };
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

// Per-tab mirror of the content script's Ozon sweep sessionStorage keys, so a
// sweep survives an ozon.ru<->ozon.kz domain flip within the same tab. Lives in
// chrome.storage.session: cleared when the browser closes, like sessionStorage.
const OZON_SWEEP_SESSION_PREFIX = "ozonSweepSession:";

// Reads chain through the same queue as writes so a GET fired right after a
// fire-and-forget SET (page navigating away) sees that write.
let sweepSessionQueue: Promise<unknown> = Promise.resolve();

function readOzonSweepSession(tabId: number | undefined): Promise<Record<string, string>> {
  const task = sweepSessionQueue.then(() => getOzonSweepSessionEntries(tabId));
  sweepSessionQueue = task.catch(() => undefined);
  return task;
}

function mutateOzonSweepSession(tabId: number | undefined, entries: Record<string, string | null>): Promise<void> {
  const task = sweepSessionQueue.then(async () => {
    if (tabId === undefined) {
      return;
    }
    const merged = await getOzonSweepSessionEntries(tabId);
    for (const [key, value] of Object.entries(entries)) {
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    await chrome.storage.session.set({ [OZON_SWEEP_SESSION_PREFIX + tabId]: merged });
  });
  sweepSessionQueue = task.catch(() => undefined);
  return task;
}

async function getOzonSweepSessionEntries(tabId: number | undefined): Promise<Record<string, string>> {
  if (tabId === undefined) {
    return {};
  }
  const key = OZON_SWEEP_SESSION_PREFIX + tabId;
  const stored = await chrome.storage.session.get(key);
  const value = stored[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function refreshAndStoreCurrencyRates(
  settings: ExtensionSettings,
  provider: CurrencyRateProvider = settings.currencyRateProvider
): Promise<{ settings: ExtensionSettings; result: CurrencyRateRefreshResult }> {
  const result = await fetchCurrencyRates(provider);
  const nextSettings = await mutateSettings((current) => applyCurrencyRateResult(current, result, provider));
  return { settings: nextSettings, result };
}
