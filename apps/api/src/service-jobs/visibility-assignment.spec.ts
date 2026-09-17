import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mayAssignUnit } from "./visibility-assignment.js";

/**
 * AZ ALAPESET A SZALLITOHOZ KOTOTT FIOK, tehat a vevo-kotese `null`. A ket
 * kotes KIZARJA EGYMAST (`User_at_most_one_partner_check` az adatbazisban),
 * ezert nem is fordul elo olyan bemenet, amiben mind a ketto all.
 */
const alap = {
  userSupplierId: "sup-1",
  userCustomerId: null,
  supplierMirrorCustomerId: "cust-1",
  unitCustomerId: "cust-1",
};

/** A VEVOHOZ KOTOTT FIOK: nincs szallitoja, es tukre sincs mihez. */
const vevos = {
  userSupplierId: null,
  userCustomerId: "cust-1",
  supplierMirrorCustomerId: null,
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
   * === A VEVOHOZ KOTOTT FIOK, ES EZ AZ AG MA AZ ELES AKADALY ===
   *
   * A `PARTNER_SERVICE` szerepkor kikotese a `customerId` mezore all, tehat a
   * mai partner-fiokok TOBBSEGE vevohoz kotott, `supplierId` NELKUL.
   *
   * MI PIROSIT: a vevos ag elhagyasa. Akkor ez a bemenet a `userSupplierId ===
   * null` feltetelen esik ki, `not-partner-user` okkal -- es a felhasznalo azt
   * az uzenetet kapja, hogy "Ez a fiok nem partner-oldali: belso hatokorrel
   * amugy is mindent lat". Pont az ELLENKEZOJE az igazsagnak.
   */
  it("vevőhöz kötött fiókhoz mehet a SAJÁT vevője alegysége", () => {
    assert.deepEqual(mayAssignUnit(vevos), { ok: true });
  });

  /**
   * A NEGATIV PARJA, ES UGYANAZ A KAR, MINT A SZALLITOS AGON: egy masik vevo
   * alegysege sikeres hozzarendelesnek latszana, es a fiok attol kezdve IDEGEN
   * hibajegyeket latna.
   *
   * ES SAJAT, MEGNEVEZETT OKA VAN (`other-customer`), nem csuszik bele a
   * `no-mirror` uzenetbe: az a TUKOR-VEVOROL beszel, ami egy vevos fioknal
   * ertelmetlen mondat. A harom eddigi ok epp azert all kulon, mert HAROM
   * kulonbozo teendot ad.
   */
  it("vevőhöz kötött fiók NEM kaphat másik vevő alegységét", () => {
    assert.deepEqual(mayAssignUnit({ ...vevos, unitCustomerId: "cust-2" }), {
      ok: false,
      reason: "other-customer",
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
