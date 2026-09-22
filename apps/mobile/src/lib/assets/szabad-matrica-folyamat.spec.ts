import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * A SZABAD MATRICA FOLYAMATANAK BEKOTESE, SZOVEGBOL.
 *
 * MIERT SZOVEGBOL: ebben a csomagban nincs komponens-renderelo kornyezet,
 * tehat a kepernyot csak a forrasan keresztul lehet allitani -- ugyanaz a
 * minta, amit a `new-asset-form.spec.ts` hasznal. A HATARA is ugyanaz: azt
 * allitja, hogy a SZERKEZET ott van, nem azt, hogy jol nez ki.
 *
 * A DONTESEK NEM ITT ALLNAK: a `matricaElotoltes` tiszta fuggveny, sajat
 * speckel. Ez a fajl azt meri, hogy a harom kepernyo ossze VAN kotve -- mert a
 * lancbol barmelyik szem kieshet ugy, hogy a tobbi valtozatlanul mukodik.
 */

const BEOLVASO = "src/app/assets/scan/[token].tsx";
const LISTA = "src/app/assets/index.tsx";
const SZERKESZTO = "src/app/assets/edit/[id].tsx";
const FELVITEL = "src/app/assets/new.tsx";
const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("a szabad matrica folyamata", () => {
  it("KONTROLL: megtalalja mind a negy kepernyot", () => {
    for (const ut of [BEOLVASO, LISTA, SZERKESZTO, FELVITEL])
      assert.ok(olvas(ut).length > 1000, `${ut}: ures vagy hianyzik`);
  });

  /**
   * A KET GOMB, ES MIND A KETTO VISZI A KODOT.
   *
   * MI PIROSIT: ha valaki a kodot kihagyja az utvonalbol. A gomb attol meg
   * mukodne -- megnyitna a felviteli urlapot --, csak URES mezovel, es a
   * szerelonek kezzel kellene atgepelnie a kodot, amit az imént beolvasott.
   */
  it("a szabad kodra KET ut nyilik, es mindketto viszi a kodot", () => {
    const s = olvas(BEOLVASO);

    assert.match(s, /pathname: "\/assets\/new"/);
    assert.match(s, /pathname: "\/assets"/);
    // A KOD MIND A KET HIVASBAN: a darabszam azert kell, mert egyetlen
    // `labelCode: code` sor mind a ket allitast kielegitene.
    assert.equal((s.match(/labelCode: code/g) ?? []).length, 1);
    assert.equal((s.match(/valasztKodhoz: code/g) ?? []).length, 1);
  });

  it("a lista valaszto-modban a SZERKESZTORE visz, a koddal", () => {
    const s = olvas(LISTA);

    assert.match(s, /pathname: "\/assets\/edit\/\[id\]"/);
    assert.match(s, /labelCode: valasztKodhoz/);
    // ES A MOD LATHATO IS: egy nema mod-valtas ugyanugy nez ki, mint a sima
    // lista, de MASHOVA visz.
    assert.match(s, /SZABAD MATRICA/);
  });

  /**
   * EZ A FAJL LEGFONTOSABB ALLITASA: AZ ELOTOLTES A VISSZATOLTES AGABAN ALL.
   *
   * A szerkeszto a formot UJRAEPITI a szerverrol, valahanyszor a betoltott
   * verzio valtozik. Ha az elotoltes egy KULON `useEffect`-ben allna be, ez a
   * sor CSENDBEN letorolne -- gyors halozaton a sorrend kedvezo lehet, es a
   * hiba nem is jelentkezik; lassun a mezo URESEN maradna.
   *
   * A MERES: a `matricaElotoltes` hivasa a `setLoadedFrom` UTAN es a
   * `setForm` KORNYEKEN all, ugyanabban a blokkban. Szoveg-alapu, tehat a
   * hataranak is ki kell mondva lennie: azt meri, hogy a hivas ott VAN, nem
   * azt, hogy a React ugyanabban a korben futtatja.
   */
  it("az elotoltes UGYANABBAN az agban all, ahol a visszatoltes", () => {
    const s = olvas(SZERKESZTO);
    const ag = s.slice(
      s.indexOf("if (betoltott && loadedFrom !== betoltott.updatedAt)"),
    );
    const agVege = ag.indexOf("\n  }");
    assert.ok(agVege > 0, "megtalalhato a visszatolto ag");
    const torzs = ag.slice(0, agVege);

    assert.match(torzs, /matricaElotoltes\(/);
    assert.match(torzs, /setForm\(/);
  });

  /**
   * ES A TAGADAS, AMI NELKUL A FENTI ALLITAS FELET SEM ERI: NINCS MASIK HELY,
   * AHOL A MATRICAKOD BEALLNA.
   *
   * MI PIROSIT: ha valaki „egyszerusitesbol" felvesz egy kulon hatast, ami
   * szinten a `labelCode` mezot allitja. A fenti allitas attol meg ZOLD
   * maradna -- a visszatolto agban tovabbra is ott allna a hivas --, es a ket
   * hely versenyezne egymassal.
   *
   * A BEOLVASO VISSZAHIVASA KIVETEL: az a szerelo SAJAT, kesobbi beolvasasa a
   * szerkeszton belul, nem elotoltes.
   */
  it("a matricakod SEHOL MASHOL nem toltodik elo a szerkeszton", () => {
    const s = olvas(SZERKESZTO);
    const elotoltesek = (s.match(/matricaElotoltes\(/g) ?? []).length;

    assert.equal(elotoltesek, 1, "pontosan egy helyen toltodik elo");
  });

  it("a felviteli urlap a beolvasott kodbol INDUL", () => {
    const s = olvas(FELVITEL);

    assert.match(s, /useState\(beolvasottKod \?\? ""\)/);
  });
});
