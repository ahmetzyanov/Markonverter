import { ExtensionSettings } from "./types";

export type RuntimeRequest =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "OPEN_OPTIONS" };

export type RuntimeResponse =
  | { ok: true; settings: ExtensionSettings }
  | { ok: true }
  | { ok: false; error: string };
