import { extractOzonPrice, responseContainsLocation } from "../src/marketplaces/ozon-private-api";

describe("Ozon private API parsing", () => {
  it("requires the requested pickup location to be present in the response", () => {
    expect(responseContainsLocation({ delivery: { addressOid: "location-123" } }, "location-123")).toBe(true);
    expect(responseContainsLocation({ delivery: { addressOid: "other-location" } }, "location-123")).toBe(false);
  });

  it("prefers final web price over old price and delivery price", () => {
    const json = {
      widgetStates: {
        webPrice: JSON.stringify({
          price: "1 200 ₽",
          oldPrice: "1 900 ₽"
        })
      },
      delivery: {
        deliveryPrice: "99 ₽"
      }
    };

    expect(extractOzonPrice(json, "RUB")).toEqual({
      amount: 1200,
      currency: "RUB",
      rawText: "1 200 ₽"
    });
  });

  it("rejects ambiguous equal-score price candidates", () => {
    const json = {
      priceBlock: {
        visiblePrice: "1000 ₽",
        anotherPrice: "900 ₽"
      }
    };

    expect(extractOzonPrice(json, "RUB")).toBeNull();
  });
});
