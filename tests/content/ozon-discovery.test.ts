import { buildOzonPickupDiscoveryEndpoints, shouldAutoRefreshSavedOzonPickupNames } from "../../src/content/app";
import { ExtensionSettings, MarketplaceId } from "../../src/shared/types";

describe("Ozon content discovery", () => {
  it("builds product-scoped addressbook discovery without selecting a pickup point", () => {
    const endpoints = buildOzonPickupDiscoveryEndpoints({
      marketplace: "ozon",
      productId: "2229282395",
      url: "https://www.ozon.kz/product/fake-product-2229282395/?at=token&sh=share",
      title: "Fake product"
    });
    const productScoped = endpoints.filter((endpoint) => endpoint.label.includes("addressbook-product-context"));

    expect(productScoped).toHaveLength(3);
    expect(productScoped.every((endpoint) => !endpoint.url.includes("select_address") && !endpoint.url.includes("select_location"))).toBe(
      true
    );

    const getUrl = new URL(productScoped[0].url, "https://www.ozon.kz");
    expect(getUrl.searchParams.get("url")).toBe(
      "/modal/addressbook?src_main=%2Fproduct%2Ffake-product-2229282395%2F%3Fat%3Dtoken%26sh%3Dshare&page_changed=true"
    );
    expect(JSON.parse(productScoped[2].body || "{}")).toEqual({
      url: "/modal/addressbook?src_main=%2Fproduct%2Ffake-product-2229282395%2F%3Fat%3Dtoken%26sh%3Dshare&page_changed=true",
      referer: "/product/fake-product-2229282395/?at=token&sh=share"
    });
  });

  it("includes the read-only addressbook set_sm modal used by real Ozon selector refresh", () => {
    const endpoints = buildOzonPickupDiscoveryEndpoints({
      marketplace: "ozon",
      productId: "2103540263",
      url: "https://www.ozon.ru/product/example-2103540263/?at=token&sh=share",
      title: "Fake product"
    });
    const setSm = endpoints.filter((endpoint) => endpoint.label.includes("addressbook-set-sm"));

    expect(setSm).toHaveLength(3);
    expect(setSm.every((endpoint) => !endpoint.url.includes("select_address") && !endpoint.url.includes("select_location"))).toBe(true);
    expect(new URL(setSm[1].url, "https://www.ozon.ru").searchParams.get("url")).toBe(
      "/modal/addressbook?set_sm=1&page_changed=true"
    );
  });

  it("auto-refreshes saved names only for generic Ozon pickup labels", () => {
    expect(
      shouldAutoRefreshSavedOzonPickupNames(
        settingsWithPickupNames([
          ["ozon", "Ozon pickup daa6eeff-8093-429a-9fee-9c73e5ef6036", "daa6eeff-8093-429a-9fee-9c73e5ef6036"]
        ])
      )
    ).toBe(true);

    expect(shouldAutoRefreshSavedOzonPickupNames(settingsWithPickupNames([["ozon", "Буинск, ул. Вахитова, 174Б", "ru-123"]]))).toBe(
      false
    );
    expect(shouldAutoRefreshSavedOzonPickupNames(settingsWithPickupNames([["wildberries", "Ozon pickup ru-123", "ru-123"]]))).toBe(
      false
    );
  });
});

function settingsWithPickupNames(points: Array<[marketplace: MarketplaceId, name: string, externalLocationId: string]>): ExtensionSettings {
  return {
    defaultCurrency: "RUB",
    currencyRateProvider: "manual",
    ratesToRub: { RUB: 1, KZT: 0.17 },
    pickupPoints: points.map(([marketplace, name, externalLocationId], index): ExtensionSettings["pickupPoints"][number] => ({
      id: `point-${index}`,
      name,
      marketplace,
      country: "RU",
      currency: "RUB",
      externalLocationId
    })),
    comparisonPickupPointIds: null,
    manualQuotes: {}
  };
}
