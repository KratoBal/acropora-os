import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeWorksheetSheetCoverage,
  parseWorksheetSheetCoverage,
  planWorksheetSheetBackfill,
  type WorksheetSheetBackfillRow,
} from "./worksheet-sheet-backfill.js";

function sor(
  reszlet: Partial<WorksheetSheetBackfillRow> = {},
): WorksheetSheetBackfillRow {
  return {
    worksheetId: "ws-1",
    worksheetNumber: "BIO-2026-001",
    versionId: "v-1",
    hasSheet: false,
    ...reszlet,
  };
}

describe("melyik lezart verziohoz kell utolag lap", () => {
  it("a lap nelkulieket valasztja, a lefedetteket nem", () => {
    const terv = planWorksheetSheetBackfill([
      sor({ versionId: "kell-1" }),
      sor({ versionId: "kell-2" }),
      sor({ versionId: "mar-van", hasSheet: true }),
    ]);

    assert.deepEqual(
      terv.candidates.map((x) => x.versionId),
      ["kell-1", "kell-2"],
    );
    assert.equal(terv.covered, 1);
    assert.equal(terv.skippedNoNumber.length, 0);
  });

  /**
   * A SZAM NELKULI SOR KIHAGYASI OK, NEM HIBA -- de KULON all.
   *
   * Lap-szam nelkul a fajl `munkalap-piszkozat` nevet kapna, es a
   * `requireClosedSheetLabel` epp ezt akadalyozza meg. Ha ezt a sort a
   * "lefedett" koze szamolnank, a lefedettseg hazudna; ha a jeloltek koze,
   * minden futas ugyanazon a soron bukna el.
   */
  it("a szam nelkuli lezart verziot KIHAGYJA, es kulon szamolja", () => {
    const terv = planWorksheetSheetBackfill([
      sor({ versionId: "van-szama" }),
      sor({ versionId: "nincs-szama", worksheetNumber: null }),
    ]);

    assert.deepEqual(
      terv.candidates.map((x) => x.versionId),
      ["van-szama"],
    );
    assert.deepEqual(
      terv.skippedNoNumber.map((x) => x.versionId),
      ["nincs-szama"],
    );
    assert.equal(terv.covered, 0);
  });

  /**
   * A MAR LEFEDETT SOR AKKOR IS LEFEDETT, HA NINCS SZAMA. A sorrend szamit: ha
   * a szam-ellenorzes allna elol, egy lappal MAR rendelkezo sor a "szam
   * nelkul" listara kerulne, es a lefedettseg csokkenne egy MAR kesz sortol.
   */
  it("a lefedettseg elobbre valo a szam hianyanal", () => {
    const terv = planWorksheetSheetBackfill([
      sor({ hasSheet: true, worksheetNumber: null }),
    ]);
    assert.equal(terv.covered, 1);
    assert.equal(terv.skippedNoNumber.length, 0);
  });
});

describe("a lefedettsegi sor", () => {
  const kimenet = (...sorok: WorksheetSheetBackfillRow[]) =>
    describeWorksheetSheetCoverage(planWorksheetSheetBackfill(sorok));

  it("ures bemenetre nem allit lefedettseget", () => {
    assert.match(kimenet(), /nincs mit lefedni/);
  });

  it("a nevezo a LEZART verziok szama", () => {
    assert.match(
      kimenet(sor({ hasSheet: true }), sor({ versionId: "b" })),
      /lezart verzio: 2, ebbol kiadott lappal: 1 \(50%\), hianyzik: 1\. Szam nelkul: 0/,
    );
  });
});

/**
 * A VISSZAOLVASO A TISZTA MODULBAN AL, ES A BEMENETE A VALODI KIMENET.
 *
 * A `document-thumbnail-backfill` elso alakjaban a parser a spec belsejeben
 * volt, es csak a NEM-URES mondatot ismerte -- az alapvonal viszont epp URES
 * allapotban keszul. A hiba nem billego volt, hanem szerkezeti, es helyben nem
 * latszott, mert az a suite Postgres nelkul kihagyva fut.
 */
describe("a lefedettsegi sor visszaolvasasa", () => {
  const kimenet = (...sorok: WorksheetSheetBackfillRow[]) =>
    describeWorksheetSheetCoverage(planWorksheetSheetBackfill(sorok));

  it("az URES allapot sorat is olvassa", () => {
    assert.deepEqual(parseWorksheetSheetCoverage(kimenet()), {
      lezart: 0,
      lefedve: 0,
      hianyzik: 0,
      szamNelkul: 0,
    });
  });

  it("a teljes alakot mind a negy szammal olvassa", () => {
    assert.deepEqual(
      parseWorksheetSheetCoverage(
        kimenet(
          sor({ hasSheet: true }),
          sor({ versionId: "b" }),
          sor({ versionId: "c", worksheetNumber: null }),
        ),
      ),
      { lezart: 3, lefedve: 1, hianyzik: 1, szamNelkul: 1 },
    );
  });

  it("`null`-t ad, ha nincs lefedettsegi sor", () => {
    assert.equal(parseWorksheetSheetCoverage("nincs teendo.\n"), null);
  });
});
