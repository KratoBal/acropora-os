import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mayAssignUnit } from "./visibility-assignment.js";

const alap = {
  userSupplierId: "sup-1",
  supplierMirrorCustomerId: "cust-1",
  unitCustomerId: "cust-1",
};

describe("mehet-e ez az alegység ehhez a felhasználóhoz", () => {
  it("saját partner alegysége mehet", () => {
    assert.deepEqual(mayAssignUnit(alap), { ok: true });
  });

  /**
   * EZ AZ ALLITAS A KAR MIATT VAN, NEM A SZABALY MIATT.
   *
   * Egy MASIK partner alegysege ugy nezne ki, mint egy sikeres hozzarendeles --
   * es a felhasznalo attol kezdve IDEGEN hibajegyeket latna. A hiba nema: a
   * lista tobb sort ad, es helyes valasznak nez ki.
   */
  it("másik partner alegysége NEM mehet", () => {
    assert.deepEqual(mayAssignUnit({ ...alap, unitCustomerId: "cust-2" }), {
      ok: false,
      reason: "other-partner",
    });
  });

  it("tükör nélküli partnernél nincs mihez rendelni", () => {
    assert.deepEqual(
      mayAssignUnit({ ...alap, supplierMirrorCustomerId: null }),
      { ok: false, reason: "no-mirror" },
    );
  });

  /**
   * SAJAT KOLLEGA: a hozzarendeles nem bovitene semmit (belsos hatokorrel
   * mindent lat), viszont azt SUGALLNA, hogy szukiti. Egy nem letezo szukites
   * latszata rosszabb, mint a hianya.
   */
  it("saját kollégához nem lehet alegységet rendelni", () => {
    assert.deepEqual(mayAssignUnit({ ...alap, userSupplierId: null }), {
      ok: false,
      reason: "not-partner-user",
    });
  });

  /**
   * A SORREND IS ALLITAS: tukor nelkuli partnernel a valasz `no-mirror`, NEM
   * `other-partner`, holott mindketto igaz allitas lenne. A kulonbseg a
   * TEENDOBEN van -- az egyiknel a partnert kell szerviznek jelolni, a masiknal
   * masik alegyseget kell valasztani -- es egy osszevont uzenet rossz iranyba
   * kuldene.
   */
  it("a hiányzó tükör előbbre való, mint az eltérő partner", () => {
    assert.deepEqual(
      mayAssignUnit({
        ...alap,
        supplierMirrorCustomerId: null,
        unitCustomerId: "cust-2",
      }),
      { ok: false, reason: "no-mirror" },
    );
  });
});
