import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A MATRICAKOD MEZOJE ES BEOLVASOJA EGY PELDANYBAN ALL, ES MINDKET URLAP ONNAN VESZI.
 *
 * === A KERES ===
 *
 * Balazs 2026-09-16 10:41-kor kerte, hogy a matricakod MEGLEVO eszkozre is
 * felvihetó legyen, egy perccel kesobb pedig a beolvasast is ("vayg befotozni").
 * A mezo, a beolvaso gomb, a kamera-engedely kezelese es a ratet addig CSAK a
 * felviteli kepernyon letezett.
 *
 * === MIERT MERI EZ A SPEC MIND A KET OLDALT ===
 *
 * Mert a szomszed eset pontosan ezen bukott el. A `new-asset-form.spec.ts`
 * tiltasa ("ne listazza ki egyszerre az osszes szintet") KET HETIG zold volt,
 * mikozben a szerkeszto kepernyo pontosan azt csinalta -- az allitas a FAJL
 * NEVERE volt kotve, nem a VISELKEDESRE (#714, 2026-09-16).
 *
 * Ezert itt minden tiltas MIND A KET kepernyore fut, es a kereses melle
 * POZITIV KONTROLL jar: ha a minta nem talalja meg azt, amirol tudjuk, hogy
 * ott van, akkor nem a kepernyo tiszta, hanem a keresesunk vak.
 *
 * === MIERT FORRAS-SZOVEG ===
 *
 * A mobil tesztsorban nincs kepernyo-renderelo, tehat minden allitas tiszta
 * fuggvenyen vagy forrason all. A hatara ugyanaz, mint a tobbi ilyen spece: azt
 * allitja, hogy a SZERKEZET ott van, nem azt, hogy jol nez ki. A VISELKEDEST
 * (mit kuld fel a mentes) az `asset-edit.spec.ts` meri, tiszta fuggvenyen.
 */

const MEZO = "src/components/assets/label-code-field.tsx";
const FELVITEL = "src/app/assets/new.tsx";
const SZERKESZTO = "src/app/assets/edit/[id].tsx";
const KEPERNYOK = [FELVITEL, SZERKESZTO] as const;

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("a matricakód mezője és beolvasója egy példányban", () => {
  it("megtalálja a három fájlt, amiről állít valamit", () => {
    // A KONTROLL A KERESESRE. Enelkul minden alabbi allitas ures szovegen menne
    // vegig, es zolden mondana, hogy minden rendben.
    for (const ut of [MEZO, FELVITEL, SZERKESZTO])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy hiányzó fájl`);
  });

  it("mindkét képernyő a közös mezőt használja", () => {
    for (const ut of KEPERNYOK) assert.match(olvas(ut), /<LabelCodeField/, ut);
  });

  it("mindkét képernyő kiteszi a beolvasó rátétjét", () => {
    // A RATET A KEPERNYO GYOKERE, NEM A MEZO BELSEJE: `position: "absolute"` a
    // SZULOJEHEZ kepest all, tehat a mezobol rajzolva a mezot takarna.
    for (const ut of KEPERNYOK)
      assert.match(olvas(ut), /\{scanner\.overlay\}/, ut);
  });

  /**
   * A KAMERA EGY HELYEN ALL -- ES EZ A TILTAS MIND A KET KEPERNYORE FUT.
   *
   * A masolat itt nem elmeleti: pontosan ez az alak allt a felviteli
   * kepernyon, es a szerkesztore ugyanezt lehetett volna atmasolni. Ket
   * peldany kulon romlik el, es a masodikat semmi nem meri.
   */
  it("egyik képernyő sem nyúl saját kamerához vagy engedélyhez", () => {
    for (const ut of KEPERNYOK) {
      const s = olvas(ut);
      assert.equal(/<CameraView/.test(s), false, `${ut}: saját kamera`);
      assert.equal(
        /useCameraPermissions/.test(s),
        false,
        `${ut}: saját kamera-engedély`,
      );
    }
  });

  it("POZITÍV KONTROLL: a két minta megtalálja őket ott, ahol VANNAK", () => {
    // Enelkul a fenti tiltas attol is zold lenne, hogy a mintak semmit nem
    // talalnak -- peldaul egy atnevezes utan, amirol senki nem tud.
    const s = olvas(MEZO);
    assert.match(s, /<CameraView/);
    assert.match(s, /useCameraPermissions/);
  });

  /**
   * A MEGTAGADOTT ENGEDELY NEM NEMA.
   *
   * Enelkul a gomb ugy nezne ki, mintha elromlott volna: megnyomod, es nem
   * tortenik semmi. Ez a mondat a kozos allvanyban all, tehat MIND A KET
   * kepernyon ugyanaz -- korabban csak a felvitelin letezett.
   */
  it("a megtagadott kamera-engedélynek saját mondata van", () => {
    assert.match(olvas(MEZO), /nincs engedély/);
  });

  /**
   * A BEOLVASOTT SZOVEG UGYANAZON AZ ALAK-ELLENORZESEN MEGY AT, mint a kezi
   * bevitel. A QR TARTALMANAK formajat sehol nem irtuk le: nem tudjuk, a
   * matrica a puszta kodot viszi-e vagy valami kore csomagolva.
   */
  it("a beolvasott kód a közös alak-ellenőrzésen megy át", () => {
    assert.match(olvas(MEZO), /normalizeAssetLabelCode\(data\)/);
  });

  /**
   * A SZERKESZTO KIMONDJA, AMIT A MEZO NEM TUD MEGTENNI.
   *
   * A kiurites NEM szedi le a matricat (a szerver `UpdateAssetDto`-ja
   * `string`-et var, nem `string | null`). Ha ezt a kepernyo elhallgatna, a
   * szerelo kiurítene a mezot, mentene, es azt hinne, leszedte -- kozben semmi
   * nem tortenne. Egy nema no-op rosszabb egy hibauzenetnel.
   */
  it("a szerkesztő kimondja, hogy a kiürítés nem szedi le a matricát", () => {
    assert.match(olvas(SZERKESZTO), /kiürítése nem szedi le/);
  });
});
