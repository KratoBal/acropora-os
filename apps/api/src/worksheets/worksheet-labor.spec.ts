import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  computeWorksheetLineLaborHours,
  sumWorksheetLaborHours,
  type WorksheetLaborInput,
} from "./worksheet-labor.js";

function tetel(
  reszlet: Partial<WorksheetLaborInput> = {},
): WorksheetLaborInput {
  return { kind: "LABOR", quantity: "1", workerCount: 1, ...reszlet };
}

describe("munkaóra egy tételen", () => {
  /**
   * BALÁZS SAJÁT PÉLDÁJA, ÉS EZ A MÉRCE (2026-09-17, szó szerint):
   * "ha egy tétel 0.5 óra de ketten dolgoztak rajta akkor az 1 óra".
   */
  it("fél óra két emberrel egy óra", () => {
    const ora = computeWorksheetLineLaborHours(
      tetel({ quantity: "0.5", workerCount: 2 }),
    );
    assert.equal(ora.toString(), "1");
  });

  /**
   * A SZŰKÍTÉS, NÉV SZERINT. Enélkül az összegzés MINDEN tételt beleszámolna --
   * egy háromdarabos szűrő-csere három "munkaórát" adna.
   *
   * Ez az az állítás, amit a kalibrációs rontásnak el kell sütnie: ha a
   * `kind` vizsgálata kikerül, EZ pirosodik, és csak ez.
   */
  it("a nem-munka tétel NULLA munkaórát ad, akármennyi a mennyisége", () => {
    const ora = computeWorksheetLineLaborHours(
      tetel({ kind: "OTHER", quantity: "3", workerCount: 2 }),
    );
    assert.equal(ora.toString(), "0");
  });

  /**
   * A DÖNTÉS, KIMONDVA: egy értelmetlen létszám EGYNEK számít, nem nullának.
   *
   * A nulla azt jelentené, hogy a tétel némán kiesik az összegből; az egy
   * viszont a legkisebb értelmes létszám, és a tétel LÁTHATÓ marad. A séma
   * `Int @default(1)`, a DTO `@Min(1)`, tehát ide csak kézzel írt vagy régi
   * adaton át juthat ilyen érték.
   */
  it("a nulla vagy negatív létszám egynek számít, nem nullának", () => {
    assert.equal(
      computeWorksheetLineLaborHours(
        tetel({ quantity: "2", workerCount: 0 }),
      ).toString(),
      "2",
    );
    assert.equal(
      computeWorksheetLineLaborHours(
        tetel({ quantity: "2", workerCount: -3 }),
      ).toString(),
      "2",
    );
  });

  it("a töredék létszámot lefelé csonkolja, de egy alá nem megy", () => {
    assert.equal(
      computeWorksheetLineLaborHours(
        tetel({ quantity: "2", workerCount: 2.9 }),
      ).toString(),
      "4",
    );
  });
});

describe("a lap összesített munkaórája", () => {
  /**
   * BALÁZS MÁSODIK PÉLDÁJA: "ha három ilyen tétel van akkor összesen 3 óra".
   */
  it("három darab fél órás, két emberes tétel összesen három óra", () => {
    const osszes = sumWorksheetLaborHours([
      tetel({ quantity: "0.5", workerCount: 2 }),
      tetel({ quantity: "0.5", workerCount: 2 }),
      tetel({ quantity: "0.5", workerCount: 2 }),
    ]);
    assert.equal(osszes.toString(), "3");
  });

  /**
   * A MÁSODIK SZŰKÍTÉS, ÉS KÜLÖN TESZTBEN: az összegzés akkor is helyes, ha
   * nem-munka tételek állnak KÖZÖTTE. Ha ez egy tesztben állna a fentivel, egy
   * rontás mindkettőt elvinné, és nem tudnánk, melyik fogott.
   */
  it("a nem-munka tételek nem növelik az összeget", () => {
    const osszes = sumWorksheetLaborHours([
      tetel({ quantity: "0.5", workerCount: 2 }),
      tetel({ kind: "OTHER", quantity: "10", workerCount: 5 }),
      tetel({ quantity: "0.5", workerCount: 2 }),
    ]);
    // Ket LABOR tetel, egyenkent 0,5 * 2 = 1 ora, tehat 2 -- a kozottuk allo
    // tiz egysegnyi, ot emberes OTHER tetel semmit nem ad hozza.
    assert.equal(osszes.toString(), "2");
  });

  it("üres lapon nulla, és Decimal, nem szám", () => {
    const osszes = sumWorksheetLaborHours([]);
    assert.equal(osszes.toString(), "0");
    assert.ok(osszes instanceof Prisma.Decimal);
  });

  /**
   * A SOROK KEREKÍTETT ÉRTÉKEIBŐL ÖSSZEGZÜNK, nem a nyers szorzatokból --
   * ugyanaz a döntés, mint a pénz-összegeknél. Fordítva a lapon felsorolt
   * tételek nem adnák ki a végösszeget.
   */
  it("a hat tizedesnél hosszabb szorzat soronként kerekedik", () => {
    const osszes = sumWorksheetLaborHours([
      tetel({ quantity: "0.0000005", workerCount: 1 }),
      tetel({ quantity: "0.0000005", workerCount: 1 }),
    ]);
    assert.equal(osszes.toString(), "0.000002");
  });
});
