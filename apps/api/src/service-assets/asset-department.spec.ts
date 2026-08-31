import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assetDepartmentRefusal } from "./asset-department.js";

const unit = { customerId: "mirror-1", isActive: true };

describe("which unit an asset may be tied to", () => {
  /**
   * A NEGATÍV KONTROLL BEMENETE PONTOSAN AZ AZ ESET, AMI MA ÜRES LISTÁT AD:
   * szerviz partner, akinek van alegység-fája. A javítás előtt az eszköz
   * egyáltalán nem tudott alegységre hivatkozni -- a mező nem is létezett --,
   * tehát ez az állítás a mai kódon le sem fordulna. A rendszer viselkedését
   * pedig ez őrzi: ha a szabály valaha átengedne egy másik partner
   * alegységét, ez vált pirosra.
   */
  it("accepts a unit that belongs to the owner partner's mirror row", () => {
    assert.equal(
      assetDepartmentRefusal({
        ownerType: "SUPPLIER",
        mirrorCustomerId: "mirror-1",
        department: unit,
        requested: true,
      }),
      null,
    );
  });

  it("refuses a unit that belongs to another partner", () => {
    assert.equal(
      assetDepartmentRefusal({
        ownerType: "SUPPLIER",
        mirrorCustomerId: "mirror-2",
        department: unit,
        requested: true,
      }),
      "OTHER_PARTNER",
    );
  });

  /**
   * A tükör nélküli partner nem külön ág: alegysége sincs, tehát a `null`
   * összehasonlítás maga utasítja el. Ez azért áll itt külön állításként, mert
   * a `null === null` egy elírással igazzá válna, és akkor egy tükör nélküli
   * partner IDEGEN alegységet kapna.
   */
  it("refuses everything for a partner that has no mirror row", () => {
    assert.equal(
      assetDepartmentRefusal({
        ownerType: "SUPPLIER",
        mirrorCustomerId: null,
        department: unit,
        requested: true,
      }),
      "OTHER_PARTNER",
    );
  });

  it("refuses an archived unit", () => {
    assert.equal(
      assetDepartmentRefusal({
        ownerType: "SUPPLIER",
        mirrorCustomerId: "mirror-1",
        department: { ...unit, isActive: false },
        requested: true,
      }),
      "INACTIVE",
    );
  });

  it("refuses a unit that does not exist", () => {
    assert.equal(
      assetDepartmentRefusal({
        ownerType: "SUPPLIER",
        mirrorCustomerId: "mirror-1",
        department: null,
        requested: true,
      }),
      "NOT_FOUND",
    );
  });

  /**
   * A KÉT FOGALOM SZÉTVÁLASZTÁSA, állításként. Vevő eszközénél a pontosítás a
   * CÍM; ha az alegység is átmenne itt, akkor ugyanaz a zavar keletkezne, ami
   * miatt ez az egész készült.
   */
  it("refuses a unit on a customer-owned asset, where the address is the refinement", () => {
    assert.equal(
      assetDepartmentRefusal({
        ownerType: "CUSTOMER",
        mirrorCustomerId: null,
        department: unit,
        requested: true,
      }),
      "CUSTOMER_OWNER",
    );
  });

  /** A mező elhagyása nem törlés és nem hiba: az eszköz alegység nélkül is
   * rögzíthető, a meglévők pedig NULL értékkel maradnak. */
  it("says nothing when no unit was sent at all", () => {
    assert.equal(
      assetDepartmentRefusal({
        ownerType: "SUPPLIER",
        mirrorCustomerId: "mirror-1",
        department: null,
        requested: false,
      }),
      null,
    );
  });
});
