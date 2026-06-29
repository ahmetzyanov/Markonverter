import { convertAmount, roundMoney } from "../src/shared/currency";
import { DEFAULT_SETTINGS } from "../src/shared/types";

describe("currency conversion", () => {
  it("converts KZT to RUB", () => {
    expect(roundMoney(convertAmount(1000, "KZT", "RUB", DEFAULT_SETTINGS.ratesToRub))).toBe(170);
  });

  it("converts RUB to KZT", () => {
    expect(roundMoney(convertAmount(170, "RUB", "KZT", DEFAULT_SETTINGS.ratesToRub))).toBe(1000);
  });

  it("rejects invalid rates", () => {
    expect(() => convertAmount(100, "RUB", "KZT", { RUB: 1, KZT: 0 })).toThrow("Invalid KZT exchange rate");
  });
});
