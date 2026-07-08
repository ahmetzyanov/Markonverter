import {
  activateOzonPickupLocationForProduct,
  buildLocationActivationCandidates,
  fetchOzonPrivatePrice,
  fetchOzonSelectedLocationId,
  extractOzonDeliveryText,
  extractOzonPrice,
  extractSelectedOzonLocationId,
  isOzonProductUnavailableInRegion,
  isOzonRequestsThrottled,
  responseContainsLocation
} from "../../../src/marketplaces/ozon/private-api";

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

  it("prefers the plain price over the bank-subsidized card price (2026 ozon.ru webPrice)", () => {
    // Live shape from ozon.ru product 4446864009: cardPrice ("С банками") and
    // price ("С другими банками") coexist; this must not read as ambiguous.
    const json = {
      widgetStates: {
        "webPrice-3121879-default-1": JSON.stringify({
          isAvailable: true,
          cardPrice: "1 126 ₽",
          price: "1 251 ₽",
          originalPrice: "8 000 ₽",
          showOriginalPrice: true,
          pricePerUnit: "1 126 ₽"
        })
      }
    };

    expect(extractOzonPrice(json, "RUB")).toEqual({
      amount: 1251,
      currency: "RUB",
      rawText: "1 251 ₽"
    });
  });

  it("falls back to the card price when no plain price exists", () => {
    const json = {
      widgetStates: {
        webPrice: JSON.stringify({ cardPrice: "1 126 ₽" })
      }
    };

    expect(extractOzonPrice(json, "RUB")).toEqual({
      amount: 1126,
      currency: "RUB",
      rawText: "1 126 ₽"
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

  it("does not treat captured delivery-badge size metadata as a product price", () => {
    const capturedWebDeliveryWidget = {
      state: {
        title: "Доставка и возврат",
        sections: [
          {
            type: "addressSelect",
            descriptionRs: [
              {
                type: "text",
                content: "ул. Вахитова, 174б",
                font: "tsCompact400Small",
                color: "textPrimary"
              },
              {
                type: "newLine"
              },
              {
                type: "text",
                content: "Со склада продавца, Fujian Sheng",
                font: "tsBody300XSmall",
                color: "textSecondary"
              }
            ],
            link: "/modal/addressbook?src_main=/product/4128227034/"
          },
          {
            type: "separator"
          },
          {
            descriptionRs: [
              {
                type: "text",
                content: "Пункты выдачи Ozon",
                font: "tsCompact400Small",
                color: "textPrimary"
              },
              {
                type: "newLine"
              },
              {
                type: "text",
                content: "С 19 июля",
                font: "tsBody300XSmall",
                color: "textSecondary"
              }
            ],
            priceBadge: {
              text: "Без доплат",
              size: "SIZE_400",
              styleType: "NEUTRAL_PRIMARY"
            }
          }
        ]
      }
    };

    expect(extractOzonPrice(capturedWebDeliveryWidget, "RUB")).toBeNull();
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

  it("classifies a confirmed pickup point where the product is not delivered to that region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            delivery: {
              selectedAddressOid: "ru-123"
            },
            widgetStates: {
              webPrice: JSON.stringify({
                title: "Товар не доставляется в ваш регион"
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

    try {
      await fetchOzonPrivatePrice({
        productId: "2229282395",
        productUrl: "https://ozon.kz/product/fake-product-2229282395/",
        pickupExternalLocationId: "ru-123",
        currencyHint: "RUB"
      });
      throw new Error("expected unavailable-region response to reject");
    } catch (error) {
      expect(isOzonProductUnavailableInRegion(error)).toBe(true);
    }
  });

  it("does not call session-mutating address selection endpoints by default", async () => {
    const calls: Array<{ url: string; body?: string }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
        return new Response(
          JSON.stringify({
            delivery: {
              selectedAddressOid: "ru-123",
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
    expect(calls.some((call) => /deliveryAddressOid|select_address|select_location|\/modal\/addressbook/i.test(`${call.url} ${call.body || ""}`))).toBe(false);
  });

  it("can activate the saved pickup point before reading product price when explicitly allowed", async () => {
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
        currencyHint: "RUB",
        allowSessionMutatingLocationActivation: true
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
        currencyHint: "RUB",
        allowSessionMutatingLocationActivation: true
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
        currencyHint: "RUB",
        allowSessionMutatingLocationActivation: true
      })
    ).rejects.toThrow("response did not confirm requested pickup point");
  });

  it("accepts a product price without a repeated location id after activation confirms the saved pickup point", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (url.includes("/modal/addressbook") || body.includes("/modal/addressbook")) {
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
        currencyHint: "RUB",
        allowSessionMutatingLocationActivation: true
      })
    ).resolves.toEqual({
      amount: 1200,
      currency: "RUB",
      rawText: "1 200 ₽"
    });
  });

  it("rejects a product price without a location id when activation only lists the pickup but selects another address", async () => {
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
                    fullAddress: "Moscow pickup"
                  }
                ]
              },
              delivery: {
                selectedAddressOid: "kz-456"
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
        currencyHint: "RUB",
        allowSessionMutatingLocationActivation: true
      })
    ).rejects.toThrow("response did not confirm requested pickup point");
  });

  it("rejects a product response that confirms a different pickup point after activation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (url.includes("/modal/addressbook") || body.includes("/modal/addressbook")) {
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
              selectedAddressOid: "kz-456"
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
        currencyHint: "RUB",
        allowSessionMutatingLocationActivation: true
      })
    ).rejects.toThrow("confirmed a different pickup point");
  });

  it("builds product-scoped Ozon pickup activation requests before legacy fallbacks", () => {
    const productPath = "/product/fake-product-2229282395/?at=token&sh=share";
    const candidates = buildLocationActivationCandidates(productPath, "ru-123");
    const productContextModalPath =
      "/modal/addressbook?select_address=ru-123&src_main=%2Fproduct%2Ffake-product-2229282395%2F%3Fat%3Dtoken%26sh%3Dshare&page_changed=true";
    const firstUrl = new URL(candidates[0].url, "https://www.ozon.ru");

    expect(candidates[0]).toMatchObject({
      label: "entrypoint-select-address-product-context",
      method: "GET"
    });
    expect(firstUrl.searchParams.get("url")).toBe(productContextModalPath);
    expect(JSON.parse(candidates[2].body || "{}")).toEqual({
      url: productContextModalPath,
      referer: productPath
    });
    expect(candidates.some((candidate) => candidate.label === "entrypoint-select-address-legacy")).toBe(true);
  });

  it("can activate a pickup point for restoring the originally selected Ozon location", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
        return new Response(
          JSON.stringify({
            delivery: {
              selectedAddressOid: "kz-456"
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
      activateOzonPickupLocationForProduct("https://ozon.kz/product/fake-product-2229282395/?at=token", "kz-456")
    ).resolves.toBe(true);
    expect(calls[0]?.url).toContain("select_address%3Dkz-456");
    expect(calls[0]?.url).toContain("src_main%3D%252Fproduct%252Ffake-product-2229282395%252F%253Fat%253Dtoken");
  });

  it("reads the currently selected pickup point id from a selected-location path", () => {
    expect(
      extractSelectedOzonLocationId({
        delivery: { selectedAddressOid: "kazan-ru-777", deliveryTime: "Today" },
        addressBook: { items: [{ deliveryAddressOid: "kz-456" }] }
      })
    ).toBe("kazan-ru-777");
  });

  it("ignores request/query echoes when reading the selected pickup point id", () => {
    expect(
      extractSelectedOzonLocationId({
        requestEcho: { selectedAddressOid: "from-url-999", url: "/api?select_location=from-url-999" },
        addressBook: { items: [{ deliveryAddressOid: "kz-456" }] }
      })
    ).toBeNull();
  });

  it("stops escalating candidates and throws a throttled error once Ozon returns HTTP 403", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(null, { status: 403 });
      })
    );

    try {
      await fetchOzonPrivatePrice({
        productId: "2229282395",
        productUrl: "https://ozon.kz/product/fake-product-2229282395/",
        pickupExternalLocationId: "ru-123",
        currencyHint: "RUB"
      });
      throw new Error("expected a throttled rejection");
    } catch (error) {
      expect(isOzonRequestsThrottled(error)).toBe(true);
    }
    // Two non-mutating read candidates exist by default; abort after the first 403.
    expect(calls.length).toBe(1);
  });

  it("stops reading further candidates for the selected location id once Ozon returns HTTP 403", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(null, { status: 403 });
      })
    );

    await expect(fetchOzonSelectedLocationId("https://ozon.kz/product/fake-product-2229282395/")).resolves.toBeNull();
    expect(calls.length).toBe(1);
  });

  it("stops activation candidate escalation once a candidate confirms the pickup point", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
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
      })
    );

    await expect(activateOzonPickupLocationForProduct("https://ozon.kz/product/fake-product-2229282395/", "ru-123")).resolves.toBe(
      true
    );
    // 12 candidates are built (4 endpoints x 3 modal variants); confirming on
    // the first one must skip the remaining 11.
    expect(calls.length).toBe(1);
  });

  // Root cause 1 of wiki/maps/ozon-sweep-live-bug-report-2026-07-07.md: for a
  // point saved with an addressbook address UUID, Ozon only ever echoes the
  // area-level ids (areaid/fias) of the selected location. The persisted
  // aliases must confirm the read; without them it must keep failing.
  it("confirms a read-only price via a persisted location alias id", async () => {
    const composerResponse = {
      data: {
        location: {
          current: {
            areaid: 17858,
            fias: "58e5a396-77c4-4ab6-b235-afe364c0580f"
          }
        }
      },
      widgetStates: {
        webPrice: JSON.stringify({ price: "3 013 ₽" })
      }
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(composerResponse), { status: 200, headers: { "content-type": "application/json" } }))
    );

    const request = {
      productId: "2103540263",
      productUrl: "https://ozon.ru/product/fake-product-2103540263/",
      pickupExternalLocationId: "daa6eeff-8093-429a-9fee-9c73e5ef6036",
      currencyHint: "RUB"
    } as const;

    await expect(fetchOzonPrivatePrice({ ...request, pickupLocationAliasIds: ["17858"] })).resolves.toMatchObject({
      amount: 3013,
      currency: "RUB"
    });
    await expect(fetchOzonPrivatePrice(request)).rejects.toThrow(/did not confirm requested pickup point/);
  });
});
