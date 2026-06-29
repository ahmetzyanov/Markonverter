import { fetchOzonPrivatePrice, extractOzonDeliveryText, extractOzonPrice, responseContainsLocation } from "../src/marketplaces/ozon-private-api";

import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Ozon private API parsing", () => {
  it("requires the requested pickup location to be present in the response", () => {
    expect(responseContainsLocation({ delivery: { addressOid: "location-123" } }, "location-123")).toBe(true);
    expect(responseContainsLocation({ delivery: { addressOid: "other-location" } }, "location-123")).toBe(false);
  });

  it("does not accept a request echo as pickup location confirmation", () => {
    expect(
      responseContainsLocation(
        {
          requestEcho: {
            deliveryAddressOid: "location-123",
            url: "/product/item/?deliveryAddressOid=location-123"
          },
          delivery: {
            selectedAddressOid: "other-location"
          }
        },
        "location-123"
      )
    ).toBe(false);
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

  it("extracts a compact delivery summary when Ozon exposes one", () => {
    expect(
      extractOzonDeliveryText({
        deliveryWidget: {
          deliveryTime: "Tomorrow, 10:00-18:00",
          deliveryPrice: "99 ₽"
        }
      })
    ).toBe("Tomorrow, 10:00-18:00");
  });

  it("rejects a current-location response reused for another saved pickup point", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            requestEcho: {
              deliveryAddressOid: "ru-123"
            },
            delivery: {
              selectedAddressOid: "kz-456",
              deliveryTime: "Tomorrow"
            },
            widgetStates: {
              webPrice: JSON.stringify({
                price: "100 000 ₸"
              })
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      })
    );

    await expect(
      fetchOzonPrivatePrice({
        productId: "2229282395",
        productUrl: "https://ozon.kz/product/fake-product-2229282395/",
        pickupExternalLocationId: "ru-123",
        currencyHint: "RUB"
      })
    ).rejects.toThrow("response did not confirm requested pickup point");
  });

  it("accepts a response when the selected delivery address matches the requested pickup point", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            delivery: {
              selectedAddressOid: "kz-456",
              deliveryTime: "Tomorrow"
            },
            widgetStates: {
              webPrice: JSON.stringify({
                price: "100 000 ₸"
              })
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      })
    );

    await expect(
      fetchOzonPrivatePrice({
        productId: "2229282395",
        productUrl: "https://ozon.kz/product/fake-product-2229282395/",
        pickupExternalLocationId: "kz-456",
        currencyHint: "KZT"
      })
    ).resolves.toEqual({
      amount: 100000,
      currency: "KZT",
      rawText: "100 000 ₸",
      deliveryText: "Tomorrow"
    });
  });
});
