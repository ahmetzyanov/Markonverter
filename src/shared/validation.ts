import {
  Currency,
  CurrencyRateMetadata,
  DEFAULT_SETTINGS,
  ExtensionSettings,
  ManualQuote,
  PickupPoint,
  PriceQuote,
  SUPPORTED_CURRENCIES,
  SUPPORTED_CURRENCY_RATE_PROVIDERS
} from "./types";
import { normalizeLanguagePreference } from "./i18n";

const MAX_REASONABLE_KZT_TO_RUB_RATE = 1;

export function normalizeSettings(value: unknown): ExtensionSettings {
  const candidate = value as Partial<ExtensionSettings> | undefined;
  const pickupPoints = Array.isArray(candidate?.pickupPoints)
    ? candidate.pickupPoints.filter(isPickupPointLike).map(normalizePickupPoint)
    : [];
  return {
    language: normalizeLanguagePreference(candidate?.language),
    debug: candidate?.debug === true,
    defaultCurrency:
      candidate?.defaultCurrency && SUPPORTED_CURRENCIES.includes(candidate.defaultCurrency)
        ? candidate.defaultCurrency
        : DEFAULT_SETTINGS.defaultCurrency,
    currencyRateProvider: SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(candidate?.currencyRateProvider as never)
      ? (candidate?.currencyRateProvider as ExtensionSettings["currencyRateProvider"])
      : DEFAULT_SETTINGS.currencyRateProvider,
    currencyRateMeta: normalizeCurrencyRateMeta(candidate?.currencyRateMeta),
    ratesToRub: {
      RUB: sanitizeRate(candidate?.ratesToRub?.RUB, DEFAULT_SETTINGS.ratesToRub.RUB),
      KZT: sanitizeRate(candidate?.ratesToRub?.KZT, DEFAULT_SETTINGS.ratesToRub.KZT, MAX_REASONABLE_KZT_TO_RUB_RATE)
    },
    pickupPoints,
    comparisonPickupPointIds: normalizeComparisonPickupPointIds(candidate?.comparisonPickupPointIds, pickupPoints),
    manualQuotes: normalizeManualQuotes(candidate?.manualQuotes, pickupPoints)
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

function sanitizeRate(value: unknown, fallback: number, max = Number.POSITIVE_INFINITY): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? value : fallback;
}

function normalizeCurrencyRateMeta(value: unknown): CurrencyRateMetadata | undefined {
  const candidate = value as Partial<CurrencyRateMetadata> | undefined;
  if (
    !candidate ||
    !SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(candidate.provider as never) ||
    typeof candidate.updatedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.updatedAt))
  ) {
    return undefined;
  }

  return {
    provider: candidate.provider as CurrencyRateMetadata["provider"],
    updatedAt: new Date(candidate.updatedAt).toISOString(),
    effectiveDate: typeof candidate.effectiveDate === "string" ? candidate.effectiveDate : undefined,
    fallbackUsed: candidate.fallbackUsed === true
  };
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

function normalizeManualQuotes(value: unknown, pickupPoints: PickupPoint[]): Record<string, ManualQuote> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const knownIds = new Set(pickupPoints.map((point) => point.id));
  const quotes: Record<string, ManualQuote> = {};
  for (const rawQuote of Object.values(value as Record<string, unknown>)) {
    const quote = normalizeManualQuote(rawQuote, knownIds);
    if (quote) {
      quotes[`${quote.productId}:${quote.pickupPointId}`] = quote;
    }
  }
  return quotes;
}

function normalizeManualQuote(value: unknown, knownPickupPointIds: Set<string>): ManualQuote | null {
  const candidate = value as Partial<ManualQuote> | undefined;
  if (
    !candidate ||
    typeof candidate.productId !== "string" ||
    typeof candidate.productUrl !== "string" ||
    typeof candidate.pickupPointId !== "string" ||
    typeof candidate.capturedAt !== "string" ||
    !knownPickupPointIds.has(candidate.pickupPointId)
  ) {
    return null;
  }

  const quote = normalizePriceQuote(candidate.quote);
  if (!quote) {
    return null;
  }

  return {
    productId: candidate.productId,
    productUrl: candidate.productUrl,
    pickupPointId: candidate.pickupPointId,
    quote: {
      ...quote,
      source: "manual",
      capturedAt: candidate.capturedAt
    },
    capturedAt: candidate.capturedAt
  };
}

function normalizePriceQuote(value: unknown): PriceQuote | null {
  const candidate = value as Partial<PriceQuote> | undefined;
  const currency =
    typeof candidate?.currency === "string" && SUPPORTED_CURRENCIES.includes(candidate.currency as Currency)
      ? (candidate.currency as Currency)
      : null;
  if (
    !candidate ||
    typeof candidate.amount !== "number" ||
    !Number.isFinite(candidate.amount) ||
    candidate.amount <= 0 ||
    !currency
  ) {
    return null;
  }

  return {
    amount: candidate.amount,
    currency,
    rawText: typeof candidate.rawText === "string" ? candidate.rawText : undefined,
    deliveryText: typeof candidate.deliveryText === "string" ? candidate.deliveryText : undefined
  };
}
