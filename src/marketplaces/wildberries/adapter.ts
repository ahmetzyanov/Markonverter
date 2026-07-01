import { MarketplaceAdapter } from "../types";

export const wildberriesPlaceholder: MarketplaceAdapter = {
  id: "wildberries",
  name: "Wildberries",
  supported: false,
  isProductPage(): boolean {
    return false;
  },
  getProductIdentity() {
    return null;
  },
  async fetchPrice() {
    throw new Error("Wildberries integration is not implemented yet");
  },
  formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
};
