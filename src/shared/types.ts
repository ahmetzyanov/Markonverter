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
}

export interface CapturedPickupPoint {
  name: string;
  marketplace: MarketplaceId;
  country: PickupCountry;
  currency: Currency;
  externalLocationId: string;
  comment?: string;
}

export interface ExtensionSettings {
  language: LanguagePreference;
  debug: boolean;
  defaultCurrency: Currency;
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

export interface MarketplaceInfo {
  id: MarketplaceId;
  name: string;
  supported: boolean;
}

export const SUPPORTED_CURRENCIES: Currency[] = ["RUB", "KZT"];

export const SUPPORTED_CURRENCY_RATE_PROVIDERS: CurrencyRateProvider[] = ["manual", "cbr", "nbk", "exchangeRateApi"];

export const MAX_SAVED_OZON_PICKUP_POINTS = 4;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  language: DEFAULT_LANGUAGE_PREFERENCE,
  debug: false,
  defaultCurrency: "RUB",
  currencyRateProvider: "cbr",
  ratesToRub: {
    RUB: 1,
    KZT: 0.17
  },
  pickupPoints: [],
  comparisonPickupPointIds: null,
  manualQuotes: {}
};
