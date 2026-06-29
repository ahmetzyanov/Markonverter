import { buildComparisonRows, makeSuccessResult } from "../src/shared/comparison";
import { DEFAULT_SETTINGS, PickupPoint } from "../src/shared/types";

const pickupPoints: PickupPoint[] = [
  { id: "ru", name: "Moscow", marketplace: "ozon", country: "RU", currency: "RUB", externalLocationId: "ru-1" },
  { id: "kz", name: "Almaty", marketplace: "ozon", country: "KZ", currency: "KZT", externalLocationId: "kz-1" }
];

describe("comparison rows", () => {
  it("marks the cheapest successful row and calculates deltas", () => {
    const rows = buildComparisonRows(pickupPoints, [
      makeSuccessResult("ru", { amount: 900, currency: "RUB" }, "RUB", DEFAULT_SETTINGS),
      makeSuccessResult("kz", { amount: 4000, currency: "KZT" }, "RUB", DEFAULT_SETTINGS)
    ]);

    expect(rows[0].isCheapest).toBe(false);
    expect(rows[0].deltaFromCheapest).toBe(220);
    expect(rows[1].isCheapest).toBe(true);
    expect(rows[1].deltaFromCheapest).toBe(0);
  });
});
