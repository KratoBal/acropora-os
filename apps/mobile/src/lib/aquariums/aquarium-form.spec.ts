import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aquariumFormError,
  emptyEquipmentDraft,
  emptyNewCustomerDraft,
  equipmentDraftError,
  newCustomerDraftError,
  type AquariumFormState,
} from "./aquarium-form";

describe("equipmentDraftError", () => {
  it("elfogadja az alapértelmezett sort", () => {
    assert.equal(equipmentDraftError(emptyEquipmentDraft("VILAGITAS")), null);
  });

  it("elutasítja a nem pozitív vagy nem egész mennyiséget", () => {
    assert.notEqual(
      equipmentDraftError({
        ...emptyEquipmentDraft("VILAGITAS"),
        quantity: "0",
      }),
      null,
    );
    assert.notEqual(
      equipmentDraftError({
        ...emptyEquipmentDraft("VILAGITAS"),
        quantity: "1.5",
      }),
      null,
    );
    assert.notEqual(
      equipmentDraftError({
        ...emptyEquipmentDraft("VILAGITAS"),
        quantity: "",
      }),
      null,
    );
  });

  /**
   * KALIBRÁCIÓ: a csatornaszám-kötelezettség CSAK a nyomelem adagolónál áll.
   * Egy állítás, ami erre a mezőre soha nem hivatkozna (pl. csak a
   * mennyiséget nézné), zölden menne át akkor is, ha a feltétel törölve
   * lenne -- ideiglenesen kikapcsolva az ág, pontosan ez a két állítás lett
   * volna piros, a többi nem.
   */
  it("a csatornaszám csak a nyomelem adagolónál kötelező", () => {
    assert.equal(
      equipmentDraftError(emptyEquipmentDraft("NYOMELEM_ADAGOLO")),
      "A nyomelem adagolónál a csatornaszám kötelező.",
    );
    assert.equal(
      equipmentDraftError({
        ...emptyEquipmentDraft("NYOMELEM_ADAGOLO"),
        channelCount: "4",
      }),
      null,
    );
    assert.equal(equipmentDraftError(emptyEquipmentDraft("FUTES")), null);
  });
});

describe("newCustomerDraftError", () => {
  it("kötelező a név", () => {
    assert.notEqual(newCustomerDraftError(emptyNewCustomerDraft()), null);
  });

  it("cím nélkül is menthető, ha a név megvan", () => {
    assert.equal(
      newCustomerDraftError({
        ...emptyNewCustomerDraft(),
        displayName: "Kovács János",
      }),
      null,
    );
  });

  it("részleges cím elutasítva", () => {
    assert.notEqual(
      newCustomerDraftError({
        ...emptyNewCustomerDraft(),
        displayName: "Kovács János",
        city: "Budapest",
      }),
      null,
    );
  });

  it("teljes cím elfogadva", () => {
    assert.equal(
      newCustomerDraftError({
        ...emptyNewCustomerDraft(),
        displayName: "Kovács János",
        postalCode: "1011",
        city: "Budapest",
        line1: "Fő utca 1.",
      }),
      null,
    );
  });
});

describe("aquariumFormError", () => {
  function state(
    overrides: Partial<AquariumFormState> = {},
  ): AquariumFormState {
    return {
      name: "Nappali akvárium",
      ownershipType: "OWN",
      customerMode: "EXISTING",
      selectedCustomerId: null,
      newCustomer: emptyNewCustomerDraft(),
      ...overrides,
    };
  }

  it("saját akváriumnál a név elég", () => {
    assert.equal(aquariumFormError(state()), null);
  });

  it("ügyfél akváriumnál meglévő móddal ügyfél kell", () => {
    assert.notEqual(
      aquariumFormError(state({ ownershipType: "CUSTOMER" })),
      null,
    );
    assert.equal(
      aquariumFormError(
        state({ ownershipType: "CUSTOMER", selectedCustomerId: "cust-1" }),
      ),
      null,
    );
  });

  it("ügyfél akváriumnál új móddal az új ügyfél hibáját adja tovább", () => {
    assert.equal(
      aquariumFormError(
        state({ ownershipType: "CUSTOMER", customerMode: "NEW" }),
      ),
      "Az ügyfél neve kötelező.",
    );
  });

  it("név nélkül mindig hiba, tulajdontól függetlenül", () => {
    assert.notEqual(aquariumFormError(state({ name: "  " })), null);
  });
});
