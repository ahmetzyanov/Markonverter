import { deletePickupPoint, manualQuoteKey, setComparisonPickupPointIds, upsertManualQuote, upsertPickupPoint } from "../../src/shared/settings";
import { DEFAULT_SETTINGS, MAX_SAVED_OZON_PICKUP_POINTS, PickupPoint } from "../../src/shared/types";

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

  it("keeps at most four saved Ozon pickup points", () => {
    const existingPoints = Array.from({ length: MAX_SAVED_OZON_PICKUP_POINTS }, (_, index): PickupPoint => ({
      id: `ozon-${index}`,
      name: `Ozon ${index}`,
      marketplace: "ozon",
      country: "RU",
      currency: "RUB",
      externalLocationId: `ru-pvz-${index}`
    }));
    const settings = {
      ...DEFAULT_SETTINGS,
      pickupPoints: existingPoints
    };

    const unchanged = upsertPickupPoint(settings, {
      id: "extra",
      name: "Extra",
      marketplace: "ozon",
      country: "RU",
      currency: "RUB",
      externalLocationId: "ru-pvz-extra"
    });

    expect(unchanged.pickupPoints).toHaveLength(MAX_SAVED_OZON_PICKUP_POINTS);
    expect(unchanged.pickupPoints.some((point) => point.id === "extra")).toBe(false);
  });

  it("still updates an existing Ozon pickup point when the limit is reached", () => {
    const existingPoints = Array.from({ length: MAX_SAVED_OZON_PICKUP_POINTS }, (_, index): PickupPoint => ({
      id: `ozon-${index}`,
      name: `Ozon ${index}`,
      marketplace: "ozon",
      country: "RU",
      currency: "RUB",
      externalLocationId: `ru-pvz-${index}`
    }));

    const updated = upsertPickupPoint(
      {
        ...DEFAULT_SETTINGS,
        pickupPoints: existingPoints
      },
      {
        id: "replacement-id",
        name: "Updated Ozon",
        marketplace: "ozon",
        country: "RU",
        currency: "RUB",
        externalLocationId: "ru-pvz-2"
      }
    );

    expect(updated.pickupPoints).toHaveLength(MAX_SAVED_OZON_PICKUP_POINTS);
    expect(updated.pickupPoints[2]).toMatchObject({
      id: "ozon-2",
      name: "Updated Ozon"
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

  it("removes deleted pickup points from captured product quotes", () => {
    const settings = upsertManualQuote(
      {
        ...DEFAULT_SETTINGS,
        pickupPoints: [
          {
            id: "ru",
            name: "Moscow",
            marketplace: "ozon",
            country: "RU",
            currency: "RUB",
            externalLocationId: "ru-pvz-1"
          }
        ]
      },
      {
        productId: "2229282395",
        productUrl: "https://ozon.ru/product/example-2229282395/",
        pickupPointId: "ru",
        quote: { amount: 1000, currency: "RUB", source: "manual", capturedAt: "2026-06-29T21:00:00.000Z" },
        capturedAt: "2026-06-29T21:00:00.000Z"
      }
    );

    expect(settings.manualQuotes[manualQuoteKey("2229282395", "ru")]).toBeDefined();
    expect(deletePickupPoint(settings, "ru").manualQuotes).toEqual({});
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
