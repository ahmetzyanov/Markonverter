import { ExtensionSettings, PickupPoint } from "./types";

export type RuntimeRequest =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "UPSERT_PICKUP_POINT"; pickupPoint: PickupPoint }
  | { type: "SAVE_SELECTED_OZON_PICKUP" }
  | { type: "OPEN_OPTIONS" };

export type RuntimeResponse =
  | { ok: true; settings: ExtensionSettings }
  | { ok: true }
  | { ok: false; error: string };
