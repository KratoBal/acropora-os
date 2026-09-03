import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A MIGRACIO NEM NYULHAT A MEGLEVO ESZKOZ-DOKUMENTUMOKHOZ.
 *
 * Kikotes (acrobot, 11553): ha a migracio barmit hozzanyul az `AssetDocument`
 * tablahoz, azt KULON kell kimondani, es kalibracio kell ra. Ez az allitas
 * annyit mond, hogy NEM nyul hozza -- es ha egyszer megis kell, ez a sor
 * pirosra valt, tehat a valtozas DONTES lesz, nem mellekhatas.
 */

/**
 * AZ UT A CSOMAG GYOKEREHEZ KEPEST all, nem `__dirname`-hez: a teszt ES modulba
 * fordul, ahol az nem letezik. A repo mas fajlolvaso specjei is igy csinaljak
 * (lasd `content/content-filter.spec.ts`), es a teszt-parancs az `apps/api`
 * konyvtarbol fut.
 */
const MIGRACIO = join(
  "..",
  "..",
  "packages",
  "database",
  "prisma",
  "migrations",
  "20260903173000_worksheet_documents",
  "migration.sql",
);

function olvas(): string {
  try {
    return readFileSync(MIGRACIO, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${MIGRACIO}. Ez a KERESES hibaja, nem a lefedettsege -- a lenti allitasok addig semmit nem mondanak.`,
    );
  }
}

const sql = olvas();

describe("a munkalap-dokumentum migracioja", () => {
  it("a fájl betöltődött, és a MI migrációnk", () => {
    // ISMERT POZITIV KONTROLL: egy ures fajl minden lenti allitast teljesitene.
    assert.match(sql, /CREATE TABLE "WorksheetDocument"/);
  });

  it("NEM MODOSITJA az AssetDocument tablat", () => {
    /*
      A KERESES A MUVELETRE MEGY, NEM A NEVRE: a fajl KOMMENTJE emliti az
      AssetDocument tablat (epp azert, hogy a kovetkezo olvaso lassa, mihez
      keszult a minta), tehat egy puszta nev-kereses a sajat indoklasunkon
      bukna el. Ugyanaz a csapda, mint amit ma delelott a sor-takaritasnal
      talaltunk.
    */
    assert.doesNotMatch(sql, /ALTER TABLE "AssetDocument"/);
    assert.doesNotMatch(sql, /DROP [A-Z ]*"AssetDocument"/);
    assert.doesNotMatch(sql, /UPDATE "AssetDocument"/);
  });

  it("a tartalom VAGY a kulcs megkötése a TÁBLÁN áll", () => {
    /*
      MI PIROSIT: ha a CHECK kimaradna. Egy hattermunka, egy kesobbi vegpont
      vagy egy masik migracio nem orokli az alkalmazas ellenorzeseit -- a tabla
      megkoteset viszont igen. Enelkul letrejohetne olyan sor, aminek SEM
      tartalma, sem kulcsa nincs: a felhasznalo latna a listaban, es a letoltes
      adna hibat.
    */
    assert.match(sql, /WorksheetDocument_content_or_storage_key/);
    assert.match(
      sql,
      /CHECK \(\("content" IS NULL\) <> \("storageKey" IS NULL\)\)/,
    );
  });
});
