export type Currency = "RUB" | "KZT";

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
  defaultCurrency: Currency;
  ratesToRub: Record<Currency, number>;
  pickupPoints: PickupPoint[];
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

export const DEFAULT_SETTINGS: ExtensionSettings = {
  defaultCurrency: "RUB",
  ratesToRub: {
    RUB: 1,
    KZT: 0.17
  },
  pickupPoints: []
};
