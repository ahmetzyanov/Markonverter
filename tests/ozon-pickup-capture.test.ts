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
