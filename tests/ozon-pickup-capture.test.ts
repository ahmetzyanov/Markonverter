import {
  extractOzonPickupCandidatesFromSources,
  shouldReplaceOzonPickupCandidate,
  shouldUseOzonPickupName
} from "../src/marketplaces/ozon-pickup-capture";

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

  it("extracts pickup rows from visible selector attributes and address links", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "dom.ozon-delivery-row",
        urlHint: "https://www.ozon.kz/product/example",
        textHint: "Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31",
        value: {
          name: "Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31",
          "data-address-id": "kz-visible-456",
          href: "/modal/addressbook?select_address=kz-visible-456"
        }
      }
    ]);

    expect(candidates[0]).toMatchObject({
      externalLocationId: "kz-visible-456",
      name: "Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31",
      country: "KZ",
      currency: "KZT"
    });
  });

  it("extracts addressbook pickup points from proactive Ozon API responses", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "api.composer-addressbook",
        urlHint: "https://www.ozon.ru/product/example",
        value: {
          widgetStates: {
            addressbook: JSON.stringify({
              addresses: [
                {
                  deliveryAddressOid: "ru-addressbook-469716",
                  title: "Пункт Ozon № 469-716",
                  address: "Буинск, ул. Вахитова, 174Б"
                },
                {
                  deliveryAddressOid: "kz-addressbook-440129",
                  title: "Пункт Ozon № 440-129",
                  address: "Астана, пр-кт Улы Дала, 31"
                }
              ]
            })
          }
        }
      }
    ]);

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalLocationId: "ru-addressbook-469716",
          name: "Буинск, ул. Вахитова, 174Б",
          currency: "RUB"
        }),
        expect.objectContaining({
          externalLocationId: "kz-addressbook-440129",
          name: "Астана, пр-кт Улы Дала, 31"
        })
      ])
    );
  });

  it("uses nearby link text when a pickup id is only exposed through select_address", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "api.composer-addressbook-html",
        urlHint: "https://www.ozon.ru/product/example",
        value:
          '<a href="/modal/addressbook?select_address=528a5580-56f9-4e82-80cc-e801b5dbf252">Пункт Ozon № 528-558 Буинск, ул. Вахитова, 174Б</a>'
      }
    ]);

    expect(candidates[0]).toMatchObject({
      externalLocationId: "528a5580-56f9-4e82-80cc-e801b5dbf252",
      name: "Пункт Ozon № 528-558 Буинск, ул. Вахитова, 174Б",
      currency: "RUB"
    });
  });

  it("uses nearby JSON address text instead of keeping a generic uuid label", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "api.composer-addressbook-json",
        urlHint: "https://www.ozon.kz/product/example",
        value:
          '{"items":[{"action":{"url":"/modal/addressbook?select_address=528a5580-56f9-4e82-80cc-e801b5dbf252"},"subtitle":"Астана, пр-кт Улы Дала, 31"}]}'
      }
    ]);

    expect(candidates[0]).toMatchObject({
      externalLocationId: "528a5580-56f9-4e82-80cc-e801b5dbf252",
      name: "Астана, пр-кт Улы Дала, 31",
      currency: "KZT"
    });
  });

  it("does not use Ozon modal service metadata as a pickup point name", () => {
    const id = "528a5580-56f9-4e82-80cc-e801b5dbf252";
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: `api.composer-post-addressbook-/modal/addressbook?select_address=${id}`,
        urlHint: `https://www.ozon.kz/api/entrypoint-api.bx/page/json/v2?url=%2Fmodal%2Faddressbook%3Fselect_address%3D${id}`,
        value: `{"items":[{"action":{"url":"/modal/addressbook?select_address=${id}"},"url":" ","layoutId":39077,"layoutVersion":31,"pageType":"modal","ruleId":37945,"referer":"/product/example"}]}`
      }
    ]);

    const candidate = candidates.find((item) => item.externalLocationId === id);
    expect(candidate).toMatchObject({
      externalLocationId: id,
      name: `Ozon pickup ${id}`
    });
    expect(candidate?.name).not.toMatch(/layoutId|layoutVersion|pageType|ruleId|referer|url":"|composer-post-addressbook/i);
  });

  it("does not use Ozon button text as a pickup point name", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "dom.ozon-delivery-row",
        urlHint: "https://www.ozon.ru/product/example",
        textHint: "Удалить",
        value: {
          deliveryAddressOid: "ru-delete-button-123",
          title: "Удалить",
          address: "Удалить"
        }
      }
    ]);

    expect(candidates[0]).toMatchObject({
      externalLocationId: "ru-delete-button-123",
      name: "Ozon pickup ru-delete-button-123"
    });
  });

  it("does not use a bare Ozon pickup row header as a pickup point name", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "api.composer-addressbook-json",
        urlHint: "https://www.ozon.kz/product/example",
        value: {
          deliveryAddressOid: "kz-bare-title-123",
          title: "Пункт Ozon •"
        }
      }
    ]);

    expect(candidates[0]).toMatchObject({
      externalLocationId: "kz-bare-title-123",
      name: "Ozon pickup kz-bare-title-123"
    });
  });

  it("uses an address instead of a bare Ozon pickup row header when both are present", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "api.composer-addressbook-json",
        urlHint: "https://www.ozon.kz/product/example",
        value: {
          deliveryAddressOid: "kz-bare-title-456",
          title: "Пункт Ozon •",
          subtitle: "Астана, пр-кт Улы Дала, 31"
        }
      }
    ]);

    expect(candidates[0]).toMatchObject({
      externalLocationId: "kz-bare-title-456",
      name: "Астана, пр-кт Улы Дала, 31"
    });
  });

  it("does not borrow a sibling address when the matching pickup only has a bare header", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "api.composer-addressbook-json",
        urlHint: "https://www.ozon.kz/product/example",
        value: JSON.stringify({
          items: [
            {
              deliveryAddressOid: "kz-bare-title-123",
              title: "Пункт Ozon •"
            },
            {
              deliveryAddressOid: "kz-address-title-456",
              title: "Пункт Ozon •",
              subtitle: "Астана, пр-кт Улы Дала, 31"
            }
          ]
        })
      }
    ]);

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalLocationId: "kz-bare-title-123",
          name: "Ozon pickup kz-bare-title-123"
        }),
        expect.objectContaining({
          externalLocationId: "kz-address-title-456",
          name: "Астана, пр-кт Улы Дала, 31"
        })
      ])
    );
  });

  it("repairs saved pickup names that already contain service metadata or button labels", () => {
    const id = "528a5580-56f9-4e82-80cc-e801b5dbf252";

    expect(
      shouldUseOzonPickupName(
        'url":" ","layoutId":39077,"layoutVersion":31,"pageType":"modal","ruleId":37945,"referer',
        "Астана, пр-кт Улы Дала, 31",
        id
      )
    ).toBe(true);
    expect(shouldUseOzonPickupName("Удалить", `Ozon pickup ${id}`, id)).toBe(true);
    expect(shouldUseOzonPickupName("Пункт Ozon •", "Астана, пр-кт Улы Дала, 31", id)).toBe(true);
    expect(shouldUseOzonPickupName("Пункт Ozon •", `Ozon pickup ${id}`, id)).toBe(true);
    expect(shouldUseOzonPickupName(`Ozon pickup ${id}`, "Пункт Ozon •", id)).toBe(false);
  });

  it("does not replace a usable pickup name with service metadata or button text", () => {
    const existing = {
      externalLocationId: "ru-addressbook-469716",
      name: "Буинск, ул. Вахитова, 174Б",
      country: "RU",
      currency: "RUB" as const,
      source: "api.addressbook",
      score: 70
    };

    expect(
      shouldReplaceOzonPickupCandidate(existing, {
        ...existing,
        name: 'url":" ","layoutId":39077,"pageType":"modal","referer',
        score: 100
      })
    ).toBe(false);
    expect(
      shouldReplaceOzonPickupCandidate(existing, {
        ...existing,
        name: "Удалить",
        score: 100
      })
    ).toBe(false);
    expect(
      shouldReplaceOzonPickupCandidate(existing, {
        ...existing,
        name: "Пункт Ozon •",
        score: 100
      })
    ).toBe(false);
  });

  it("does not borrow a nearby JSON label from another pickup id", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "api.composer-addressbook-json",
        urlHint: "https://www.ozon.kz/product/example",
        value:
          '{"items":[{"action":{"url":"/modal/addressbook?select_address=528a5580-56f9-4e82-80cc-e801b5dbf252"},"subtitle":"Астана, пр-кт Улы Дала, 31"},{"action":{"url":"/modal/addressbook?select_address=ru-unsaved-789"},"subtitle":"Буинск, ул. Вахитова, 174Б"}]}'
      }
    ]);

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalLocationId: "528a5580-56f9-4e82-80cc-e801b5dbf252",
          name: "Астана, пр-кт Улы Дала, 31"
        }),
        expect.objectContaining({
          externalLocationId: "ru-unsaved-789",
          name: "Буинск, ул. Вахитова, 174Б"
        })
      ])
    );
  });

  it("keeps addressbook labels scoped to their own pickup id in mixed modal payloads", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source: "api.composer-addressbook-json",
        urlHint: "https://www.ozon.kz/product/example",
        textHint: "Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31",
        value: JSON.stringify({
          items: [
            {
              action: {
                url: "/modal/addressbook?select_address=528a5580-56f9-4e82-80cc-e801b5dbf252"
              },
              subtitle: "Астана, пр-кт Улы Дала, 31"
            },
            {
              deliveryAddressOid: "ru-delete-button-123",
              title: "Пункт Ozon № 469-716",
              address: "Буинск, ул. Вахитова, 174Б"
            }
          ],
          delivery: {
            selectedAddressOid: "kz-visible-456"
          }
        })
      }
    ]);

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalLocationId: "528a5580-56f9-4e82-80cc-e801b5dbf252",
          name: "Астана, пр-кт Улы Дала, 31"
        }),
        expect.objectContaining({
          externalLocationId: "ru-delete-button-123",
          name: "Буинск, ул. Вахитова, 174Б"
        })
      ])
    );
  });

  it("prefers a real address label over an id-only pickup candidate", () => {
    const generic = {
      externalLocationId: "daa6eeff-8093-429a-9fee-9c73e5ef6036",
      name: "Ozon pickup daa6eeff-8093-429a-9fee-9c73e5ef6036",
      country: "RU",
      currency: "RUB" as const,
      source: "api.delivery",
      score: 90
    };
    const resolved = {
      ...generic,
      name: "Буинск, ул. Вахитова, 174Б",
      source: "api.addressbook",
      score: 70
    };

    expect(shouldReplaceOzonPickupCandidate(generic, resolved)).toBe(true);
    expect(shouldUseOzonPickupName(generic.name, resolved.name, generic.externalLocationId)).toBe(true);
    expect(shouldUseOzonPickupName("Дом рядом с работой", resolved.name, generic.externalLocationId)).toBe(false);
  });

  it("uses the Ozon host to infer country before mixed address modal text", () => {
    const candidates = extractOzonPickupCandidatesFromSources([
      {
        source:
          "network.https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fmodal%2Faddressbook%3Fselect_address%3Ddaa6eeff-8093-429a-9fee-9c73e5ef6036",
        urlHint: "https://www.ozon.ru/product/example-2229282395/",
        textHint: "Пункт Ozon № 469-716 Буинск, ул. Вахитова, 174Б | Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31",
        value: {
          addressbook: {
            deliveryAddressOid: "daa6eeff-8093-429a-9fee-9c73e5ef6036",
            title: "Пункт Ozon № 469-716 Буинск, ул. Вахитова, 174Б | Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31"
          }
        }
      }
    ]);

    expect(candidates[0]).toMatchObject({
      externalLocationId: "daa6eeff-8093-429a-9fee-9c73e5ef6036",
      country: "RU",
      currency: "RUB"
    });
    expect(candidates[0].name).not.toContain("Астана");
  });
});
