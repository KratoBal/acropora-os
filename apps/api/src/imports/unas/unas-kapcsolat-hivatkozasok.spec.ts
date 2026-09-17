import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  KAPCSOLAT_MEZOK,
  kapcsolatHivatkozasok,
} from "./unas-kapcsolat-hivatkozasok.js";

/**
 * A TAROLT PILLANATKEPBOL UGYANAZOKAT A HIVATKOZASOKAT OLVASSUK KI, MINT A
 * SZINKRON A HALOZATROL.
 *
 * Ez az olvaso a kapcsolat-ujraepites bemenete: a rebuildhez NEM kell egyetlen
 * UNAS-hivas sem, mert a `UnasProductSnapshot.rawPayload` a teljes fat megtartja.
 */
describe("kapcsolatHivatkozasok", () => {
  /**
   * EZ A LEGFONTOSABB ESET, ES A LEGGYAKORIBB: EGY GYEREK.
   *
   * A `nodePayload` egyetlen gyerek eseten OBJEKTUMOT ad, nem egyelemu tombot.
   * Egy csak tombre iro olvaso itt CSENDBEN nullat adna -- es a legtobb termek
   * pontosan egy-ket kapcsolatot visel.
   */
  it("egyetlen hivatkozás objektumként is megjön", () => {
    const olvasas = kapcsolatHivatkozasok(
      {
        SimilarProducts: {
          SimilarProduct: { Id: "910002", Sku: "TARGET", Name: "Cél" },
        },
      },
      "SIMILAR",
    );
    assert.deepEqual(olvasas.hivatkozasok, [
      { externalId: "910002", sku: "TARGET", name: "Cél" },
    ]);
    assert.equal(olvasas.azonositoNelkul, 0);
  });

  it("több hivatkozás tömbként jön, sorrendben", () => {
    const olvasas = kapcsolatHivatkozasok(
      {
        SimilarProducts: {
          SimilarProduct: [
            { Id: "1", Sku: "A" },
            { Id: "2", Sku: "B" },
          ],
        },
      },
      "SIMILAR",
    );
    assert.deepEqual(
      olvasas.hivatkozasok.map((h) => h.externalId),
      ["1", "2"],
    );
  });

  /**
   * A KIEGESZITO MEZO NEVE NEM "Accessory" -- ES EZ A MERT CSAPDA.
   *
   * Az export `AdditionalProducts` neven adja. Aki a kanonikus nevunkre keres a
   * forrasban, NULLAT kap -- es a nulla itt a KERDES tulajdonsaga lenne, nem a
   * vilage.
   */
  it("a kiegészítő ág a forrás saját nevét olvassa", () => {
    const payload = {
      AdditionalProducts: {
        AdditionalProduct: { Id: "910102", Sku: "ACC" },
      },
    };
    assert.equal(
      kapcsolatHivatkozasok(payload, "ACCESSORY").hivatkozasok.length,
      1,
    );
    // ES A MASIK AG NEM LATJA: enelkul az allitas akkor is zold lenne, ha az
    // olvaso MINDEN mezot osszeszedne, fajtatol fuggetlenul.
    assert.equal(
      kapcsolatHivatkozasok(payload, "SIMILAR").hivatkozasok.length,
      0,
    );
  });

  it("az azonosító nélküli hivatkozás kimarad, de megszámolódik", () => {
    const olvasas = kapcsolatHivatkozasok(
      {
        SimilarProducts: {
          SimilarProduct: [{ Sku: "NINCS-ID" }, { Id: "2", Sku: "VAN" }],
        },
      },
      "SIMILAR",
    );
    assert.deepEqual(
      olvasas.hivatkozasok.map((h) => h.externalId),
      ["2"],
    );
    assert.equal(olvasas.azonositoNelkul, 1);
  });

  it("a hiányzó mező üres lista, nem hiba", () => {
    for (const payload of [{}, { SimilarProducts: "" }, null, "szöveg"])
      assert.deepEqual(kapcsolatHivatkozasok(payload, "SIMILAR"), {
        hivatkozasok: [],
        azonositoNelkul: 0,
      });
  });

  /**
   * A NEV HIANYA `null`, NEM URES SZTRING.
   *
   * A szinkron ugyanezt az alakot hasznalja, es a ketto MAST allit: az ures
   * sztring azt mondja, hogy a nev ISMERT es ures.
   */
  it("a hiányzó név null", () => {
    const olvasas = kapcsolatHivatkozasok(
      { SimilarProducts: { SimilarProduct: { Id: "1", Sku: "A" } } },
      "SIMILAR",
    );
    assert.equal(olvasas.hivatkozasok[0]!.name, null);
  });

  /**
   * ES A MEZONEVEK UGYANAZOK, AMIKET A KLIENS HASZNAL.
   *
   * A ket olvaso MAS bemenetbol dolgozik (XML-fa kontra tarolt JSON), tehat a
   * KOD nem lehet kozos. A SZABALY viszont igen, es ez az allitas az egyetlen,
   * ami a kettot egyben tartja: ha valaki a kliensben atirja a mezonevet, ez
   * pirosodik.
   *
   * A KOMMENTEKET KISZEDJUK: a kliens fejlece maga is IDEZI ezeket a neveket
   * (epp azt magyarazza el, hogy a forras nem "Accessory"-t mond), tehat egy
   * nyers szoveg-kereses akkor is talalna, ha a KOD mar mast hasznalna.
   */
  it("a mezőnevek egyeznek a kliens kiolvasásával", () => {
    const kod = readFileSync("src/imports/unas/unas-api.client.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // POZITIV KONTROLL: rossz utvonalnal vagy elrontott kiszedesnel a lenti
    // allitasok egy URES szovegen futnanak -- zolden.
    assert.ok(kod.length > 5000, "a kliens forrása üres vagy gyanúsan rövid");

    for (const { szulo, elem } of Object.values(KAPCSOLAT_MEZOK)) {
      assert.ok(
        kod.includes(`"${szulo}"`),
        `a kliens nem a(z) "${szulo}" mezőt olvassa`,
      );
      assert.ok(
        kod.includes(`"${elem}"`),
        `a kliens nem a(z) "${elem}" elemet olvassa`,
      );
    }
  });
});
