import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A KET KEPERNYO UGYANAZT A HELYSZIN-VALASZTOT HASZNALJA.
 *
 * === A MERT HIBA ===
 *
 * A lepcsos valaszto (egy szint egyszerre, folotte a mar eldontott lepesek) a
 * FELVITELI kepernyon keszult el 2026-09-02-an, Balazs eles panaszara. A
 * SZERKESZTO kepernyon viszont vegig a REGI alak maradt: minden szintet
 * egyszerre kiteritve. Balazs kepernyofotokon mutatta meg 2026-09-16 10:41-kor
 * (Discord, mobilalkalmazas szal), szo szerint: "jo lenne ha a helyszin nem igy
 * jelenne meg mint a kepen, hanem csak a tenyleges helyszin-fa mint a masik
 * kepen".
 *
 * === MIERT NEM VETTE ESZRE SEMMI, KET HETEN AT ===
 *
 * Mert a meglevo allitas a FAJL NEVERE volt kotve, nem a VISELKEDESRE: a
 * `new-asset-form.spec.ts` a `new.tsx` fajlt olvasta, es a szerkesztorol semmit
 * nem mondott. A tiltas ("ne listazza ki egyszerre az osszes szintet") vegig ott
 * allt, es vegig zold volt, mikozben a szomszed kepernyo pontosan azt csinalta.
 *
 * Ez a fajl ezert a BEKOTEST meri, mindket oldalrol: hogy a kod egy helyen all,
 * es hogy mindket kepernyo onnan veszi.
 *
 * === MIERT FORRAS-SZOVEG ===
 *
 * A mobil tesztsorban nincs kepernyo-renderelo, tehat minden allitas tiszta
 * fuggvenyen vagy forrason all. A hatara ugyanaz, mint a tobbi ilyen spece: azt
 * allitja, hogy a SZERKEZET ott van, nem azt, hogy jol nez ki. Ha egyszer lesz
 * renderelo, ezt VISELKEDESRE kell cserelni, nem melle tenni.
 */

const VALASZTO = "src/components/assets/unit-picker.tsx";
const FELVITEL = "src/app/assets/new.tsx";
const SZERKESZTO = "src/app/assets/edit/[id].tsx";

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("a helyszin-valaszto kozos peldanya", () => {
  it("megtalálja a három fájlt, amiről állít valamit", () => {
    // A KONTROLL A KERESESRE. Enelkul minden alabbi allitas ures szovegen menne
    // vegig, es zolden mondana, hogy minden rendben.
    for (const ut of [VALASZTO, FELVITEL, SZERKESZTO])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy hiányzó fájl`);
  });

  it("mindkét képernyő a közös választót használja", () => {
    assert.match(olvas(FELVITEL), /<UnitPicker/);
    assert.match(olvas(SZERKESZTO), /<UnitPicker/);
  });

  /**
   * A LEPESEK VISSZANYITHATOK, es ez nem szepseg: enelkul egy rossz koppintas
   * ZSAKUTCA. A valasztott elem eltunik a felkinalt listabol (a kovetkezo szint
   * mar a gyermekeibol all), tehat ha a lepes nem kattinthato, nincs mibol mast
   * valasztani, es a helyszint csak az urlap elhagyasaval lehet javitani.
   */
  it("a már eldöntött lépés visszanyitható", () => {
    assert.match(olvas(VALASZTO), /Koppints a módosításhoz/);
  });

  /**
   * A KIVEZETETT HELYSZIN LATSZIK, DE NEM VALASZTHATO.
   *
   * A KETTO EGYUTT AZ ALLITAS. Ha csak tiltanank, egy MEGLEVO eszkoz kivezetett
   * helyszine neman eltunne a lancbol, es a mentes atirna valami masra -- ez a
   * szerkeszto kepernyon valos eset, a felvitelen nem all elo.
   */
  it("a kivezetett helyszín látszik, de nem választható", () => {
    const s = olvas(VALASZTO);
    assert.match(s, /disabled=\{!option\.isActive\}/);
    assert.match(s, /\(kivezetett\)/);
  });
});
