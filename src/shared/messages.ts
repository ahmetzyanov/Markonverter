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
  | { type: "OPEN_OPTIONS" };

export type RuntimeResponse =
  | { ok: true; settings: ExtensionSettings; rateResult?: CurrencyRateRefreshResult }
  | { ok: true }
  | { ok: false; error: string; reason?: SettingsWriteRejection };
