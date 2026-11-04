import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { partnerFilter, partnerRolesOf } from "./customers.repository.js";

/**
 * A VEVŐK LISTA SZEREP-SZŰRŐJE (egy partnertörzs). MI PIROSÍT: ha szerep nélkül a partner-sorok megjelennének a választókban (a
 * régi viselkedés törne: a számla vevőválasztója és az akvárium-választó ettől függ); ha a szerep szűrője más sorokat enged át; ha a
 * szerepek nem a Supplier jelzőiből jönnek, vagy a vevő-sor szerepet kap.
 */
describe("partnerFilter", () => {
  it("without a role keeps the old behaviour: partner mirrors only when the caller asks for them", () => {
    assert.deepEqual(partnerFilter(undefined, false), { partner: null });
    assert.deepEqual(partnerFilter(undefined, true), {});
  });

  it("with a role the list shows partners too, narrowed by the role", () => {
    assert.deepEqual(partnerFilter("ALL", false), {});
    assert.deepEqual(partnerFilter("BUYER", true), { partner: null });
    assert.deepEqual(partnerFilter("PARTNER", false), {
      partner: { isNot: null },
    });
    assert.deepEqual(partnerFilter("SUPPLIER", false), {
      partner: { is: { isSupplier: true } },
    });
    assert.deepEqual(partnerFilter("SERVICE", false), {
      partner: { is: { isService: true } },
    });
  });
});

describe("partnerRolesOf", () => {
  it("derives the roles from the flags, and gives a buyer none", () => {
    assert.deepEqual(partnerRolesOf(null), {});
    assert.deepEqual(partnerRolesOf({ isSupplier: true, isService: false }), {
      partnerRoles: ["SUPPLIER"],
    });
    assert.deepEqual(partnerRolesOf({ isSupplier: false, isService: true }), {
      partnerRoles: ["SERVICE"],
    });
    assert.deepEqual(partnerRolesOf({ isSupplier: true, isService: true }), {
      partnerRoles: ["SUPPLIER", "SERVICE"],
    });
    assert.deepEqual(partnerRolesOf({ isSupplier: false, isService: false }), {
      partnerRoles: [],
    });
  });
});
