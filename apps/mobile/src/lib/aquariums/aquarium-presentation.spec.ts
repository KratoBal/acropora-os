import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aquariumListSubtitle,
  EQUIPMENT_KIND_LABELS,
  EQUIPMENT_KIND_OPTIONS,
  EQUIPMENT_KIND_ORDER,
  equipmentRequiresChannelCount,
  OWNERSHIP_LABELS,
  OWNERSHIP_OPTIONS,
  WATER_BODY_LABELS,
  WATER_BODY_OPTIONS,
  type AquariumListLike,
} from "./aquarium-presentation";

describe("a választók a sorrendből és a címke-táblából épülnek", () => {
  it("tulajdon: két opció, a címke-táblával egyezve", () => {
    assert.deepEqual(OWNERSHIP_OPTIONS, [
      { value: "OWN", label: OWNERSHIP_LABELS.OWN },
      { value: "CUSTOMER", label: OWNERSHIP_LABELS.CUSTOMER },
    ]);
  });

  it("víztest: akvárium/tó, a címke-táblával egyezve", () => {
    assert.deepEqual(WATER_BODY_OPTIONS, [
      { value: "AKVARIUM", label: WATER_BODY_LABELS.AKVARIUM },
      { value: "TO", label: WATER_BODY_LABELS.TO },
    ]);
  });

  it("eszköz-fajta: a sorrend minden fajtát pontosan egyszer sorol fel", () => {
    assert.deepEqual(
      [...EQUIPMENT_KIND_ORDER].sort(),
      Object.keys(EQUIPMENT_KIND_LABELS).sort(),
    );
    assert.equal(
      new Set(EQUIPMENT_KIND_ORDER).size,
      EQUIPMENT_KIND_ORDER.length,
    );
    assert.deepEqual(
      EQUIPMENT_KIND_OPTIONS,
      EQUIPMENT_KIND_ORDER.map((value) => ({
        value,
        label: EQUIPMENT_KIND_LABELS[value],
      })),
    );
  });
});

describe("equipmentRequiresChannelCount", () => {
  it("csak a nyomelem adagolónál igaz", () => {
    assert.equal(equipmentRequiresChannelCount("NYOMELEM_ADAGOLO"), true);
    for (const kind of EQUIPMENT_KIND_ORDER) {
      if (kind === "NYOMELEM_ADAGOLO") continue;
      assert.equal(
        equipmentRequiresChannelCount(kind),
        false,
        `${kind} ne kérje a csatornaszámot`,
      );
    }
  });
});

function item(overrides: Partial<AquariumListLike> = {}): AquariumListLike {
  return {
    ownershipType: "OWN",
    customerName: null,
    systemVolumeLiters: null,
    equipmentCount: 0,
    ...overrides,
  };
}

describe("aquariumListSubtitle", () => {
  it("saját akvárium, méret és eszköz nélkül", () => {
    assert.equal(aquariumListSubtitle(item()), "Saját · 0 eszköz");
  });

  it("ügyfél akvárium az ügyfél nevével, nem a 'Ügyfél' szóval", () => {
    assert.equal(
      aquariumListSubtitle(
        item({ ownershipType: "CUSTOMER", customerName: "Kovács János" }),
      ),
      "Kovács János · 0 eszköz",
    );
  });

  it("ügyfél akvárium ügyfél NÉLKÜL a birtokviszony szavára esik vissza", () => {
    assert.equal(
      aquariumListSubtitle(item({ ownershipType: "CUSTOMER" })),
      "Ügyfél · 0 eszköz",
    );
  });

  it("a liter csak akkor jelenik meg, ha van érték, és 3 tizedesig", () => {
    assert.equal(
      aquariumListSubtitle(item({ systemVolumeLiters: 200 })),
      "Saját · 200 l · 0 eszköz",
    );
    assert.equal(
      aquariumListSubtitle(item({ systemVolumeLiters: 1.103 })),
      "Saját · 1,103 l · 0 eszköz",
    );
  });

  it("az eszközszám egyes és többes száma", () => {
    assert.equal(
      aquariumListSubtitle(item({ equipmentCount: 1 })),
      "Saját · 1 eszköz",
    );
    assert.equal(
      aquariumListSubtitle(item({ equipmentCount: 3 })),
      "Saját · 3 eszköz",
    );
  });
});
