import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  DOCUMENT_CAPTION_MAX_LENGTH,
  normalizeDocumentCaption,
} from "./document-caption.js";

describe("a csatolmany feliratanak szabalya", () => {
  /**
   * A HIANY EGYFELE ALAKBAN ALL. Harom bemenet, EGY kimenet -- es mind a harom
   * elofordul: a feltoltes nem kuldi a mezot, a szerkeszto kitorli a szoveget,
   * vagy szokozt hagy benne.
   */
  it("a hiány minden alakja null lesz", () => {
    assert.equal(normalizeDocumentCaption(undefined), null);
    assert.equal(normalizeDocumentCaption(null), null);
    assert.equal(normalizeDocumentCaption(""), null);
    assert.equal(normalizeDocumentCaption("   "), null);
  });

  /**
   * POZITIV KONTROLL: a valodi szoveg ATMEGY, csak a szeleirol tunik el a
   * szokoz. Enelkul a fenti allitas akkor is teljesulne, ha a fuggveny MINDENRE
   * `null`-t adna -- vagyis ha a felirat soha nem jutna el az adatbazisig.
   */
  it("a valódi szöveg átmegy, a széléről levágott szóközökkel", () => {
    assert.equal(
      normalizeDocumentCaption("  A hármas medence szivattyúja  "),
      "A hármas medence szivattyúja",
    );
    // A BELSO szokoz MARAD: az a szoveg resze.
    assert.equal(normalizeDocumentCaption("bal  jobb"), "bal  jobb");
  });

  /**
   * A HATAR A SEMABOL VAN MERVE, NEM EGY MASODIK LEIRT SZAMHOZ HASONLITVA.
   *
   * Egy `assert.equal(DOCUMENT_CAPTION_MAX_LENGTH, 500)` alak semmit nem
   * bizonyitana: ket literal egymas mellett akkor is egyezik, ha a SEMA kozben
   * elmozdult. Ezert a spec a sema FAJLJAT olvassa.
   *
   * MI PIROSIT: ha valaki az oszlop hosszat atirja a konstans nelkul (vagy
   * forditva). Akkor egy tul hosszu szoveg nem a validacion bukna el ertheto
   * uzenettel, hanem az adatbazison -- a hivo 500-at kapna arrol, hogy tul
   * hosszut irt.
   *
   * ES UGYANEZ AZ ALLITAS ORZI, HOGY A MEZO MIND A HAROM TABLAN OTT VAN.
   * A harom dokumentum-tabla alakja SZANDEKOSAN azonos; ha a felirat csak
   * kettore kerulne fel, a darabszam itt mondja meg.
   */
  it("a felső határ a séma oszlopaiból van mérve, mind a három táblán", () => {
    const sema = readFileSync(
      "../../packages/database/prisma/schema.prisma",
      "utf8",
    );
    // POZITIV KONTROLL A BEOLVASASRA: rossz utvonalnal az alabbi kereses nulla
    // talalata a fajl hianyarol szolna, nem a semarol.
    assert.ok(sema.length > 1000, "üres vagy gyanúsan rövid séma");

    const hosszak = [
      ...sema.matchAll(/^\s*caption\s+String\?\s+@db\.VarChar\((\d+)\)/gm),
    ].map((talalat) => Number(talalat[1]));

    assert.equal(
      hosszak.length,
      3,
      `Három caption oszlopot vártam (hibajegy, munkalap, eszköz), ennyit találtam: ${hosszak.length}.`,
    );
    for (const hossz of hosszak)
      assert.equal(hossz, DOCUMENT_CAPTION_MAX_LENGTH);
  });

  /**
   * A MIGRACIO ES A SEMA EGYUTT MOZOG -- ES EZ A RES KULONBEN NEMA VOLNA.
   *
   * A `schema.prisma` es a `migration.sql` KET KULON fajl, es SEMMI nem veti
   * ossze oket a kapukban: a CI a migraciot lefuttatja (tehat az ervenyes SQL),
   * a `prisma generate` a semabol dolgozik (tehat a kliens tud a mezorol) -- de
   * ha a ketto MAST mond a hosszrol vagy a nullazhatosagrol, mindket kapu
   * zolden atengedi. A kulonbseg elesben derulne ki, az elso 401 karakteres
   * feliratnal.
   *
   * MI PIROSIT: barmelyik oldal elmozditasa a masik nelkul.
   */
  it("a migráció ugyanazt mondja mind a három táblára, mint a séma", () => {
    const migracio = readFileSync(
      join(
        "..",
        "..",
        "packages",
        "database",
        "prisma",
        "migrations",
        "20260917103000_document_caption",
        "migration.sql",
      ),
      "utf8",
    );

    const sorok = [
      ...migracio.matchAll(
        /ALTER TABLE "(\w+)" ADD COLUMN "caption" VARCHAR\((\d+)\)([^;]*);/g,
      ),
    ];

    assert.deepEqual(
      sorok.map((talalat) => talalat[1]).sort(),
      ["AssetDocument", "ServiceJobDocument", "WorksheetDocument"],
      "a migráció nem mind a három dokumentum-táblát érinti",
    );

    for (const talalat of sorok) {
      assert.equal(Number(talalat[2]), DOCUMENT_CAPTION_MAX_LENGTH);
      /**
       * A NULLAZHATOSAG IS ALLITAS, NEM FELTETELEZES. A tablakban MAR ALLNAK
       * sorok: egy `NOT NULL` oszlop alapertelmezes nelkul elhasalna rajtuk, egy
       * alapertelmezessel pedig egy KITALALT szoveget irna rajuk -- ami azt
       * allitana, hogy valaki leirta.
       */
      assert.doesNotMatch(talalat[3] ?? "", /NOT NULL/);
      assert.doesNotMatch(talalat[3] ?? "", /DEFAULT/);
    }
  });
});
