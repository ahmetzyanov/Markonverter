import { extractOzonPickupCandidatesFromSources } from "../src/marketplaces/ozon-pickup-capture";

describe("Ozon pickup capture", () => {
  it("extracts selected delivery address candidates from Ozon-shaped state", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "network.composer",
        urlHint: "https://www.ozon.kz/product/example",
        value: {
          delivery: {
            selectedAddress: {
              deliveryAddressOid: "kz-pvz-12345",
              fullAddress: "Kazakhstan, Almaty, Dostyk 1"
            }
          }
        }
      }
    ]);

    expect(candidates[0]).toMatchObject({
      externalLocationId: "kz-pvz-12345",
      name: "Kazakhstan, Almaty, Dostyk 1",
      country: "KZ",
      currency: "KZT"
    });
  });

  it("does not treat product ids as pickup point ids", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "network.product",
        value: {
          product: {
            productId: "123456789",
            title: "Phone"
          }
        }
      }
    ]);

    expect(candidates).toHaveLength(0);
  });
});
