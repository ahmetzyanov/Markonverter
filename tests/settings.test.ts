import { deletePickupPoint, setComparisonPickupPointIds, upsertPickupPoint } from "../src/shared/settings";
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

  it("removes deleted pickup points from the comparison selection", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      pickupPoints: [
        {
          id: "ru",
          name: "Moscow",
          marketplace: "ozon" as const,
          country: "RU",
          currency: "RUB" as const,
          externalLocationId: "ru-pvz-1"
        },
        {
          id: "kz",
          name: "Astana",
          marketplace: "ozon" as const,
          country: "KZ",
          currency: "KZT" as const,
          externalLocationId: "kz-pvz-1"
        }
      ],
      comparisonPickupPointIds: ["ru", "kz"]
    };

    expect(deletePickupPoint(settings, "ru")).toMatchObject({
      pickupPoints: [{ id: "kz" }],
      comparisonPickupPointIds: ["kz"]
    });
  });

  it("stores null comparison selection as all saved pickup points", () => {
    const settings = setComparisonPickupPointIds(DEFAULT_SETTINGS, null);

    expect(settings.comparisonPickupPointIds).toBeNull();
  });

  it("filters comparison selection to known pickup points", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      pickupPoints: [
        {
          id: "known",
          name: "Known",
          marketplace: "ozon" as const,
          country: "RU",
          currency: "RUB" as const,
          externalLocationId: "ru-pvz-1"
        }
      ]
    };

    expect(setComparisonPickupPointIds(settings, ["known", "missing"]).comparisonPickupPointIds).toEqual(["known"]);
  });
});
