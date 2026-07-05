import { ExtensionSettings, ManualQuote, MAX_SAVED_OZON_PICKUP_POINTS, PickupPoint } from "./types";
import { normalizeSettings } from "./validation";

export const SETTINGS_KEY = "markonverter.settings";

export function manualQuoteKey(productId: string, pickupPointId: string): string {
  return `${productId}:${pickupPointId}`;
}

export type SettingsWriteRejection = "invalid" | "limit";

export type SettingsWriteResult =
  | { saved: true; settings: ExtensionSettings }
  | { saved: false; reason: SettingsWriteRejection; settings: ExtensionSettings };

export function upsertPickupPoint(settings: ExtensionSettings, pickupPoint: PickupPoint): SettingsWriteResult {
  const normalized = normalizeSettings(settings);
  const nextPoint = normalizeSettings({ ...normalized, pickupPoints: [pickupPoint] }).pickupPoints[0];
  if (!nextPoint) {
    return { saved: false, reason: "invalid", settings: normalized };
  }

  const nextPickupPoints = [...normalized.pickupPoints];
  const existingIndex = nextPickupPoints.findIndex(
    (existing) =>
      existing.id === nextPoint.id ||
      (existing.marketplace === nextPoint.marketplace &&
        existing.externalLocationId.trim() !== "" &&
        existing.externalLocationId === nextPoint.externalLocationId)
  );

  if (existingIndex >= 0) {
    nextPickupPoints[existingIndex] = {
      ...nextPoint,
      id: nextPickupPoints[existingIndex].id
    };
  } else if (nextPoint.marketplace === "ozon" && countOzonPickupPoints(nextPickupPoints) >= MAX_SAVED_OZON_PICKUP_POINTS) {
    return { saved: false, reason: "limit", settings: normalized };
  } else {
    nextPickupPoints.push(nextPoint);
  }

  return {
    saved: true,
    settings: normalizeSettings({
      ...normalized,
      pickupPoints: nextPickupPoints
    })
  };
}

export function deletePickupPoint(settings: ExtensionSettings, pickupPointId: string): ExtensionSettings {
  const normalized = normalizeSettings(settings);
  const pickupPoints = normalized.pickupPoints.filter((point) => point.id !== pickupPointId);
  const comparisonPickupPointIds = normalized.comparisonPickupPointIds?.filter((id) => id !== pickupPointId) ?? null;
  const manualQuotes = Object.fromEntries(
    Object.entries(normalized.manualQuotes).filter(([, quote]) => quote.pickupPointId !== pickupPointId)
  );
  return normalizeSettings({
    ...normalized,
    pickupPoints,
    comparisonPickupPointIds,
    manualQuotes
  });
}

export function setComparisonPickupPointIds(settings: ExtensionSettings, pickupPointIds: string[] | null): ExtensionSettings {
  const normalized = normalizeSettings(settings);
  return normalizeSettings({
    ...normalized,
    comparisonPickupPointIds: pickupPointIds
  });
}

export function upsertManualQuote(settings: ExtensionSettings, manualQuote: ManualQuote): SettingsWriteResult {
  const normalized = normalizeSettings(settings);
  const key = manualQuoteKey(manualQuote.productId, manualQuote.pickupPointId);
  const next = normalizeSettings({
    ...normalized,
    manualQuotes: {
      ...normalized.manualQuotes,
      [key]: manualQuote
    }
  });
  // normalizeSettings drops quotes with an unknown pickupPointId or invalid price.
  if (!(key in next.manualQuotes)) {
    return { saved: false, reason: "invalid", settings: normalized };
  }
  return { saved: true, settings: next };
}

function countOzonPickupPoints(pickupPoints: PickupPoint[]): number {
  return pickupPoints.filter((point) => point.marketplace === "ozon").length;
}
