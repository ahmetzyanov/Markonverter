import { buildApproxPriceLabel } from "../../src/content/page/inline-converted-price";
import { convertAmount, formatCurrency } from "../../src/shared/currency";
import { DEFAULT_SETTINGS } from "../../src/shared/types";

describe("buildApproxPriceLabel", () => {
  it("converts a KZT price to an approximate RUB label when the default currency is RUB", () => {
    const expectedAmount = Math.round(convertAmount(12990, "KZT", "RUB", DEFAULT_SETTINGS.ratesToRub));
    expect(buildApproxPriceLabel("12 990 ₸", "RUB", DEFAULT_SETTINGS.ratesToRub)).toBe(
      `~${formatCurrency(expectedAmount, "RUB")}`
    );
  });

  it("returns null when the price currency already matches the default currency", () => {
    expect(buildApproxPriceLabel("12 990 ₽", "RUB", DEFAULT_SETTINGS.ratesToRub)).toBeNull();
  });

  it("returns null when the text has no explicit currency marker", () => {
    expect(buildApproxPriceLabel("12 990", "RUB", DEFAULT_SETTINGS.ratesToRub)).toBeNull();
  });

  it("returns null instead of throwing when the exchange rate is invalid", () => {
    expect(buildApproxPriceLabel("12 990 ₸", "RUB", { RUB: 1, KZT: 0 })).toBeNull();
  });

  it("converts a RUB price to an approximate KZT label when the default currency is KZT", () => {
    const expectedAmount = Math.round(convertAmount(2208, "RUB", "KZT", DEFAULT_SETTINGS.ratesToRub));
    expect(buildApproxPriceLabel("2 208 ₽", "KZT", DEFAULT_SETTINGS.ratesToRub)).toBe(
      `~${formatCurrency(expectedAmount, "KZT")}`
    );
  });
});
