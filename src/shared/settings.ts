import { ExtensionSettings, ManualQuote, MAX_SAVED_OZON_PICKUP_POINTS, PickupPoint } from "./types";
import { normalizeSettings } from "./validation";

export function manualQuoteKey(productId: string, pickupPointId: string): string {
  return `${productId}:${pickupPointId}`;
}

export function upsertPickupPoint(settings: ExtensionSettings, pickupPoint: PickupPoint): ExtensionSettings {
  const normalized = normalizeSettings(settings);
  const nextPoint = normalizeSettings({ ...normalized, pickupPoints: [pickupPoint] }).pickupPoints[0];
  if (!nextPoint) {
    return normalized;
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
    return normalized;
  } else {
    nextPickupPoints.push(nextPoint);
  }

  return normalizeSettings({
    ...normalized,
    pickupPoints: nextPickupPoints
  });
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

export function upsertManualQuote(settings: ExtensionSettings, manualQuote: ManualQuote): ExtensionSettings {
  const normalized = normalizeSettings(settings);
  return normalizeSettings({
    ...normalized,
    manualQuotes: {
      ...normalized.manualQuotes,
      [manualQuoteKey(manualQuote.productId, manualQuote.pickupPointId)]: manualQuote
    }
  });
}

function countOzonPickupPoints(pickupPoints: PickupPoint[]): number {
  return pickupPoints.filter((point) => point.marketplace === "ozon").length;
}
