import { ExtensionSettings, MarketplaceId, PickupPoint, PriceQuote, ProductIdentity } from "../shared/types";

export interface MarketplaceAdapterContext {
  requestOzonPrice?: (request: {
    productId: string;
    productUrl: string;
    pickupExternalLocationId: string;
    currencyHint: "RUB" | "KZT";
  }) => Promise<PriceQuote>;
}

export interface MarketplaceAdapter {
  id: MarketplaceId;
  name: string;
  supported: boolean;
  isProductPage(url: URL): boolean;
  getProductIdentity(url: URL, document: Document): ProductIdentity | null;
  fetchPrice(
    product: ProductIdentity,
    pickupPoint: PickupPoint,
    settings: ExtensionSettings
  ): Promise<PriceQuote>;
  formatError(error: unknown): string;
}
