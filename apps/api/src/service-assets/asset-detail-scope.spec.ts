import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { assetVisibilityForAndBranch } from "../auth/partner-scope.util.js";
import { assetDetailWhere } from "./service-assets.repository.js";

/**
 * AZ ADATLAP UGYANAZT LATJA, MINT A LISTA (671f87f0).
 *
 * Balazs jelzese, 2026-09-21 14:25:28 UTC: "ugyan ott vana lista az
 * eszkozokrol, de ha rakattint egyre akkor mindenre azt mondja, hogy nincs
 * ilyen eszkoz."
 *
 * AZ OK: a ket oldal KET KULONBOZO szaballyal dontott. A lista a reszlegen at
 * is beengedett, az adatlap csak a sor sajat gazdajat nezte. Eles adat ugyanazon
 * a napon: 79 eszkozbol 79 SZALLITOI tulajdonu, sajat `customerId`-je egyiknek
 * sincs, es mind a 79 a reszlegen at latszik -- tehat a lista mind a 79-et
 * megmutatta, es az adatlap mind a 79-re nemet mondott.
 *
 * Balazs 14:34:07-kor kimondta a szabalyt ("a partner azokat az eszkozoket
 * latja, aminek a helyszine hozza van rendelve"), tehat A LISTA A HELYES.
 */
describe("assetDetailWhere", () => {
  /**
   * AZ ELSO IRANY: A RESZLEGEN AT ELERHETO ESZKOZT LATNIA KELL.
   *
   * A `deepEqual` SZANDEKOS, nem `ok`: egy harmadik ag beszurasa (vagy egy ag,
   * ami nincs a kero azonositojahoz kotve) csendben szelesitene a lathatosagot,
   * es egy lazabb allitas atengedne.
   */
  it("vevő-hatókörnél a tulajdon ÉS a saját helyszín is beenged", () => {
    assert.deepEqual(
      assetDetailWhere("asset-1", {
        kind: "customer",
        customerId: "customer-1",
      }),
      {
        AND: [
          { id: "asset-1" },
          {
            OR: [
              { customerId: "customer-1" },
              { department: { customerId: "customer-1" } },
            ],
          },
        ],
      },
    );
  });

  /**
   * A MASODIK IRANY, ES ACROBOT SZERINT EZ A FONTOSABB: MASIK VEVO ESZKOZET
   * NEM SZABAD LATNIA.
   *
   * Enelkul egy "mindent beengedunk" javitas is zold lenne: a fenti allitas
   * csak azt meri, hogy a KERO azonositoja ott van, nem azt, hogy MAS nincs.
   * Itt a kero azonositoja `customer-2`, es a feltetelben SEHOL nem allhat
   * `customer-1` -- vagyis a hatokor tenyleg a keroe, nem egy beegetett ertek.
   *
   * === ES A HATARA MERVE, NEM FELTETELEZVE (2026-09-21) ===
   *
   * Ez az allitas a BEEGETETT vagy IDEGEN azonositot fogja meg. Egy olyan
   * szelesitest, ami egyszeruen ELHAGYJA a kotest (`{ department: {} }`),
   * NEM fog meg: ott sem all idegen azonosito. Kalibralva: arra a rontasra ez
   * az allitas ZOLD maradt, es a FENTI `deepEqual` pirosodott.
   *
   * Ezert all ott `deepEqual` es nem `ok` -- es ezert nem irok ide egy masodik
   * allitast ugyanarra: ket allitas, ami ugyanarra a bemenetre pirosodik, nem
   * ket meres.
   */
  it("MÁSIK vevő azonosítója nem kerül a feltételbe", () => {
    const szoveg = JSON.stringify(
      assetDetailWhere("asset-1", {
        kind: "customer",
        customerId: "customer-2",
      }),
    );
    assert.ok(!szoveg.includes("customer-1"), `idegen azonosito: ${szoveg}`);
    // KONTROLL: a sajat azonosito VISZONT ott van -- kulonben ez az allitas egy
    // ures feltetelre is zold lenne.
    assert.ok(szoveg.includes("customer-2"));
  });

  /**
   * A SZALLITOI HATOKOR A KONTROLL (acrobot 3. kikotese).
   *
   * Ott a ket szabaly MA IS egyezik (mindketto a `supplierId`-t nezi), tehat a
   * javitasnak ott NEM szabad valtoztatnia semmin. Ha a szallitoi ag is
   * elmozdul, tul sokat nyitottunk -- es azt egyik fenti allitas sem fogna meg.
   */
  it("a szállító-hatókör NEM mozdul: tulajdon, helyszín nélkül", () => {
    assert.deepEqual(
      assetDetailWhere("asset-1", { kind: "supplier", supplierId: "sup-1" }),
      { AND: [{ id: "asset-1" }, { supplierId: "sup-1" }] },
    );
  });

  it("belsős hatókörnél nincs szűkítés", () => {
    assert.deepEqual(assetDetailWhere("asset-1", { kind: "internal" }), {
      AND: [{ id: "asset-1" }, {}],
    });
  });

  /**
   * EGY FORRAS, ES EZT A FUGGVENY MAGA BIZONYITJA.
   *
   * Nem egy MASOLT alakot vetunk ossze, hanem azt, hogy a reszletlap feltetele
   * ugyanabbol a fuggvenybol epul, amit a lista hasznal. Ha valaki egy
   * parhuzamos `assetVisibleToScope(row, scope)` alakot vezetne be, ez az
   * allitas pirosodna -- pontosan az a szetcsuszas, ami a hibat okozta.
   */
  it("a láthatósági ág BETŰRE a lista függvényéből jön", () => {
    const scope = { kind: "customer", customerId: "c-9" } as const;
    const where = assetDetailWhere("asset-1", scope) as {
      AND: unknown[];
    };
    assert.deepEqual(where.AND[1], assetVisibilityForAndBranch(scope));
  });
});

/**
 * ES A CSATOLMANY-AGAK IS UGYANAZT A KAPUT VISELIK -- A FORRASBOL MERVE.
 *
 * A letoltes es a belyegkep NEM a `detail`-en at megy, hanem sajat
 * lekerdezessel. Ha csak a `detail` allt volna at, a lap megnyilna, a fajljai
 * megjelennenek, es a megnyitasuk 404-et adna: a felig alkalmazott allapot
 * rosszabb lenne, mint a mai, ahol egyertelmuen semmi nem mukodik.
 *
 * A HATARA KIMONDVA: ez az allitas a FORRAS SZOVEGET olvassa, tehat a
 * JELENLETET bizonyitja, nem azt, hogy a feltetel elsul. Egy renderelo vagy
 * adatbazisos futas tobbet mondana; az az integracios keszlet dolga.
 */
describe("a csatolmány-ágak ugyanazt a láthatóságot használják", () => {
  const forras = readFileSync(
    "src/service-assets/service-assets.repository.ts",
    "utf8",
  );

  const torzs = (nev: string) => {
    const kezd = forras.indexOf(`async ${nev}(`);
    assert.ok(kezd >= 0, `nincs ${nev} az eszkoz-repositoryban`);
    const vege = forras.indexOf("\n  async ", kezd + 1);
    assert.ok(vege > kezd, `nem talalom a ${nev} veget`);
    return forras.slice(kezd, vege);
  };

  for (const nev of ["documentThumbnail", "document"]) {
    it(`${nev}: az eszköz láthatósága a lekérdezésben áll`, () => {
      assert.match(
        torzs(nev),
        /asset: \{ AND: \[assetVisibilityForAndBranch\(scope\)\] \}/,
      );
    });
  }

  /**
   * ES A TORLES SZANDEKOSAN SZUKEBB MARAD -- KULON ALLITAS, HOGY NE
   * FELEDEKENYSEGNEK LATSZON.
   *
   * Balazs azt mondta ki, mit LAT a partner. A "latja, tehat torolhesse" ebbol
   * nem kovetkezik, es a ket tevedes ara nem egyforma: egy elmaradt torles
   * panaszt szul, egy kereetlen torles visszafordithatatlan.
   *
   * Merve 2026-09-21 (acrobot): a portal `document-panel.tsx` fajljaban NULLA
   * torlest inditó hivas all, tehat a szukebb szabaly egyetlen gombot sem tesz
   * hamissa.
   *
   * HA EZ EGYSZER KINYILIK, EZ AZ ALLITAS PIROSODIK -- es akkor a dontest
   * ki kell mondani, nem csendben atirni.
   */
  it("a törlés ágán a szűkebb szabály áll, és ez DÖNTÉS", () => {
    assert.match(
      torzs("deleteDocument"),
      /rowBelongsToScope\(document\.asset, scope\)/,
    );
  });
});
