import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A FELVITELI URLAP MINDEN VALASZTOJA BECSUKOTT LEGORDULO.
 *
 * Balazs kerese (2026-09-02, a 13:33-as TestFlight build utan), szo szerint: "A
 * Partner valasztas legorduloje jo, de a tobbi... Ugyanugy kerem mint a
 * partnert."
 *
 * MIERT SZOVEGBOL: ebben a csomagban nincs komponens-renderelo kornyezet, tehat
 * a kepernyot csak a forrasan keresztul lehet allitani -- ugyanaz a minta, amit
 * a `nav-tile-roles.spec.ts` es a `label-format.spec.ts` hasznal. A HATARA is
 * ugyanaz: azt allitja, hogy a SZERKEZET ott van, nem azt, hogy jol nez ki.
 */

const KEPERNYO = "src/app/assets/new.tsx";
const forras = () => readFileSync(KEPERNYO, "utf8");

describe("az új eszköz űrlapjának választói", () => {
  it("megtalálja a képernyőt, amiről állít valamit", () => {
    // A KONTROLL A KERESESRE. Enelkul minden alabbi allitas egy ures szovegen
    // menne vegig, es zolden mondana, hogy minden rendben.
    const s = forras();

    assert.ok(s.length > 1000);
    assert.match(s, /Section title="Partner"/);
    assert.match(s, /Section title="Eszközadatok"/);
  });

  it("mind a három választó ugyanabban az alakban áll", () => {
    const s = forras();

    // A partner sajat, korabbi alakja (ownerPickerOpen), a masik ketto a kozos
    // `Legordulo` komponensben. A szam azert all itt, hogy egy NEGYEDIK valaszto
    // felvetele ne csusszon at csendben a regi, mindig nyitott alakban.
    assert.equal((s.match(/<Legordulo/g) ?? []).length, 2);
    assert.match(s, /cimke="Típus választása"/);
    assert.match(s, /cimke="Helyszín választása"/);
    assert.match(s, /setOwnerPickerOpen\(\(open\) => !open\)/);
  });

  /**
   * A KET VALASZTO MASKEPP CSUKODIK, ES EZ A LENYEG, NEM RESZLET.
   *
   * A tipusnal a koppintas EGY dontes, tehat becsukodik. A helyszinnel a
   * koppintas egyben LEFELE LEPES is (a kovetkezo szint a valasztott elem
   * gyermekeibol all), tehat a becsukas epp a lefuras kozben venne el a listat.
   *
   * MI PIROSIT: ha valaki "egysegesitesbol" a helyszinre is beteszi a
   * becsukast. Az a valtozas mukodonek latszana, es csak a haromszintes fanal
   * derulne ki, hogy a masodik szintre nem lehet eljutni.
   */
  it("a típus becsukódik választáskor, a helyszín nem", () => {
    const s = forras();

    assert.match(
      s,
      /setKind\(item\.value\);\s*\n\s*setKindPickerOpen\(false\);/,
    );
    assert.equal(
      /setUnitId\([^)]*\);\s*\n\s*setUnitPickerOpen\(false\)/.test(s),
      false,
    );
  });
});
