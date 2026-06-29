import { ExtensionSettings, PickupPoint } from "./types";

export type RuntimeRequest =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "UPSERT_PICKUP_POINT"; pickupPoint: PickupPoint }
  | { type: "DELETE_PICKUP_POINT"; pickupPointId: string }
  | { type: "SET_COMPARISON_PICKUP_POINT_IDS"; pickupPointIds: string[] | null }
  | { type: "SAVE_SELECTED_OZON_PICKUP" }
  | { type: "OPEN_OPTIONS" };

export type RuntimeResponse =
  | { ok: true; settings: ExtensionSettings }
  | { ok: true }
  | { ok: false; error: string };
