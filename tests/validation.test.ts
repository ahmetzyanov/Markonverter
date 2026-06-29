import { validatePickupPoint } from "../src/shared/validation";

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
