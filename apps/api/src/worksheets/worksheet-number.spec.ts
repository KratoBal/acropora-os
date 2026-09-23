import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorksheetNumber,
  worksheetNumberIssue,
  worksheetYear,
  WORKSHEET_NUMBER_ISSUE_MESSAGES,
} from "./worksheet-number.js";

describe("worksheet number", () => {
  /**
   * A SZÁM HÁROM TAGÚ, nem négy: a partner rövidítése 2026-08-27 óta NEM
   * szerepel benne (a lap címe már azonosítja). Az egyediséget innentől a
   * SOROZAT adja -- egy számláló évenként, az egész cégre --, nem az, hogy
   * valaki jól választ egység-kódot.
   *
   * A `partnerCode` a bemenetben MARAD, mert a lezárás továbbra is megköveteli
   * (l. lentebb: rövidítés nélküli partnerhez nem zárható le lap). Csak a
   * SZÁMBÓL került ki.
   */
  it("formats the agreed three-part number", () => {
    assert.equal(
      buildWorksheetNumber({
        partnerCode: "FANK",
        departmentCode: "BIO",
        year: 2026,
        sequence: 1,
      }).number,
      "BIO-2026-001",
    );
  });

  it("grows past three digits instead of wrapping around", () => {
    const last = buildWorksheetNumber({
      partnerCode: "FANK",
      departmentCode: "BIO",
      year: 2026,
      sequence: 999,
    });
    const next = buildWorksheetNumber({
      partnerCode: "FANK",
      departmentCode: "BIO",
      year: 2026,
      sequence: 1000,
    });
    assert.equal(last.number, "BIO-2026-999");
    assert.equal(next.number, "BIO-2026-1000");
  });

  it("keeps growing past four digits as well", () => {
    // A hárommal feltöltés alsó korlát, nem felső: a sorszám nem vágódik és
    // nem fordul át, csak hosszabb lesz. Egy sorozat sem áll meg attól, hogy
    // egy partner sokat dolgozik.
    assert.equal(
      buildWorksheetNumber({
        partnerCode: "FANK",
        departmentCode: "BIO",
        year: 2026,
        sequence: 10000,
      }).number,
      "BIO-2026-10000",
    );
  });

  it("refuses a partner without an abbreviation", () => {
    assert.equal(
      worksheetNumberIssue({ partnerCode: null, departmentCode: "BIO" }),
      "PARTNER_CODE_MISSING",
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "  ", departmentCode: "BIO" }),
      "PARTNER_CODE_MISSING",
    );
  });

  it("refuses a worksheet without a department code", () => {
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: null }),
      "DEPARTMENT_CODE_MISSING",
    );
  });

  it("refuses codes that would produce a differently shaped number", () => {
    assert.equal(
      worksheetNumberIssue({ partnerCode: "fank", departmentCode: "BIO" }),
      "PARTNER_CODE_INVALID",
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "BIODOM" }),
      "DEPARTMENT_CODE_INVALID",
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "BIO" }),
      null,
    );
  });

  /**
   * A HELYSZIN-KOD SZAMJEGYET IS TARTALMAZHAT (Balazs, 2026-09-22).
   *
   * A NEGYEDIK ES OTODIK ALLITAS A LENYEG, NEM AZ ELSO HAROM. Egy teszt, ami
   * csak azt mondja, hogy "A1" es "12" atmegy, ZOLD LENNE AKKOR IS, ha valaki
   * a mintat teljesen kivenne -- vagyis nem a tagitast merne, hanem a
   * megkotes ELTUNESET. Az "ABCDEF" es a kisbetus alak MA IS bukik, es a
   * tagitas utan is buknia kell: ez valasztja szet a kettot.
   */
  it("accepts digits in the department code, and still refuses what it refused", () => {
    // a tagitas: szam es betu keverve, es tisztan szam is
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "A1" }),
      null,
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "12" }),
      null,
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "1A2" }),
      null,
    );

    // ES AMI VALTOZATLANUL BUKIK -- enelkul a fenti harom nem bizonyit semmit
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "ABCDEF" }),
      "DEPARTMENT_CODE_INVALID",
      "hat karakter meg az uj, ot karakteres hataron tul is bukik",
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "123456" }),
      "DEPARTMENT_CODE_INVALID",
      "a hossz szamjegyre is all, nem csak beture",
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "bio" }),
      "DEPARTMENT_CODE_INVALID",
      "ez a TAROLT alak mintaja, az pedig nagybetus; a bemenetet a DTO engedi meg es a repository normalizalja",
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "A-1" }),
      "DEPARTMENT_CODE_INVALID",
      "a kotojel a munkalapszam tagolo jele: egy kodban allva ketertelmuve tenne a szamot",
    );
  });

  /**
   * A FANK BIODOM RENDSZER-KODJAI (Balazs dontese, 2026-09-23 11:39, "b").
   *
   * Pozitiv kontrollkent: enelkul a fenti "es ami valtozatlanul bukik" ag
   * ugy is zold lenne, ha valaki a hatart negyre vagy harmara vinne vissza
   * -- azt csak egy ot karakteres, ELFOGADOTT eset zarja ki.
   */
  it("accepts the five-character FANK Biodóm system codes", () => {
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "LSS01" }),
      null,
    );
    assert.equal(
      buildWorksheetNumber({
        partnerCode: "FANK",
        departmentCode: "LSS01",
        year: 2026,
        sequence: 1,
      }).number,
      "LSS01-2026-001",
    );
  });

  it("has a Hungarian message for every issue", () => {
    for (const issue of [
      "PARTNER_CODE_MISSING",
      "PARTNER_CODE_INVALID",
      "DEPARTMENT_CODE_MISSING",
      "DEPARTMENT_CODE_INVALID",
    ] as const) {
      assert.ok(WORKSHEET_NUMBER_ISSUE_MESSAGES[issue].length > 10);
    }
  });

  it("never sends the reader to the customer page, where the field cannot be edited", () => {
    for (const message of Object.values(WORKSHEET_NUMBER_ISSUE_MESSAGES)) {
      assert.ok(
        !/vev[őo]/i.test(message),
        `a message still names the customer: ${message}`,
      );
    }
  });

  it("sends the reader to the partner page for a missing abbreviation", () => {
    assert.match(
      WORKSHEET_NUMBER_ISSUE_MESSAGES.PARTNER_CODE_MISSING,
      /partner adatlapján/,
    );
  });

  it("rejects a sequence that was never allocated", () => {
    assert.throws(() =>
      buildWorksheetNumber({
        partnerCode: "FANK",
        departmentCode: "BIO",
        year: 2026,
        sequence: 0,
      }),
    );
  });

  it("takes the year from Budapest local time, not from UTC", () => {
    // 2026. december 31. 23:30 UTC = 2027. január 1. 00:30 Budapesten.
    // A lezárás tehát már az új sorozatba tartozik.
    const turnOfYear = new Date("2026-12-31T23:30:00.000Z");
    assert.equal(worksheetYear(turnOfYear), 2027);
    assert.equal(worksheetYear(turnOfYear, "UTC"), 2026);
  });
});
