import { DEFAULT_SETTINGS, ExtensionSettings, PickupPoint, SUPPORTED_CURRENCIES } from "./types";

export function normalizeSettings(value: unknown): ExtensionSettings {
  const candidate = value as Partial<ExtensionSettings> | undefined;
  const pickupPoints = Array.isArray(candidate?.pickupPoints)
    ? candidate.pickupPoints.filter(isPickupPointLike).map(normalizePickupPoint)
    : [];
  return {
    defaultCurrency:
      candidate?.defaultCurrency && SUPPORTED_CURRENCIES.includes(candidate.defaultCurrency)
        ? candidate.defaultCurrency
        : DEFAULT_SETTINGS.defaultCurrency,
    ratesToRub: {
      RUB: sanitizeRate(candidate?.ratesToRub?.RUB, DEFAULT_SETTINGS.ratesToRub.RUB),
      KZT: sanitizeRate(candidate?.ratesToRub?.KZT, DEFAULT_SETTINGS.ratesToRub.KZT)
    },
    pickupPoints,
    comparisonPickupPointIds: normalizeComparisonPickupPointIds(candidate?.comparisonPickupPointIds, pickupPoints)
  };
}

export function validatePickupPoint(pickupPoint: PickupPoint): string[] {
  const errors: string[] = [];
  if (!pickupPoint.name.trim()) {
    errors.push("Name is required");
  }
  if (pickupPoint.marketplace !== "ozon" && pickupPoint.marketplace !== "wildberries") {
    errors.push("Marketplace is unsupported");
  }
  if (pickupPoint.marketplace === "ozon" && !pickupPoint.externalLocationId.trim()) {
    errors.push("Ozon location id is required");
  }
  if (!SUPPORTED_CURRENCIES.includes(pickupPoint.currency)) {
    errors.push("Currency is unsupported");
  }
  if (!pickupPoint.country.trim()) {
    errors.push("Country is required");
  }
  return errors;
}

function sanitizeRate(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isPickupPointLike(value: unknown): value is PickupPoint {
  const candidate = value as Partial<PickupPoint> | undefined;
  return typeof candidate?.id === "string" && typeof candidate.name === "string";
}

function normalizePickupPoint(pickupPoint: PickupPoint): PickupPoint {
  return {
    id: pickupPoint.id,
    name: pickupPoint.name,
    marketplace: pickupPoint.marketplace === "wildberries" ? "wildberries" : "ozon",
    country: pickupPoint.country || "RU",
    currency: SUPPORTED_CURRENCIES.includes(pickupPoint.currency) ? pickupPoint.currency : "RUB",
    externalLocationId: pickupPoint.externalLocationId || "",
    comment: pickupPoint.comment || ""
  };
}

function normalizeComparisonPickupPointIds(value: unknown, pickupPoints: PickupPoint[]): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const knownIds = new Set(pickupPoints.map((point) => point.id));
  return [...new Set(value.filter((id): id is string => typeof id === "string" && knownIds.has(id)))];
}
