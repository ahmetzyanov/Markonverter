import { ExtensionSettings, PickupPoint } from "./types";
import { normalizeSettings } from "./validation";

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
  } else {
    nextPickupPoints.push(nextPoint);
  }

  return normalizeSettings({
    ...normalized,
    pickupPoints: nextPickupPoints
  });
}
