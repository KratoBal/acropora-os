import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  worksheetCloseBlocker,
  type WorksheetCloseState,
} from "./worksheet-close-blockers.js";

/** Egy lezárható lap: minden feltétel teljesül. */
function closable(): WorksheetCloseState {
  return {
    status: "DRAFT",
    lineCount: 2,
    linesWithoutPrice: 0,
    partnerCode: "BIO",
    // Az alegység kódja legfeljebb három NAGYBETŰ lehet - az első
    // fixture-öm "01" volt, és a teszt fogta meg, nem az olvasás.
    departmentCode: "AKV",
    hasNumber: false,
  };
}

describe("mi akadályozza a munkalap lezárását", () => {
  it("teljes lapon nincs akadály", () => {
    assert.equal(worksheetCloseBlocker(closable()), null);
  });

  /**
   * AZ ÁR HIÁNYA MEGENGEDETT ÁLLAPOT, DE NEM VÉGSŐ. A szerelő a helyszínen
   * azt rögzíti, mit csinált és mennyit; itt derül ki, ha az irodában valaki
   * elfelejtette kitölteni az árat.
   */
  it("ár nélküli tétellel nem zárható le", () => {
    assert.equal(
      worksheetCloseBlocker({ ...closable(), linesWithoutPrice: 1 }),
      "LINE_PRICE_MISSING",
    );
  });

  it("tétel nélkül nem zárható le", () => {
    assert.equal(
      worksheetCloseBlocker({ ...closable(), lineCount: 0 }),
      "NO_LINES",
    );
  });

  it("nem piszkozat lapon nincs mit lezárni", () => {
    assert.equal(
      worksheetCloseBlocker({ ...closable(), status: "SIGNED" }),
      "NOT_DRAFT",
    );
  });

  /**
   * A SORREND NEM KÖZÖMBÖS, ÉS EZ AZ EGYETLEN ÁLLÍTÁS, AMI MÉRI.
   *
   * Egy már aláírt lapon az ár hiánya nem az a válasz, amit a felhasználónak
   * adni kell: az általánosabb akadály áll elöl. Egy fordított sorrend
   * ugyanúgy "működne", csak rossz mondatot mutatna.
   */
  it("az általánosabb akadály áll elöl", () => {
    assert.equal(
      worksheetCloseBlocker({
        ...closable(),
        status: "SIGNED",
        linesWithoutPrice: 3,
      }),
      "NOT_DRAFT",
    );
  });

  /**
   * A MÁR MEGSZÁMOZOTT LAPON A SZÁM FELTÉTELEI NEM AKADÁLYOZNAK. A szám
   * megvan, és visszamenőleg nem változik - egy azóta törölt partner-rövidítés
   * nem teheti lezárhatatlanná azt, aminek már van száma.
   */
  it("megszámozott lapon a hiányzó partner-rövidítés nem akadály", () => {
    assert.equal(
      worksheetCloseBlocker({
        ...closable(),
        partnerCode: null,
        hasNumber: true,
      }),
      null,
    );
  });

  it("szám nélküli lapon a hiányzó partner-rövidítés akadály", () => {
    assert.equal(
      worksheetCloseBlocker({ ...closable(), partnerCode: null }),
      "PARTNER_CODE_MISSING",
    );
  });
});
