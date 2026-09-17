import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A BEOLVASO KÉT AZONOSÍTÓT ISMER, ÉS A SORREND SZÁMÍT.
 *
 * === A MÉRT HIBA, 2026-09-17 ===
 *
 * Az eszköz-beolvasó CSAK a `qrToken`-t ismerte, tehát egy előre nyomtatott
 * matricával nem lehetett megtalálni a gépet, amire fel van ragasztva. A
 * szerveren a visszakereső végpont 2026-09-02 óta állt; a telefon soha nem
 * hívta. Nem hiányzó képesség volt, hanem be nem kötött.
 *
 * === AZ UTAK A CSOMAG GYÖKERÉHEZ KÉPEST ÁLLNAK ===
 *
 * Ugyanúgy, mint a `label-code-field.spec.ts`-ben: a teszt a `test-dist` alól
 * fut, tehát a fájl SAJÁT helye nem használható horgonyként.
 */
const BEOLVASO = "src/app/assets/scanner.tsx";
const FELOLDO = "src/app/assets/scan/[token].tsx";
const KLIENS = "src/lib/api/assets.ts";

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("a beolvasó a matricát is ismeri", () => {
  /**
   * POZITÍV KONTROLL A BEOLVASÁSRA. Rossz útvonalnál az alábbi állítások ÜRES
   * szövegen futnának -- és a `doesNotMatch` alakúak ZÖLDEN mondanák, hogy
   * minden rendben.
   */
  it("POZITÍV KONTROLL: mind a három fájl olvasható és nem üres", () => {
    for (const ut of [BEOLVASO, FELOLDO, KLIENS])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy gyanúsan rövid`);
  });

  it("a kliens hívja a matricás végpontot", () => {
    // AZ UTVONAL-EPITES ALAKJARA: a puszta nev a fejlec-kommentben is allhat.
    assert.match(olvas(KLIENS), /\$\{BASE\}\/scan-label\//);
  });

  it("a beolvasó a közös kinyerőt használja, nem saját mintát", () => {
    // A HIVAS ALAKJARA, nem a nevre: az import-sor kulonben zolden tartana.
    // A HIVAS ALAKJARA, ES A VALTOZOVAL EGYUTT: a puszta nevet az `import`
    // sor is eletben tartja.
    assert.match(
      olvas(BEOLVASO),
      /const cimke = extractAssetLabelCode\(data\);/,
    );
  });

  /**
   * ELŐSZÖR A QR-KÓD, ÉS CSAK UTÁNA A MATRICA -- EZ NEM ÍZLÉS.
   *
   * Egy uuid hexadecimális, tehát tartalmazhat `a1234` alakú részletet.
   * Fordított sorrendben egy ÉRVÉNYES QR-kódból csendben matricakódot
   * nyernénk ki, és MÁSIK eszközt nyitnánk meg -- a szerelő pedig egy idegen
   * gép adatlapját nézné, hibaüzenet nélkül.
   */
  it("a QR-kód ELŐBB dől el, mint a matrica", () => {
    const s = olvas(BEOLVASO);
    const qr = s.indexOf("qrToken(data)");
    const cimke = s.indexOf("extractAssetLabelCode(data)");
    assert.ok(qr !== -1, "nem találom a qrToken hívást");
    assert.ok(cimke !== -1, "nem találom a matrica-kinyerést");
    assert.ok(
      qr < cimke,
      "a matrica-kinyerés a qrToken ELÉ került: egy érvényes QR-kódból csendben másik eszközt nyitnánk meg",
    );
  });

  /**
   * A HIBAÜZENET MEGMONDJA, MIT OLVASOTT. Ez az egész kör kiváltó oka: a régi
   * mondat („ez nem Acropora OS eszközazonosító") a KÉRDÉSRŐL szólt, nem a
   * matricáról -- és emiatt kellett a gazdának lefényképeznie a matricát ahhoz,
   * hogy megtudjuk, mi áll rajta.
   */
  it("az elutasítás kiírja, mit olvasott", () => {
    /**
     * A HÍVÁS ALAKJÁRA ÁLL, NEM A PUSZTA NÉVRE -- és ez mérésből jön.
     * Az első alakja a `describeLabelScanFailure` névre illeszkedett, és a
     * kalibráció NULLA pirosat adott, amikor a hívást visszacseréltem a régi
     * néma mondatra: az IMPORT-sor ott maradt, tehát a név megvolt. Az az
     * állítás a saját import-listám létezését mérte.
     */
    assert.match(olvas(BEOLVASO), /describeLabelScanFailure\(data, cimke\)/);
  });

  /**
   * A KÉZI BEVITEL NEM KENYELMI FUNKCIÓ. Ha a kamera nem lát rá a matricára egy
   * gépházban, ez az EGYETLEN út -- és egy mező, ami csak hiba UTÁN jelenik
   * meg, akkor kerül elő, amikor a szerelő már feladta.
   */
  it("a kézi mező mindig ott áll, nem csak bukás után", () => {
    const s = olvas(BEOLVASO);
    assert.match(s, /<TextInput/);
    assert.doesNotMatch(
      s,
      /\{scanned \? \([\s\S]{0,200}<TextInput/,
      "a kézi mező a bukás mögé került: akkor jelenne meg, amikor már késő",
    );
  });

  /**
   * A KÉT ÚT KÉT VÉGPONTRA MEGY, és a feloldó képernyő NEM dönti el újra,
   * melyik az: a beolvasó már eldöntötte. Ha itt is döntenénk, a két hely külön
   * csúszhatna el, és a másodikat semmi nem mérné.
   */
  it("a feloldó a kapott fajta szerint hívja a két végpontot", () => {
    const s = olvas(FELOLDO);
    // HIVAS-ALAKOK, nem nevek: a kozos import-sor mind a kettot tartalmazza.
    assert.match(s, /scanAssetByLabel\(token!\)/);
    assert.match(s, /scanAsset\(token!\)/);
    assert.doesNotMatch(
      s,
      /extractAssetLabelCode/,
      "a feloldó ÚJRA eldönti, melyik azonosítót kapta: két hely, ami külön csúszhat el",
    );
  });
});
