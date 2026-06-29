import { createOzonAdapter } from "./ozon";
import { MarketplaceAdapter, MarketplaceAdapterContext } from "./types";
import { wildberriesPlaceholder } from "./wildberries";
import { MarketplaceId, MarketplaceInfo } from "../shared/types";

export const MARKETPLACES: MarketplaceInfo[] = [
  { id: "ozon", name: "Ozon", supported: true },
  { id: "wildberries", name: "Wildberries", supported: false }
];

export function createMarketplaceAdapter(
  marketplaceId: MarketplaceId,
  context: MarketplaceAdapterContext = {}
): MarketplaceAdapter {
  if (marketplaceId === "ozon") {
    return createOzonAdapter(context);
  }
  return wildberriesPlaceholder;
}
