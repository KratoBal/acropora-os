import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LEZARASKORI, VEGLEGES } from "./worksheet-sheet-backfill.cli.js";

/**
 * A LEFEDETTSEG ARRA A TIPUSRA KERDEZZEN, AMIT A PARANCS IRNA.
 *
 * === A MERT MECHANIZMUS (acrobot, 2026-09-21) ===
 *
 * A parancs `hasSheet` mezoje abbol szuletik, hany dokumentuma van a verzionak
 * EGY adott tipussal. Ha a lekerdezes MAS tipust nez, mint amit a parancs ir,
 * akkor a `hasSheet` SOHA nem lesz igaz a megirt sorra -- es minden futas
 * legyart meg egy lapot. Egyet. Csendben. Minden alkalommal.
 *
 * Ez nem elmeleti: pontosan ez az ok, amiert az "atminosites" alakot (a meglevo
 * sor tipusanak atirasa) ELVETETTUK. Ott a regi tipusu sor eltunik, tehat a
 * lefedettseg hamisra valt, es a kovetkezo futas ujra legyartja.
 */
describe("a visszamenoleges potlas ket modja", () => {
  it("MINDKET mod ugyanarra a tipusra ir es kerdez", () => {
    /*
      A PAROSITAS A LENYEG, nem a konkret ertek. Ezert all itt mind a ketto, es
      ezert allit a teszt a MEZOKRE, nem egy felsorolasra: egy uj mod magatol
      NEM kerul ide, de egy MEGLEVO elcsuszasa pirosra valt.
    */
    assert.equal(LEZARASKORI.type, "GENERATED_SHEET");
    assert.deepEqual(LEZARASKORI.where, { closedAt: { not: null } });

    assert.equal(VEGLEGES.type, "SIGNED_SHEET");
    assert.deepEqual(VEGLEGES.where, { status: "SIGNED" });
  });

  it("a ket mod NEM ugyanaz -- se tipusban, se szuroben", () => {
    /*
      Enelkul egy "masold at az egyiket a masikba" hiba zold maradna: a fenti
      allitas mind a kettot kulon nezi, de ket AZONOS mod is kielegitene, ha
      valaki mind a kettot ugyanarra irja at.
    */
    assert.notEqual(LEZARASKORI.type, VEGLEGES.type);
    assert.notDeepEqual(LEZARASKORI.where, VEGLEGES.where);
  });

  /**
   * ES A BEKOTES: A LEKERDEZES A MOD TIPUSAT HASZNALJA, NEM BEEGETETT ERTEKET.
   *
   * A `fetchRows` a prisma mogott ul, tehat egysegteszt nem futtathatja. A
   * FORRAST viszont olvashatja -- es a minta a HIVAS alakjara illeszt, nem egy
   * nevre: egy puszta nev az importbol is eletben maradna.
   */
  it("a lefedettseg-lekérdezés a mód típusát olvassa", () => {
    /*
      A UT A MUNKAKONYVTARHOZ KEPEST ALL, NEM `import.meta.url`-hez: a teszt a
      `test-dist` alol fut, ahol a `.ts` forras NINCS OTT. Ugyanez az alak all a
      szomszed `worksheet-generated-sheet-hely.spec.ts`-ben, es azert onnan
      masolva, mert az MAR bizonyitottan fut a CI-ben is.
    */
    const forras = readFileSync(
      "src/worksheets/worksheet-sheet-backfill.cli.ts",
      "utf8",
    );
    assert.match(forras, /documents: \{ where: \{ type: mod\.type \}/);
    /*
      ES A TILTO IRANY: ne alljon ott beegetett tipus a dokumentum-szuroben.
      A `mod.type` nelkul ez a ket allitas egyutt sem fogna meg azt, ha valaki
      VISSZAIR egy literalt -- az elso zold maradna, ha mind a ketto ott all.
    */
    assert.doesNotMatch(forras, /documents: \{ where: \{ type: "/);
  });
});
