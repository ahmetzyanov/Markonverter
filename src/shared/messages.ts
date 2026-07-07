import { CurrencyRateProvider, CurrencyRateRefreshResult, ExtensionSettings, ManualQuote, PickupPoint } from "./types";
import { SettingsWriteRejection } from "./settings";

export type RuntimeRequest =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "REFRESH_CURRENCY_RATES"; provider?: CurrencyRateProvider }
  | { type: "UPSERT_PICKUP_POINT"; pickupPoint: PickupPoint }
  | { type: "DELETE_PICKUP_POINT"; pickupPointId: string }
  | { type: "SET_COMPARISON_PICKUP_POINT_IDS"; pickupPointIds: string[] | null }
  | { type: "SAVE_MANUAL_QUOTE"; manualQuote: ManualQuote }
  | { type: "OPEN_OPTIONS" }
  // Per-tab mirror of the Ozon sweep sessionStorage keys. sessionStorage is
  // per-origin, so an ozon.ru<->ozon.kz domain flip mid-sweep would orphan the
  // sweep state; the background keeps a copy keyed by tab id that survives it.
  | { type: "OZON_SWEEP_SESSION_GET" }
  | { type: "OZON_SWEEP_SESSION_SET"; entries: Record<string, string | null> };

export type RuntimeResponse =
  | { ok: true; settings: ExtensionSettings; rateResult?: CurrencyRateRefreshResult }
  | { ok: true; entries: Record<string, string> }
  | { ok: true }
  | { ok: false; error: string; reason?: SettingsWriteRejection };
