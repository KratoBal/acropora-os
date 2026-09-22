import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import {
  DESCRIPTION_EDIT_BLOCKER_MESSAGES,
  descriptionEditBlocker,
} from "./description-edit-boundary.js";

/**
 * A KET HATAR KULON AGON ALL, ES A TESZT EZT BIZONYITJA, NEM A MUKODEST.
 *
 * A nevek (A1..A8) a kanban-kartya kalibracios lapjarol jonnek, ahol a JOSLAT a
 * kod ELOTT allt. Ket rontas szempontjabol a lenyeg nem az, hogy pirosodik-e
 * valami, hanem hogy a ket piros HALMAZ ELVALIK:
 *
 *   a partner ag a BELSOS hatart kapja   ->  A6, A7
 *   a belsos ag a PARTNER hatart kapja   ->  A2, A3, A4
 *
 * Ha ezek atfednek, a tesztek nem kulonboztetik meg a ket agat, es akkor a
 * TESZTEKET kell javitani, nem a kodot.
 */

const BELSOS: PartnerScope = { kind: "internal" };
const VEVO: PartnerScope = { kind: "customer", customerId: "cus-1" };
const SZALLITO: PartnerScope = { kind: "supplier", supplierId: "sup-1" };

describe("a leírás-szerkesztés határa", () => {
  it("A1: belsős, nyitott jegy, lap nélkül -- szabad", () => {
    assert.equal(
      descriptionEditBlocker(BELSOS, {
        status: "IN_PROGRESS",
        hasWorksheet: false,
      }),
      null,
    );
  });

  /**
   * A2 ES A3 KET ALLITAS, NEM EGY. A `FINISHED` KET erteket tartalmaz
   * (`service-job-list-scope.ts`), es egy csak `COMPLETED`-re irt allitas zold
   * maradna, ha valaki a `CANCELLED`-et kihagyja.
   */
  it("A2: belsős, COMPLETED jegy -- FINISHED", () => {
    assert.equal(
      descriptionEditBlocker(BELSOS, {
        status: "COMPLETED",
        hasWorksheet: false,
      }),
      "FINISHED",
    );
  });

  it("A3: belsős, CANCELLED jegy -- FINISHED", () => {
    assert.equal(
      descriptionEditBlocker(BELSOS, {
        status: "CANCELLED",
        hasWorksheet: false,
      }),
      "FINISHED",
    );
  });

  /**
   * A4 A FORDITOTT ESET, ES EZ HORDOZZA A BIZONYITAST: a belsost a MUNKALAP nem
   * allitja meg. E nelkul a ket ag felcserelheto lenne ugy, hogy minden mas
   * zold marad.
   */
  it("A4: belsős, nyitott jegy LAPPAL -- szabad", () => {
    assert.equal(
      descriptionEditBlocker(BELSOS, {
        status: "IN_PROGRESS",
        hasWorksheet: true,
      }),
      null,
    );
  });

  it("A5: partner, nyitott jegy, lap nélkül -- szabad", () => {
    assert.equal(
      descriptionEditBlocker(VEVO, {
        status: "IN_PROGRESS",
        hasWorksheet: false,
      }),
      null,
    );
  });

  it("A6: partner, jegy LAPPAL -- HAS_WORKSHEET", () => {
    assert.equal(
      descriptionEditBlocker(VEVO, {
        status: "IN_PROGRESS",
        hasWorksheet: true,
      }),
      "HAS_WORKSHEET",
    );
  });

  /** A7: a partnert a LEZARAS nem allitja meg -- a masik forditott eset. */
  it("A7: partner, LEZÁRT jegy lap nélkül -- szabad", () => {
    assert.equal(
      descriptionEditBlocker(VEVO, {
        status: "COMPLETED",
        hasWorksheet: false,
      }),
      null,
    );
  });

  it("A8: szállító hatókör -- OUT_OF_SCOPE", () => {
    assert.equal(
      descriptionEditBlocker(SZALLITO, {
        status: "IN_PROGRESS",
        hasWorksheet: false,
      }),
      "OUT_OF_SCOPE",
    );
  });

  /**
   * M1: A NEGY ERTEK NEVE A FELHASZNALOHOZ IS ELER.
   *
   * E nelkul a megkulonboztetes diszlet: a kod harom okot ismer, a kezelo mégis
   * ugyanazt az egy mondatot latja. Ma harom kulonbozo helyen lattunk olyan
   * hibat, ahol a valodi ok HATAR volt, es a felhasznalo "nem talalhato"-t kapott.
   */
  it("M1: minden fajtának SAJÁT mondata van, és egyik sem 'nem található'", () => {
    const mondatok = Object.values(DESCRIPTION_EDIT_BLOCKER_MESSAGES);

    assert.equal(new Set(mondatok).size, mondatok.length);
    for (const mondat of mondatok) {
      assert.ok(mondat.length > 20, `túl rövid mondat: ${mondat}`);
      assert.ok(
        !/nem található/i.test(mondat),
        `a mondat elfedi a határt: ${mondat}`,
      );
    }
  });
});
