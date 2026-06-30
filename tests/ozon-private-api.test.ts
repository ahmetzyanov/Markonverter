import {
  buildLocationActivationCandidates,
  fetchOzonPrivatePrice,
  extractOzonDeliveryText,
  extractOzonPrice,
  responseContainsLocation
} from "../src/marketplaces/ozon-private-api";

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

  it("tries to activate the saved pickup point before reading product price", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    let activated = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });

        if (url.includes("/modal/addressbook") || calls[calls.length - 1]?.body?.includes("/modal/addressbook")) {
          activated = true;
          return new Response(
            JSON.stringify({
              delivery: {
                selectedAddressOid: "ru-123"
              }
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            delivery: {
              selectedAddressOid: activated ? "ru-123" : "kz-456",
              deliveryTime: activated ? "Today" : "Tomorrow"
            },
            widgetStates: {
              webPrice: JSON.stringify({
                price: activated ? "1 200 ₽" : "100 000 ₸"
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
    ).resolves.toEqual({
      amount: 1200,
      currency: "RUB",
      rawText: "1 200 ₽",
      deliveryText: "Today"
    });
    expect(calls[0]?.url).toContain("select_address%3Dru-123");
    expect(calls.some((call) => call.url.includes("%2Fproduct%2Ffake-product-2229282395%2F"))).toBe(true);
  });

  it("accepts product confirmation by an alias from the verified activation response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (url.includes("/modal/addressbook") || body.includes("/modal/addressbook")) {
          return new Response(
            JSON.stringify({
              addressBook: {
                items: [
                  {
                    deliveryAddressOid: "ru-123",
                    selectedAddressOid: "internal-ru-789",
                    fullAddress: "Moscow pickup"
                  }
                ]
              },
              delivery: {
                selectedAddressOid: "internal-ru-789"
              }
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            delivery: {
              selectedAddressOid: "internal-ru-789",
              deliveryTime: "Today"
            },
            widgetStates: {
              webPrice: JSON.stringify({
                price: "1 200 ₽"
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
    ).resolves.toEqual({
      amount: 1200,
      currency: "RUB",
      rawText: "1 200 ₽",
      deliveryText: "Today"
    });
  });

  it("does not accept an alias when activation only echoes the requested pickup point", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (url.includes("/modal/addressbook") || body.includes("/modal/addressbook")) {
          return new Response(
            JSON.stringify({
              requestEcho: {
                deliveryAddressOid: "ru-123"
              },
              delivery: {
                selectedAddressOid: "internal-ru-789"
              }
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            delivery: {
              selectedAddressOid: "internal-ru-789",
              deliveryTime: "Today"
            },
            widgetStates: {
              webPrice: JSON.stringify({
                price: "1 200 ₽"
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

  it("builds Ozon pickup activation requests with the product path as referer", () => {
    const candidates = buildLocationActivationCandidates("/product/fake-product-2229282395/", "ru-123");

    expect(candidates[0]).toMatchObject({
      label: "entrypoint-select-address-modal",
      method: "GET",
      url: "/api/entrypoint-api.bx/page/json/v2?url=%2Fmodal%2Faddressbook%3Fselect_address%3Dru-123"
    });
    expect(JSON.parse(candidates[2].body || "{}")).toEqual({
      url: "/modal/addressbook?select_address=ru-123",
      referer: "/product/fake-product-2229282395/"
    });
  });
});
