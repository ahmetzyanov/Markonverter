import { RuntimeRequest, RuntimeResponse } from "./shared/messages";
import { DEFAULT_SETTINGS, ExtensionSettings } from "./shared/types";
import { deletePickupPoint, setComparisonPickupPointIds, upsertPickupPoint } from "./shared/settings";
import { normalizeSettings } from "./shared/validation";

const SETTINGS_KEY = "markonverter.settings";

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
  if (request.type === "DELETE_PICKUP_POINT") {
    const settings = deletePickupPoint(await getSettings(), request.pickupPointId);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { ok: true, settings };
  }
  if (request.type === "SET_COMPARISON_PICKUP_POINT_IDS") {
    const settings = setComparisonPickupPointIds(await getSettings(), request.pickupPointIds);
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

async function handleActionClick(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !tab.url || !isOzonProductUrl(tab.url)) {
    await chrome.runtime.openOptionsPage();
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

async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}
