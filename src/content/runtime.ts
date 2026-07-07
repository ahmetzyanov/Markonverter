import { RuntimeRequest, RuntimeResponse } from "../shared/messages";

export async function runtimeRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  try {
    return await chrome.runtime.sendMessage(request);
  } catch (error) {
    isExtensionContextGone();
    throw error;
  }
}

// After an extension reload/update, orphaned content scripts keep running but
// every runtime call throws. Latch the condition so timers/observers go quiet
// instead of spamming errors once per second in every open Ozon tab.
let extensionContextGone = false;

export function isExtensionContextGone(): boolean {
  if (!extensionContextGone && !chrome.runtime?.id) {
    extensionContextGone = true;
  }
  return extensionContextGone;
}
