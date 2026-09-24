import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assetDepartmentPresenceRefusal,
  assetDepartmentRefusal,
} from "./asset-department.js";

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

  /**
   * A MAI VAKSÁG HELYE, 2026-09-22-ig: a `requested: false` eset -- amikor a
   * hívó SOSEM küld departmentId-t -- a `!input.requested` sornál `null`-lal
   * tért vissza, MIELŐTT a CUSTOMER_OWNER ágat egyáltalán elérte volna. Egy
   * vevő-tulajdonú eszköz LÉTREHOZÁSA (ami sosem küld departmentId-t, mert a
   * vevőknek sosem volt alegységük) így átment ezen a validáción, és a
   * `NOT NULL` megkötés alatt nyers, megnevezetlen adatbázis-hibával végződött
   * volna. A CUSTOMER_OWNER ág mostantól `requested`-től FÜGGETLENÜL fut --
   * lásd a függvény fejlécét.
   */
  it("refuses a unit on a customer-owned asset even when no unit was requested", () => {
    assert.equal(
      assetDepartmentRefusal({
        ownerType: "CUSTOMER",
        mirrorCustomerId: null,
        department: null,
        requested: false,
      }),
      "CUSTOMER_OWNER",
    );
  });

  /**
   * A MEZŐ ELHAGYÁSA EBBŐL A FÜGGVÉNYBŐL NÉZVE NEM TÖRLÉS ÉS NEM HIBA -- ez a
   * függvény a MEGADOTT érték helyességét vizsgálja, nem a jelenlétét. A
   * jelenlét (kell-e SUPPLIER-nél) 2026-09-22 óta egy KÜLÖN függvény dolga,
   * lásd lent: `assetDepartmentPresenceRefusal`. A kettő szándékosan nem egy
   * függvény -- lásd annak fejlécét.
   */
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

describe("whether a department must be present at all", () => {
  it("requires it on create for a SUPPLIER owner", () => {
    assert.equal(
      assetDepartmentPresenceRefusal({
        ownerType: "SUPPLIER",
        operation: "create",
        departmentId: undefined,
      }),
      true,
    );
  });

  /**
   * A LEGKÖZELEBBI TÉVESZTÉS, NEM EGY TÁVOLI HELYES ESET: egy ÜRES SZTRING
   * (pl. egy űrlap, ami "" -t küld kiválasztás helyett) ugyanúgy hiánynak
   * számít, mint az `undefined`.
   */
  it("treats an empty string the same as a missing value on create", () => {
    assert.equal(
      assetDepartmentPresenceRefusal({
        ownerType: "SUPPLIER",
        operation: "create",
        departmentId: "",
      }),
      true,
    );
  });

  it("accepts a real value on create for a SUPPLIER owner", () => {
    assert.equal(
      assetDepartmentPresenceRefusal({
        ownerType: "SUPPLIER",
        operation: "create",
        departmentId: "department-1",
      }),
      false,
    );
  });

  /**
   * A CUSTOMER-ÁGRA NEM EZ A FÜGGVÉNY VÉD: azt a `CUSTOMER_OWNER` fedi (lásd
   * fent), ami a mezőtől FÜGGETLENÜL mindig elutasít. Ez a függvény
   * CUSTOMER-nél mindig `false`-t ad, nem azért, mert megengedő, hanem mert
   * nem az ő felelőssége.
   */
  it("never blocks on department presence for a CUSTOMER owner", () => {
    assert.equal(
      assetDepartmentPresenceRefusal({
        ownerType: "CUSTOMER",
        operation: "create",
        departmentId: undefined,
      }),
      false,
    );
  });

  it("leaves an existing SUPPLIER-owned asset untouched when the field is omitted on update", () => {
    assert.equal(
      assetDepartmentPresenceRefusal({
        ownerType: "SUPPLIER",
        operation: "update",
        departmentId: undefined,
      }),
      false,
    );
  });

  /**
   * A MAI VAKSÁG HELYE, 2026-09-22-ig: explicit `null` küldése (a DTO ezt
   * eddig érvényes törlésnek vette) update-nél ugyanúgy a NOT NULL megkötésbe
   * ütközne, mint a hiányzó mező create-nél.
   */
  it("refuses an explicit null on update for a SUPPLIER owner", () => {
    assert.equal(
      assetDepartmentPresenceRefusal({
        ownerType: "SUPPLIER",
        operation: "update",
        departmentId: null,
      }),
      true,
    );
  });

  it("accepts a real value on update for a SUPPLIER owner", () => {
    assert.equal(
      assetDepartmentPresenceRefusal({
        ownerType: "SUPPLIER",
        operation: "update",
        departmentId: "department-1",
      }),
      false,
    );
  });
});
