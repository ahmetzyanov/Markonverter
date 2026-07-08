import { DEFAULT_LANGUAGE_PREFERENCE, type LanguagePreference } from "./i18n";

export type Currency = "RUB" | "KZT";

export type CurrencyRateProvider = "manual" | "cbr" | "nbk" | "exchangeRateApi";

export type MarketplaceId = "ozon" | "wildberries";

export type PickupCountry = "RU" | "KZ" | string;

export interface PickupPoint {
  id: string;
  name: string;
  marketplace: MarketplaceId;
  country: PickupCountry;
  currency: Currency;
  externalLocationId: string;
  comment?: string;
  // Location ids Ozon itself echoes for this point's address (areaid/fias/uid).
  // Addressbook address UUIDs never appear in Ozon's selected-location
  // responses, so without these aliases the extension can neither confirm a
  // price read nor recognize the point as currently active (see
  // wiki/maps/ozon-sweep-live-bug-report-2026-07-07.md, root cause 1). Learned
  // once when the visible delivery text confirms the point is active.
  locationAliasIds?: string[];
}

export interface ExtensionSettings {
  language: LanguagePreference;
  debug: boolean;
  defaultCurrency: Currency;
  inlineConvertedPrices: boolean;
  currencyRateProvider: CurrencyRateProvider;
  currencyRateMeta?: CurrencyRateMetadata;
  ratesToRub: Record<Currency, number>;
  pickupPoints: PickupPoint[];
  comparisonPickupPointIds: string[] | null;
  manualQuotes: Record<string, ManualQuote>;
}

export interface CurrencyRateMetadata {
  provider: CurrencyRateProvider;
  updatedAt: string;
  effectiveDate?: string;
  fallbackUsed?: boolean;
}

export interface CurrencyRateRefreshResult extends CurrencyRateMetadata {
  ratesToRub: Record<Currency, number>;
  attemptedProviders: CurrencyRateProvider[];
}

export interface ProductIdentity {
  marketplace: MarketplaceId;
  productId: string;
  url: string;
  title?: string;
}

export interface PriceQuote {
  amount: number;
  currency: Currency;
  rawText?: string;
  deliveryText?: string;
  source?: "api" | "manual";
  capturedAt?: string;
}

export interface ManualQuote {
  productId: string;
  productUrl: string;
  pickupPointId: string;
  quote: PriceQuote;
  capturedAt: string;
}

export type ComparisonResult =
  | {
      pickupPointId: string;
      status: "success";
      originalPrice: PriceQuote;
      convertedAmount: number;
      convertedCurrency: Currency;
    }
  | {
      pickupPointId: string;
      status: "error";
      error: string;
    };

export interface ComparisonRow {
  pickupPoint: PickupPoint;
  result: ComparisonResult;
  deltaFromCheapest?: number;
  isCheapest: boolean;
}

export const SUPPORTED_CURRENCIES: Currency[] = ["RUB", "KZT"];

export const SUPPORTED_CURRENCY_RATE_PROVIDERS: CurrencyRateProvider[] = ["manual", "cbr", "nbk", "exchangeRateApi"];

export const MAX_SAVED_OZON_PICKUP_POINTS = 4;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  language: DEFAULT_LANGUAGE_PREFERENCE,
  debug: false,
  defaultCurrency: "RUB",
  inlineConvertedPrices: true,
  currencyRateProvider: "cbr",
  ratesToRub: {
    RUB: 1,
    KZT: 0.17
  },
  pickupPoints: [],
  comparisonPickupPointIds: null,
  manualQuotes: {}
};
