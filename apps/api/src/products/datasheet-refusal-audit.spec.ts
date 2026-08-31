import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DATASHEET_FIELD_COLUMNS,
  describeRefusalConflicts,
  findRefusalConflicts,
  type AuditableDatasheet,
} from "./datasheet-refusal-audit.js";

/**
 * A DETEKTOR, hálózat és adatbázis nélkül.
 *
 * Amit ez bizonyít: hogy az audit MEGTALÁLJA az ellentmondó párt. Amit NEM
 * bizonyít: hogy bármelyik adatbázis tiszta - ahhoz az auditot AZ ELLEN az
 * adatbázis ellen kell futtatni. A kettőt könnyű összekeverni, mert mindkettő
 * zölden néz ki.
 */

const sheet = (over: Partial<AuditableDatasheet> = {}): AuditableDatasheet => ({
  id: "ds-1",
  refusals: [],
  ...over,
});

describe("findRefusalConflicts", () => {
  it("finds a refused field that still carries a value", () => {
    const conflicts = findRefusalConflicts([
      sheet({ tartasa: "Könnyű", refusals: [{ mezo: "TARTASA" }] }),
    ]);

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.mezo, "TARTASA");
    assert.deepEqual(conflicts[0]!.kitoltottOszlopok, ["tartasa"]);
  });

  /** KONTROLL: enélkül egy „mindent összeütközésnek jelent" hiba is zöld lenne. */
  it("stays quiet when the refused field really is empty", () => {
    const conflicts = findRefusalConflicts([
      sheet({ tartasa: null, refusals: [{ mezo: "TARTASA" }] }),
    ]);

    assert.deepEqual(conflicts, []);
  });

  /** KONTROLL: érték megtagadás nélkül a normál eset, nem ütközés. */
  it("stays quiet when a filled field has no refusal", () => {
    assert.deepEqual(findRefusalConflicts([sheet({ tartasa: "Könnyű" })]), []);
  });

  /**
   * AZ ÜRES TÖMB NEM ÉRTÉK. Postgres alatt a lista alapértelmezése üres tömb, nem
   * NULL: ha értéknek vennénk, MINDEN adatlap MINDEN tömb-mezője kitöltöttnek
   * látszana a létrehozás pillanatától, és az audit minden megtagadást
   * ütközésnek jelentene.
   */
  it("does not treat an empty array as a value", () => {
    const conflicts = findRefusalConflicts([
      sheet({ aggression: [], refusals: [{ mezo: "AGGRESSION" }] }),
    ]);

    assert.deepEqual(conflicts, []);
  });

  it("treats a non-empty array as a value", () => {
    const conflicts = findRefusalConflicts([
      sheet({ aggression: ["BEKES"], refusals: [{ mezo: "AGGRESSION" }] }),
    ]);

    assert.equal(conflicts.length, 1);
    assert.deepEqual(conflicts[0]!.kitoltottOszlopok, ["aggression"]);
  });

  /** A csupa szóköz ugyanolyan üres, mint a NULL - máskülönben megkerülhető. */
  it("does not treat whitespace as a value", () => {
    const conflicts = findRefusalConflicts([
      sheet({ tartasa: "   ", refusals: [{ mezo: "TARTASA" }] }),
    ]);

    assert.deepEqual(conflicts, []);
  });

  /**
   * A TÖBB OSZLOPOS MEZŐK: egy mezőt négy oszlop is hordozhat, és BÁRMELYIK
   * kitöltöttsége ütközés. Ha az audit csak az elsőt nézné, három oszlop néma
   * maradna.
   */
  it("catches any of the four columns behind one field", () => {
    for (const column of DATASHEET_FIELD_COLUMNS.AKVARIUM_MERET!) {
      const conflicts = findRefusalConflicts([
        sheet({
          [column]: column === "meretKategoria" ? "NANO" : "38",
          refusals: [{ mezo: "AKVARIUM_MERET" }],
        } as Partial<AuditableDatasheet>),
      ]);

      assert.equal(conflicts.length, 1, `nem fogta meg: ${column}`);
      assert.deepEqual(conflicts[0]!.kitoltottOszlopok, [column]);
    }
  });

  it("reports every conflict, not just the first", () => {
    const conflicts = findRefusalConflicts([
      sheet({
        id: "ds-a",
        tartasa: "Könnyű",
        kulleme: "Piros",
        refusals: [{ mezo: "TARTASA" }, { mezo: "KULLEME" }],
      }),
      sheet({
        id: "ds-b",
        genus: "Nardoa",
        refusals: [{ mezo: "SCIENTIFIC_NAME" }],
      }),
    ]);

    assert.equal(conflicts.length, 3);
    assert.deepEqual(
      conflicts.map((conflict) => conflict.datasheetId),
      ["ds-a", "ds-a", "ds-b"],
    );
  });

  /**
   * A TÉRKÉP TELJESSÉGE. Ha valaki új mezőt vesz fel az enumba, a `Record`
   * miatt a modul nem fordul le, amíg ide be nem kerül - de egy ÜRES oszlop-lista
   * lefordulna, és néma lenne. Ez a teszt azt is kizárja.
   */
  it("maps every field to at least one column", () => {
    for (const [field, columns] of Object.entries(DATASHEET_FIELD_COLUMNS))
      assert.ok(columns.length > 0, `${field} egyetlen oszlopra sem mutat`);
  });
});

describe("describeRefusalConflicts", () => {
  it("says plainly when there is nothing to report", () => {
    assert.match(describeRefusalConflicts([]), /Nincs ellentmondó pár/);
  });

  it("names the sheet, the field and the columns", () => {
    const text = describeRefusalConflicts([
      { datasheetId: "ds-1", mezo: "TARTASA", kitoltottOszlopok: ["tartasa"] },
    ]);

    assert.match(text, /ds-1/);
    assert.match(text, /TARTASA/);
    assert.match(text, /tartasa/);
  });
});
