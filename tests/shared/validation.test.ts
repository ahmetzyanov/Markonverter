import { normalizeSettings, validatePickupPoint } from "../../src/shared/validation";
import { DEFAULT_SETTINGS, MAX_SAVED_OZON_PICKUP_POINTS, PickupPoint } from "../../src/shared/types";

describe("pickup point validation", () => {
  it("requires Ozon external location id", () => {
    expect(
      validatePickupPoint({
        id: "1",
        name: "Almaty",
        marketplace: "ozon",
        country: "KZ",
        currency: "KZT",
        externalLocationId: ""
      })
    ).toContain("Ozon location id is required");
  });
});

describe("settings normalization", () => {
  it("defaults missing or invalid rate provider to CBR", () => {
    expect(normalizeSettings({}).currencyRateProvider).toBe("cbr");
    expect(normalizeSettings({ currencyRateProvider: "unknown" }).currencyRateProvider).toBe("cbr");
  });

  it("defaults missing or invalid language to Russian", () => {
    expect(normalizeSettings({}).language).toBe("ru");
    expect(normalizeSettings({ language: "de" }).language).toBe("ru");
  });

  it("keeps supported language preferences", () => {
    expect(normalizeSettings({ language: "auto" }).language).toBe("auto");
    expect(normalizeSettings({ language: "en" }).language).toBe("en");
  });

  it("defaults debug mode to false and keeps explicit true", () => {
    expect(normalizeSettings({}).debug).toBe(false);
    expect(normalizeSettings({ debug: "true" }).debug).toBe(false);
    expect(normalizeSettings({ debug: true }).debug).toBe(true);
  });

  it("defaults inline converted prices to true unless explicitly disabled", () => {
    expect(normalizeSettings({}).inlineConvertedPrices).toBe(true);
    expect(normalizeSettings({ inlineConvertedPrices: undefined }).inlineConvertedPrices).toBe(true);
    expect(normalizeSettings({ inlineConvertedPrices: false }).inlineConvertedPrices).toBe(false);
  });

  it("keeps manual rate provider", () => {
    expect(normalizeSettings({ currencyRateProvider: "manual" }).currencyRateProvider).toBe("manual");
  });

  it("replaces implausible saved KZT to RUB rates with the default", () => {
    expect(normalizeSettings({ ratesToRub: { RUB: 1, KZT: 53.96 } }).ratesToRub.KZT).toBe(0.17);
  });

  it("normalizes stored Ozon pickup points to the saved limit", () => {
    const pickupPoints = Array.from({ length: MAX_SAVED_OZON_PICKUP_POINTS + 1 }, (_, index): PickupPoint => ({
      id: `ozon-${index}`,
      name: `Ozon ${index}`,
      marketplace: "ozon",
      country: "RU",
      currency: "RUB",
      externalLocationId: `ru-pvz-${index}`
    }));

    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      pickupPoints,
      comparisonPickupPointIds: pickupPoints.map((point) => point.id),
      manualQuotes: {
        "2229282395:ozon-4": {
          productId: "2229282395",
          productUrl: "https://ozon.ru/product/example-2229282395/",
          pickupPointId: "ozon-4",
          quote: { amount: 1000, currency: "RUB" },
          capturedAt: "2026-07-04T10:00:00.000Z"
        }
      }
    });

    expect(settings.pickupPoints).toHaveLength(MAX_SAVED_OZON_PICKUP_POINTS);
    expect(settings.pickupPoints.map((point) => point.id)).toEqual(["ozon-0", "ozon-1", "ozon-2", "ozon-3"]);
    expect(settings.comparisonPickupPointIds).toEqual(["ozon-0", "ozon-1", "ozon-2", "ozon-3"]);
    expect(settings.manualQuotes).toEqual({});
  });
});
