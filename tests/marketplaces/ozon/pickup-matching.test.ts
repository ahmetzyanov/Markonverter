import {
  findSavedPickupPointForVisibleDelivery,
  isCandidateNameSharedAcrossExternalIds,
  matchDetectedPickupCandidateToRow,
  scoreVisiblePickupMatch,
  visibleDeliveryPickupLabel
} from "../../../src/marketplaces/ozon/pickup-matching";
import { OzonPickupCandidate } from "../../../src/marketplaces/ozon/pickup-capture";
import { DEFAULT_SETTINGS, PickupPoint } from "../../../src/shared/types";

function point(id: string, name: string, externalLocationId: string): PickupPoint {
  return { id, name, marketplace: "ozon", country: "RU", currency: "RUB", externalLocationId };
}

function candidate(externalLocationId: string, name: string): OzonPickupCandidate {
  return { externalLocationId, name, country: "RU", currency: "RUB", source: "test", score: 50 };
}

describe("Ozon pickup matching", () => {
  it("matches a saved point against visible delivery text by address tokens", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      pickupPoints: [
        point("a", "Пункт Ozon № 469-716 Буинск, ул. Вахитова, 174Б", "pvz-469716"),
        point("b", "Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31", "pvz-440129")
      ]
    };

    const found = findSavedPickupPointForVisibleDelivery(settings, "Доставка Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31", []);

    expect(found?.id).toBe("b");
  });

  it("returns null when two saved points match the visible text equally well", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      pickupPoints: [
        point("a", "Буинск, ул. Вахитова, 174Б", "pvz-1"),
        point("b", "Буинск, ул. Вахитова, 174В", "pvz-2")
      ]
    };

    expect(findSavedPickupPointForVisibleDelivery(settings, "Буинск, ул. Вахитова", [])).toBeNull();
  });

  it("prefers an explicit current candidate with a saved external id", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      pickupPoints: [point("a", "Ozon pickup pvz-1", "pvz-1"), point("b", "Ozon pickup pvz-2", "pvz-2")]
    };

    const found = findSavedPickupPointForVisibleDelivery(settings, "любой текст", [], [candidate("pvz-2", "whatever")]);

    expect(found?.id).toBe("b");
  });

  it("matches a delivery row to a detected candidate by Ozon point number", () => {
    const candidates = [
      candidate("pvz-469716", "Пункт Ozon № 469-716 Буинск, ул. Вахитова, 174Б"),
      candidate("pvz-440129", "Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31")
    ];

    const matched = matchDetectedPickupCandidateToRow("Пункт Ozon № 440-129 Астана", candidates);

    expect(matched?.externalLocationId).toBe("pvz-440129");
  });

  it("does not match a row to unrelated candidates", () => {
    expect(matchDetectedPickupCandidateToRow("Сегодня", [candidate("pvz-1", "Пункт Ozon № 111-222 Казань")])).toBeNull();
  });

  it("detects a candidate name shared across different external ids", () => {
    const shared = [candidate("pvz-1", "Казань, ул. Баумана, 1"), candidate("pvz-2", "Казань, ул. Баумана, 1")];

    expect(isCandidateNameSharedAcrossExternalIds(shared[0], shared)).toBe(true);
    expect(isCandidateNameSharedAcrossExternalIds(shared[0], [shared[0]])).toBe(false);
  });

  it("extracts a pickup label from visible delivery text and rejects service text", () => {
    expect(visibleDeliveryPickupLabel("Доставка и возврат Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31 Редактировать")).toBe(
      "Пункт Ozon № 440-129 Астана, пр-кт Улы Дала, 31"
    );
    expect(visibleDeliveryPickupLabel("Способ получения")).toBe("");
  });

  it("scores zero when texts share no meaningful tokens", () => {
    expect(scoreVisiblePickupMatch("Казань, ул. Баумана, 1", "Астана, пр-кт Улы Дала, 31")).toBe(0);
  });
});
