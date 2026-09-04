import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { userAuditMetadata } from "./user-audit.js";

/**
 * AMIT AZ AUDITNAPLO LEIR EGY FELHASZNALO-MODOSITASROL.
 *
 * A `customerId` nem egy mezo a tobbi kozott: abbol szamolja a rendszer, mit
 * lat az illeto. Ezek az allitasok azt kotik le, hogy a nyom megvalaszolja azt
 * a kerdest, amiert kinyitjak.
 */

const before = { customerId: null };

describe("a felhasználó-módosítás naplója", () => {
  it("az expectedUpdatedAt NEM változtatott mező", () => {
    /*
      Az a versenyhelyzet-vedelem parametere, es MINDEN modositasban ott van.
      Ha bekerulne a listaba, minden bejegyzes ugy nezne ki, mintha
      valtoztattak volna rajta valamit -- es a naplo pont arra lenne
      hasznalhatatlan, amire valo.

      MI PIROSIT: a szures elhagyasa.
    */
    const out = userAuditMetadata({
      fields: { nickname: "Réka", expectedUpdatedAt: "2026-01-02" },
      before,
      after: { customerId: null },
    });
    assert.deepEqual(out.changedFields, ["nickname"]);
  });

  it("a vevő-kötés MINDKÉT végét leírja, nem csak a mező nevét", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN. Egy "customerId megvaltozott"
      bejegyzes epp arra nem valaszol, amiert az auditnaplot kinyitjak: MELYIK
      vevorol MELYIKRE.

      MI PIROSIT: ha a mezo csak a `changedFields` listaba kerulne be.
    */
    const out = userAuditMetadata({
      fields: { customerId: "customer-2", expectedUpdatedAt: "2026-01-02" },
      before: { customerId: "customer-1" },
      after: { customerId: "customer-2" },
    });
    assert.deepEqual(out.customerId, { from: "customer-1", to: "customer-2" });
  });

  it("a kötés MEGSZŰNÉSE is leírt esemény, nem hiányzó adat", () => {
    /*
      EZ A VESZELYESEBB IRANY, es konnyu atsiklani rajta: a torles TAGITJA a
      hatokort -- partner nelkul a fiok belsos, es MINDENT lat.

      MI PIROSIT: ha a `null` erteket a fuggveny "nem kuldott mezokent"
      olvasna (peldaul `if (!input.fields.customerId)`), es a nyom epp a
      legfontosabb esetnel maradna el.
    */
    const out = userAuditMetadata({
      fields: { customerId: null, expectedUpdatedAt: "2026-01-02" },
      before: { customerId: "customer-1" },
      after: { customerId: null },
    });
    assert.deepEqual(out.customerId, { from: "customer-1", to: null });
  });

  it("ha a mezőt NEM küldték, nincs róla bejegyzés", () => {
    /*
      TESTVER-KONTROLL, ES NEM DISZ. Enelkul egy valtozat, ami MINDIG beirja a
      koteset, a fenti harom allitason atmenne -- es minden becenev-atirasnal
      azt allitana, hogy a kotes "valtozott null-rol null-ra". Egy nyom, ami
      minden soron ott van, ugyanannyit mond, mint a semmi.
    */
    const out = userAuditMetadata({
      fields: { nickname: "Réka", expectedUpdatedAt: "2026-01-02" },
      before: { customerId: "customer-1" },
      after: { customerId: "customer-1" },
    });
    assert.equal("customerId" in out, false);
  });
});
