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
