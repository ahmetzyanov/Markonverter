import { createMarketplaceAdapter, MARKETPLACES } from "../../src/marketplaces/registry";

describe("marketplace registry", () => {
  it("contains supported Ozon and future Wildberries placeholder", () => {
    expect(MARKETPLACES).toEqual([
      { id: "ozon", name: "Ozon", supported: true },
      { id: "wildberries", name: "Wildberries", supported: false }
    ]);
    expect(createMarketplaceAdapter("ozon").supported).toBe(true);
    expect(createMarketplaceAdapter("wildberries").supported).toBe(false);
  });
});
