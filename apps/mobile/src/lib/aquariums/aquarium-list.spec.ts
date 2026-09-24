import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aquariumListSubtitle, type AquariumListRow } from "./aquarium-list";

function row(overrides: Partial<AquariumListRow> = {}): AquariumListRow {
  return {
    ownershipType: "OWN",
    equipmentCount: 0,
    ...overrides,
  };
}

describe("aquariumListSubtitle", () => {
  it("saját akvárium, méret és eszköz nélkül", () => {
    assert.equal(aquariumListSubtitle(row()), "Saját · 0 eszköz");
  });

  it("ügyfél akvárium az ügyfél nevével, nem a 'Ügyfél' szóval", () => {
    assert.equal(
      aquariumListSubtitle(
        row({ ownershipType: "CUSTOMER", customerName: "Kovács János" }),
      ),
      "Kovács János · 0 eszköz",
    );
  });

  it("ügyfél akvárium ügyfél NÉLKÜL a birtokviszony szavára esik vissza", () => {
    assert.equal(
      aquariumListSubtitle(row({ ownershipType: "CUSTOMER" })),
      "Ügyfél · 0 eszköz",
    );
  });

  it("a liter csak akkor jelenik meg, ha van érték, és 3 tizedesig", () => {
    assert.equal(
      aquariumListSubtitle(row({ systemVolumeLiters: 200 })),
      "Saját · 200 l · 0 eszköz",
    );
    assert.equal(
      aquariumListSubtitle(row({ systemVolumeLiters: 1.103 })),
      "Saját · 1,103 l · 0 eszköz",
    );
  });

  it("az eszközszám egyes és többes száma", () => {
    assert.equal(
      aquariumListSubtitle(row({ equipmentCount: 1 })),
      "Saját · 1 eszköz",
    );
    assert.equal(
      aquariumListSubtitle(row({ equipmentCount: 3 })),
      "Saját · 3 eszköz",
    );
  });
});
