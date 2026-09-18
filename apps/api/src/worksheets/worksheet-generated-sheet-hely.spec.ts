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

/**
 * A MEGOSZTOTT TIPUS UGYANAZT A HARMAT ISMERJE, MINT A SEMA.
 *
 * === A MERT HIBA (2026-09-18) ===
 *
 * A `packages/types` `WorksheetDocumentType` unioja eddig ezt sorolta:
 * `PHOTO | INVOICE | WARRANTY | MANUAL | OTHER`. Ebbol harom (`INVOICE`,
 * `WARRANTY`, `MANUAL`) az ESZKOZ-oldali halmaz (`AssetDocumentType`) erteke --
 * a munkalap enumja SOHA nem tartalmazta oket, tehat az adatbazis egyiket sem
 * tudja eloallitani. Kozben a valodi `GENERATED_SHEET` HIANYZOTT a listarol.
 *
 * A szerzodes tehat KET IRANYBA tevedett egyszerre: harom lehetetlen erteket
 * igert, es azt az egyet nem ismerte, amire a partner hivatkozni fog.
 *
 * === MIERT NEM VETTE ESZRE SEMMI ===
 *
 * A `type` mezot a felulet eddig csak TOVABBADTA, nem agaztatott rajta. Egy
 * unio, amin senki nem agaztat, barmit allithat: a fordito csak akkor szol,
 * amikor valaki eloszor ir ra `case`-t vagy osszehasonlitast.
 *
 * A fenti specek a SEMAT oriztek (a mezo elhagyhatosagat, az egyedi megkotest,
 * az uj enum-erteket) -- azt viszont EGYIK SEM, hogy a megosztott tipus
 * ugyanazt mondja. A ket oldal kozott nem allt semmi.
 */
describe("a megosztott típus és a séma enumja ugyanaz", () => {
  const TIPUS_FAJL = "../../packages/types/src/worksheet-management.ts";

  /** A Prisma enum ertekei, a sema szovegebol. */
  function semaErtekek(): string[] {
    const sema = olvas(SEMA);
    const blokk = /enum WorksheetDocumentType \{([\s\S]*?)\}/.exec(sema);
    if (!blokk) throw new Error("nincs WorksheetDocumentType enum a sémában");
    return [...(blokk[1] ?? "").matchAll(/^\s*([A-Z_]+)\s*$/gm)].map(
      (m) => m[1]!,
    );
  }

  /** A megosztott unio ertekei, a tipus-fajl szovegebol. */
  function tipusErtekek(): string[] {
    const forras = olvas(TIPUS_FAJL);
    const m = /export type WorksheetDocumentType =([^;]*);/.exec(forras);
    if (!m)
      throw new Error("nincs WorksheetDocumentType a megosztott típusban");
    return [...(m[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((t) => t[1]!);
  }

  it("POZITÍV KONTROLL: mind a két kiolvasás lát értékeket", () => {
    /*
      Ket URES halmaz barmikor egyezik. Az ISMERT ertek azert all itt, hogy a
      kiolvasas ne csak SZAMOLJON, hanem lasson is.
    */
    assert.ok(semaErtekek().length >= 3, semaErtekek().join(", "));
    assert.ok(tipusErtekek().length >= 3, tipusErtekek().join(", "));
    assert.ok(semaErtekek().includes("PHOTO"));
    assert.ok(tipusErtekek().includes("PHOTO"));
  });

  it("ugyanaz a HÁROM érték, egyik oldalon sem több", () => {
    /*
      MI PIROSIT, ES MIND A KET IRANY SZAMIT:

      - egy uj sema-ertek, ami nem kerul at a megosztott tipusba: a felulet nem
        tud ragaztatni, es a fordito csak az elso `case`-nel szol -- ugy, ahogy
        ma tortent;
      - egy megosztott ertek, ami a semaban nincs: a felulet olyan agat epithet,
        ami SOHA nem fut le, es az a leg csendesebb -- semmi nem hibazik, csak
        egy kepernyo-resz elerhetetlen.
    */
    assert.deepEqual(tipusErtekek().sort(), semaErtekek().sort());
  });
});
