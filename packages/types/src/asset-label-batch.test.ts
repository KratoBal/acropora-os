import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASSET_LABEL_CODE_STORED_PATTERN } from "./asset-label.js";
import { assetLabelCsv, randomAssetLabelCode } from "./asset-label-batch.js";

describe("matricakód generálása", () => {
  it("a kártyán álló alakot adja: egy betű és négy szám", () => {
    for (let i = 0; i < 200; i += 1) {
      assert.match(randomAssetLabelCode(), ASSET_LABEL_CODE_STORED_PATTERN);
    }
  });

  /**
   * A HATAROKON MULIK, NEM A KOZEPEN. Egy `Math.random`-ra epulo generator a
   * VELETLEN eseteiben szinte mindig helyeset ad; ami elromlik, az a ket
   * szelso ertek. Ezert a veletlent itt KIVALTJUK, es a ket szelet mérjuk.
   */
  it("a legkisebb és a legnagyobb véletlen értéken is jó alakot ad", () => {
    assert.equal(
      randomAssetLabelCode(() => 0),
      "A0000",
    );
    // A `Math.random` sosem ad pontosan 1-et, de a 0.999... eset a felso
    // hatar: itt derulne ki egy indexeles-hiba (Z helyett `undefined`) es a
    // negy szamjegy csonkulasa.
    assert.equal(
      randomAssetLabelCode(() => 0.9999999),
      "Z9999",
    );
  });

  it("a négy számjegy mindig kitöltött, vezető nullákkal", () => {
    // MI PIROSIT: ha valaki elhagyja a `padStart` hivast. A `7` es a `0007`
    // KET KULONBOZO kod a tablan, es a rovid alak a CHECK megkotesen hasalna
    // el -- a felhasznalonak, mentes kozben.
    assert.equal(
      randomAssetLabelCode(() => 0.0000001),
      "A0000",
    );
  });
});

/**
 * A CSV ALAKJA A MAR HASZNALT IVBOL JON, NEM TALALGATASBOL.
 *
 * A referencia: `exchange/qr-kodok-2026-09-02/qr-kodok-proba-10-rovid.csv`,
 * 146 bajt, 11 sor. Lemerve: BOM `ef bb bf`, fejlec `kod;felirat`, CRLF.
 */
describe("a nyomtatható lista alakja", () => {
  const csv = assetLabelCsv(["V2196", "W2735"]);

  it("BOM-mal kezdődik", () => {
    // MI PIROSIT: ha valaki "feleslegesnek" itéli. Az Excel enelkul az
    // ekezetes szoveget elrontja -- es a hiba a NYOMTATASNAL derul ki.
    assert.equal(csv.codePointAt(0), 0xfeff);
  });

  it("CRLF sorvégeket használ, nem LF-et", () => {
    assert.ok(csv.includes("\r\n"));
    assert.equal(csv.replace(/\r\n/g, "").includes("\n"), false);
  });

  it("pontosvesszővel választ oszlopot, nem vesszővel", () => {
    // Magyar Excelben a vesszo NEM oszlopvalaszto: az egesz sor egy cellaba
    // kerulne, es a nyomtatas hasznalhatatlan lenne.
    assert.ok(csv.includes("V2196;V2196"));
    assert.equal(csv.includes("V2196,V2196"), false);
  });

  it("a fejléc és a két oszlop a mért fájl szerinti", () => {
    const sorok = csv.replace("﻿", "").trimEnd().split("\r\n");
    assert.deepEqual(sorok, ["kod;felirat", "V2196;V2196", "W2735;W2735"]);
  });

  /**
   * A REFERENCIA MAGA, NEM AZ ARROL SZOLO ALLITASAIM.
   *
   * A fenti negy allitas a formatum TULAJDONSAGAIT meri (BOM, CRLF,
   * pontosvesszo, fejlec). Mindegyik teljesulhetne ugy is, hogy a fajl megis
   * mas -- peldaul ha egy zaro sorvege lemaradna, vagy egy extra ures sor
   * kerulne a vegere.
   *
   * Ez a sor a MAR KIKULDOTT iv tiz kodjara a TELJES kimenetet allitja. A
   * fuggveny kimenetét bajtra osszevetettem a lemezen allo eredetivel
   * (`exchange/qr-kodok-2026-09-02/qr-kodok-proba-10-rovid.csv`, 146 bajt):
   * AZONOS. Az alabbi sztring ugyanaz, csak a repoban is olvashatoan.
   */
  it("a már kiküldött ív tíz kódjára betűre ugyanazt adja", () => {
    const kodok = [
      "V2196",
      "W2735",
      "L0616",
      "N1373",
      "J3290",
      "M9925",
      "E3603",
      "D1684",
      "J3049",
      "K0996",
    ];
    const vart =
      "\uFEFFkod;felirat\r\n" +
      kodok.map((k) => `${k};${k}`).join("\r\n") +
      "\r\n";
    assert.equal(assetLabelCsv(kodok), vart);
    // A BAJTHOSSZ IS ALLITAS: a mert eredeti 146 bajt. Egy elszabadult zaro
    // sorvege vagy egy hianyzo BOM ezen azonnal latszik, a szoveg-egyezes
    // mellett is.
    assert.equal(Buffer.byteLength(assetLabelCsv(kodok), "utf8"), 146);
  });

  it("üres listára is ad fejlécet", () => {
    // ISMERT POZITIV KONTROLL A FENTIEKHEZ: ha a fuggveny ures sztringet adna
    // vissza valamiert, a `includes` alapu allitasok pirosodnanak -- de a
    // `nem tartalmaz vesszot` allitas ZOLD maradna. Ez a sor azt zarja ki.
    const ures = assetLabelCsv([]);
    assert.equal(ures, "﻿kod;felirat\r\n");
  });
});
