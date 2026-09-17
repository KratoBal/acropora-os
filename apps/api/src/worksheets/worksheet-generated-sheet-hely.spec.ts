import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A LEZARASKOR GENERALT MUNKALAP HELYE: verzio-kotes, egyediseg, kulon tipus.
 *
 * === MIT MER EZ, ES MIT NEM ===
 *
 * A LAP TARTALMAT NEM meri: az Balazs valaszara var (melyik mezo szol a vevonek).
 * Ez a keszlet kizarolag azt allitja, hogy a fajlnak VAN hova kerulnie, es hogy
 * egy verziohoz EGY hiteles lap tartozhat.
 *
 * === MIERT A SEMA ES A MIGRACIO EGYUTT ===
 *
 * A ketto KET KULON allitas ugyanarrol, es kulon-kulon egyik sem eleg: a sema
 * azt mondja meg, mit hisz a kliens, a migracio azt, mi all az adatbazisban. Ha
 * elcsusznak, a kod forditasi hiba nelkul kerne olyan oszlopot, ami nincs.
 * Ugyanez a szerkezet all a szomszed `document-caption.spec.ts`-ben.
 */

const SEMA = "../../packages/database/prisma/schema.prisma";
const MIGRACIO =
  "../../packages/database/prisma/migrations/20260917230000_worksheet_generated_sheet_document/migration.sql";

function olvas(ut: string): string {
  return readFileSync(ut, "utf8");
}

describe("a generalt munkalap helye a semaban", () => {
  it("a verzio-kotes ELHAGYHATO, nem kötelező", () => {
    const sema = olvas(SEMA);
    // POZITIV KONTROLL A BEOLVASASRA: rossz utvonalnal a lenti nulla talalat a
    // fajl hianyarol szolna, nem a semarol.
    assert.ok(sema.length > 1000, "üres vagy gyanúsan rövid séma");

    /*
      AZ ELHAGYHATOSAG NEM RESZLETKERDES. A `WorksheetDocument` sorai ma
      FENYKEPEK es feltoltott csatolmanyok, amik NEM egy verziohoz tartoznak. Egy
      kotelezo oszlop mindet ervenytelenne tenne -- es a migracio nem is futna le
      egy nem ures adatbazison.
    */
    assert.match(sema, /^\s*worksheetVersionId String\?$/m);
  });

  it("egy verzióhoz és típushoz EGY sor tartozhat", () => {
    /*
      MI PIROSIT: a megkotes elhagyasa. Enelkul az "egy verziohoz egy hiteles
      lap" SZOKAS lenne, amit egy masodik iras csendben megtor -- es utana ket
      sor allitana magat hitelesnek ugyanarra a verziora.
    */
    assert.match(olvas(SEMA), /@@unique\(\[worksheetVersionId, type\]\)/);
  });

  it("a generált lap KÜLÖN típus, nem `OTHER`", () => {
    /*
      MI PIROSIT: ha az uj ertek kikerul az enumbol. Az `OTHER` alatt ma kezzel
      feltoltott fajlok allnak; oda keverve a generalt lap
      MEGKULONBOZTETHETETLEN lenne egy feltoltott PDF-tol, es a hitelesnek
      nevezett sorra barki irhatna.
    */
    const sema = olvas(SEMA);
    const enumBlokk = /enum WorksheetDocumentType \{([\s\S]*?)\}/.exec(sema);
    if (!enumBlokk)
      throw new Error("nincs WorksheetDocumentType enum a sémában");
    assert.match(enumBlokk[1] ?? "", /\bGENERATED_SHEET\b/);

    // ISMERT POZITIV KONTROLL: a regi ket ertek ERINTETLEN. Enelkul ez az
    // allitas egy kicserelt enum mellett is zold lenne.
    assert.match(enumBlokk[1] ?? "", /\bPHOTO\b/);
    assert.match(enumBlokk[1] ?? "", /\bOTHER\b/);
  });
});

describe("es a migracio ugyanazt mondja", () => {
  it("az oszlop NULLÁZHATÓ, és nincs se NOT NULL, se DEFAULT", () => {
    const sql = olvas(MIGRACIO);
    assert.ok(sql.length > 500, "üres vagy gyanúsan rövid migráció");

    const sor = /ADD COLUMN "worksheetVersionId"([^;]*);/.exec(sql);
    if (!sor)
      throw new Error(
        "a migráció nem adja hozzá a worksheetVersionId oszlopot",
      );
    assert.doesNotMatch(sor[1] ?? "", /NOT NULL/);
    assert.doesNotMatch(sor[1] ?? "", /DEFAULT/);
  });

  it("az egyedi index és a külső kulcs is benne van", () => {
    const sql = olvas(MIGRACIO);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX[\s\S]{0,200}"worksheetVersionId", "type"/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("worksheetVersionId"\)[\s\S]{0,120}ON DELETE CASCADE/,
    );
  });

  it("az enum-bővítés NEM használja fel az új értéket ugyanabban a migrációban", () => {
    /*
      A repo sajat jegyzete mondja ki (20260727120000_m8_2...): az
      `ALTER TYPE ... ADD VALUE` Postgresben csak akkor futtathato biztonsagosan
      ugyanabban a tranzakcioban, amelyik hozzaadja, ha a migracio az uj erteket
      NEM hasznalja fel DML-ben is.

      MI PIROSIT: egy `UPDATE ... SET type = 'GENERATED_SHEET'` alaku sor
      ugyanebben a fajlban. Az eles migracio ott hasalna el, nem itt.
    */
    const sql = olvas(MIGRACIO).replace(/--[^\n]*/g, "");
    assert.match(sql, /ADD VALUE 'GENERATED_SHEET'/);
    assert.doesNotMatch(sql, /(UPDATE|INSERT)[\s\S]*GENERATED_SHEET/);
  });
});
