import {
  appendOzonFixtureRecords,
  createOzonFixtureRecord,
  emptyOzonFixtureStore,
  MAX_OZON_FIXTURE_BODY_CHARS,
  MAX_OZON_FIXTURE_RECORDS
} from "../../src/shared/ozon-fixtures";

describe("Ozon fixture recorder", () => {
  it("keeps relevant Ozon API payloads and truncates large bodies", () => {
    const record = createOzonFixtureRecord(
      {
        source: "fetch",
        method: "post",
        url: "https://www.ozon.kz/api/composer-api.bx/page/json/v2",
        status: 200,
        contentType: "application/json",
        pageUrl: "https://www.ozon.kz/product/example-2229282395/",
        requestBody: "deliveryAddressOid=kz-456",
        responseText: "x".repeat(MAX_OZON_FIXTURE_BODY_CHARS + 1)
      },
      new Date("2026-07-01T06:00:00.000Z")
    );

    expect(record).toMatchObject({
      source: "fetch",
      method: "POST",
      responseTruncated: true,
      responseLength: MAX_OZON_FIXTURE_BODY_CHARS + 1
    });
    expect(record?.responseText).toHaveLength(MAX_OZON_FIXTURE_BODY_CHARS);
  });

  it("ignores unrelated URLs", () => {
    expect(
      createOzonFixtureRecord({
        source: "fetch",
        method: "GET",
        url: "https://example.com/api/composer-api.bx/page/json/v2",
        pageUrl: "https://example.com",
        responseText: "{}"
      })
    ).toBeNull();
  });

  it("deduplicates matching records and caps the store", () => {
    const inputs = Array.from({ length: MAX_OZON_FIXTURE_RECORDS + 5 }, (_item, index) => ({
      source: "xhr",
      method: "GET",
      url: `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fmodal%2Faddressbook&deliveryAddressOid=ru-${index}`,
      pageUrl: "https://www.ozon.ru/product/example-2229282395/",
      responseText: JSON.stringify({ index })
    }));
    const store = appendOzonFixtureRecords(emptyOzonFixtureStore(), [...inputs, inputs[inputs.length - 1]], new Date("2026-07-01T06:00:00.000Z"));

    expect(store.records).toHaveLength(MAX_OZON_FIXTURE_RECORDS);
    expect(store.records[0].url).toContain("ru-5");
    expect(store.records.at(-1)?.url).toContain(`ru-${MAX_OZON_FIXTURE_RECORDS + 4}`);
  });
});
