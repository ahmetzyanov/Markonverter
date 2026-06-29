import { MarketplaceAdapter, MarketplaceAdapterContext } from "./types";
import { ExtensionSettings, PickupPoint, PriceQuote, ProductIdentity } from "../shared/types";

const OZON_PRODUCT_RE = /\/product\/(?:[^/?#]+-)?(\d+)(?:[/?#]|$)/;

export function createOzonAdapter(context: MarketplaceAdapterContext): MarketplaceAdapter {
  return {
    id: "ozon",
    name: "Ozon",
    supported: true,
    isProductPage(url: URL): boolean {
      return isOzonHost(url.hostname) && OZON_PRODUCT_RE.test(url.pathname);
    },
    getProductIdentity(url: URL, document: Document): ProductIdentity | null {
      const match = url.pathname.match(OZON_PRODUCT_RE);
      if (!match) {
        return null;
      }
      return {
        marketplace: "ozon",
        productId: match[1],
        url: url.toString(),
        title: document.querySelector("h1")?.textContent?.trim() || document.title || undefined
      };
    },
    async fetchPrice(
      product: ProductIdentity,
      pickupPoint: PickupPoint,
      _settings: ExtensionSettings
    ): Promise<PriceQuote> {
      if (!context.requestOzonPrice) {
        throw new Error("Ozon page bridge is not available");
      }
      return context.requestOzonPrice({
        productId: product.productId,
        productUrl: product.url,
        pickupExternalLocationId: pickupPoint.externalLocationId,
        currencyHint: pickupPoint.currency
      });
    },
    formatError(error: unknown): string {
      if (error instanceof Error) {
        return error.message;
      }
      return String(error);
    }
  };
}

function isOzonHost(hostname: string): boolean {
  return hostname === "ozon.ru" || hostname.endsWith(".ozon.ru") || hostname === "ozon.kz" || hostname.endsWith(".ozon.kz");
}
