import { upsertPickupPoint } from "../src/shared/settings";
import { DEFAULT_SETTINGS } from "../src/shared/types";

describe("settings helpers", () => {
  it("updates an existing pickup point with the same marketplace location id", () => {
    const first = upsertPickupPoint(DEFAULT_SETTINGS, {
      id: "first",
      name: "Old name",
      marketplace: "ozon",
      country: "RU",
      currency: "RUB",
      externalLocationId: "ru-pvz-1"
    });
    const second = upsertPickupPoint(first, {
      id: "second",
      name: "New name",
      marketplace: "ozon",
      country: "RU",
      currency: "RUB",
      externalLocationId: "ru-pvz-1"
    });

    expect(second.pickupPoints).toHaveLength(1);
    expect(second.pickupPoints[0]).toMatchObject({
      id: "first",
      name: "New name",
      externalLocationId: "ru-pvz-1"
    });
  });
});
