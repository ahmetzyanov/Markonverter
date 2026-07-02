import { normalizeSettings, validatePickupPoint } from "../../src/shared/validation";

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

  it("keeps manual rate provider", () => {
    expect(normalizeSettings({ currencyRateProvider: "manual" }).currencyRateProvider).toBe("manual");
  });

  it("replaces implausible saved KZT to RUB rates with the default", () => {
    expect(normalizeSettings({ ratesToRub: { RUB: 1, KZT: 53.96 } }).ratesToRub.KZT).toBe(0.17);
  });
});
