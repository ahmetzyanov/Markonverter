import { RuntimeRequest, RuntimeResponse } from "./shared/messages";
import { DEFAULT_SETTINGS, ExtensionSettings } from "./shared/types";
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

async function handleRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
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
