// Session persistence for the Ozon price sweeps (silent + reload). State is
// kept in sessionStorage so it survives the reloads the sweep triggers, and is
// mirrored per-tab in chrome.storage.session (via the background) because
// sessionStorage is per-origin: activating a pickup point in the other country
// makes the reload land on the other Ozon domain (ozon.ru<->ozon.kz), which
// would otherwise orphan the sweep state and never return to the original point.

import { runtimeRequest } from "./runtime";

const OZON_SILENT_SWEPT_SESSION_PREFIX = "markonverter.ozonSilentSwept.v1:";
const OZON_SWEEP_STATE_KEY = "markonverter.ozonSweep.v1";
const OZON_SWEPT_SESSION_PREFIX = "markonverter.ozonSwept.v1:";
const OZON_UNAVAILABLE_SESSION_PREFIX = "markonverter.ozonUnavailable.v1:";
const OZON_DOOMED_SESSION_PREFIX = "markonverter.ozonDoomed.v1:";
const OZON_THROTTLED_UNTIL_KEY = "markonverter.ozonThrottledUntil.v1";
const OZON_SWEEP_THROTTLE_MS = 60_000;
const OZON_SWEEP_SESSION_KEY_PREFIX = "markonverter.ozon";

// Replace the local per-origin copy of the sweep keys with the per-tab mirror
// the background keeps. Runs once per page load, before any sweep decision, so
// a sweep interrupted by an ozon.ru<->ozon.kz domain flip resumes here instead
// of being forgotten (which stranded the user on the flipped-to pickup point).
let ozonSweepSessionHydration: Promise<void> | null = null;

export function hydrateOzonSweepSession(): Promise<void> {
  ozonSweepSessionHydration ||= (async () => {
    try {
      const response = await runtimeRequest({ type: "OZON_SWEEP_SESSION_GET" });
      if (!response.ok || !("entries" in response)) {
        return;
      }
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith(OZON_SWEEP_SESSION_KEY_PREFIX)) {
          sessionStorage.removeItem(key);
        }
      }
      for (const [key, value] of Object.entries(response.entries)) {
        sessionStorage.setItem(key, value);
      }
    } catch {
      // Best effort: without the mirror the sweep still works within one origin.
    }
  })();
  return ozonSweepSessionHydration;
}

function mirrorOzonSweepSessionEntry(key: string, value: string | null): void {
  void runtimeRequest({ type: "OZON_SWEEP_SESSION_SET", entries: { [key]: value } }).catch(() => undefined);
}

export interface OzonSweepState {
  productId: string;
  originalActive: string | null;
  originalHref: string;
  pending: string[];
  priced: string[];
  unavailable: string[];
  // 0 = still pricing; 1 = navigated back to the original page, need to reselect;
  // 2 = original pickup point reselected, ready to finish.
  returnStage: 0 | 1 | 2;
  // The head of `pending` was already re-tried once after an address switch
  // that did not take (common on the first cross-country attempt).
  retriedHead?: boolean;
}

export function loadOzonSweepState(): OzonSweepState | null {
  try {
    const raw = sessionStorage.getItem(OZON_SWEEP_STATE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as OzonSweepState;
    if (!parsed || typeof parsed.productId !== "string" || !Array.isArray(parsed.pending)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function canPersistOzonSweepState(): boolean {
  const probeKey = OZON_SWEEP_STATE_KEY + ".probe";
  try {
    sessionStorage.setItem(probeKey, "1");
    const persisted = sessionStorage.getItem(probeKey) === "1";
    sessionStorage.removeItem(probeKey);
    return persisted;
  } catch {
    return false;
  }
}

export function saveOzonSweepState(state: OzonSweepState): void {
  const value = JSON.stringify(state);
  try {
    sessionStorage.setItem(OZON_SWEEP_STATE_KEY, value);
  } catch {
    // sessionStorage may be unavailable in some privacy modes; sweeping is best-effort.
  }
  mirrorOzonSweepSessionEntry(OZON_SWEEP_STATE_KEY, value);
}

export function clearOzonSweepState(): void {
  try {
    sessionStorage.removeItem(OZON_SWEEP_STATE_KEY);
  } catch {
    // Ignore storage failures.
  }
  mirrorOzonSweepSessionEntry(OZON_SWEEP_STATE_KEY, null);
}

export function markOzonProductSwept(productId: string): void {
  try {
    sessionStorage.setItem(OZON_SWEPT_SESSION_PREFIX + productId, "1");
  } catch {
    // Ignore storage failures.
  }
  mirrorOzonSweepSessionEntry(OZON_SWEPT_SESSION_PREFIX + productId, "1");
}

export function isOzonProductSwept(productId: string): boolean {
  try {
    return sessionStorage.getItem(OZON_SWEPT_SESSION_PREFIX + productId) === "1";
  } catch {
    return false;
  }
}

export function markOzonProductSilentSwept(productId: string): void {
  try {
    sessionStorage.setItem(OZON_SILENT_SWEPT_SESSION_PREFIX + productId, "1");
  } catch {
    // Ignore storage failures.
  }
  mirrorOzonSweepSessionEntry(OZON_SILENT_SWEPT_SESSION_PREFIX + productId, "1");
}

export function isOzonProductSilentSwept(productId: string): boolean {
  try {
    return sessionStorage.getItem(OZON_SILENT_SWEPT_SESSION_PREFIX + productId) === "1";
  } catch {
    return false;
  }
}

function loadOzonSessionUnavailable(productId: string): string[] {
  try {
    const raw = sessionStorage.getItem(OZON_UNAVAILABLE_SESSION_PREFIX + productId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function persistOzonSessionUnavailable(productId: string, ids: string[]): void {
  try {
    const merged = [...new Set([...loadOzonSessionUnavailable(productId), ...ids.filter(Boolean)])];
    const value = JSON.stringify(merged);
    sessionStorage.setItem(OZON_UNAVAILABLE_SESSION_PREFIX + productId, value);
    mirrorOzonSweepSessionEntry(OZON_UNAVAILABLE_SESSION_PREFIX + productId, value);
  } catch {
    // Ignore storage failures.
  }
}

export function isOzonPickupSessionUnavailable(productId: string, externalLocationId: string): boolean {
  return externalLocationId.trim() !== "" && loadOzonSessionUnavailable(productId).includes(externalLocationId);
}

// A point whose activation never confirms is a structural id-space mismatch
// (see wiki/maps/ozon-sweep-live-bug-report-2026-07-07.md), not a per-product
// condition, so this is remembered for the whole tab session rather than per
// product: it stops every later product page from repeating the same doomed
// silent-sweep/retry/return reload sequence for this point.
export function markOzonPickupActivationDoomed(externalLocationId: string): void {
  try {
    sessionStorage.setItem(OZON_DOOMED_SESSION_PREFIX + externalLocationId, "1");
  } catch {
    // Ignore storage failures.
  }
  mirrorOzonSweepSessionEntry(OZON_DOOMED_SESSION_PREFIX + externalLocationId, "1");
}

export function isOzonPickupActivationDoomed(externalLocationId: string): boolean {
  try {
    return sessionStorage.getItem(OZON_DOOMED_SESSION_PREFIX + externalLocationId) === "1";
  } catch {
    return false;
  }
}

// Short backoff after Ozon's antibot returns HTTP 403: starting another
// multi-request sweep immediately only deepens the block.
export function markOzonSweepThrottled(): void {
  const value = String(Date.now() + OZON_SWEEP_THROTTLE_MS);
  try {
    sessionStorage.setItem(OZON_THROTTLED_UNTIL_KEY, value);
  } catch {
    // Ignore storage failures.
  }
  mirrorOzonSweepSessionEntry(OZON_THROTTLED_UNTIL_KEY, value);
}

export function isOzonSweepThrottled(): boolean {
  try {
    const raw = sessionStorage.getItem(OZON_THROTTLED_UNTIL_KEY);
    return raw !== null && Date.now() < Number(raw);
  } catch {
    return false;
  }
}
