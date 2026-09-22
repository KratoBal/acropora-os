import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * A MUNKALAP-GOMB HAROM HIVOHELYE, KULON-KULON.
 *
 * Balazs kerte 2026-09-22 19:07-kor: ugyfelkent ne lehessen munkalapot nyitni.
 * A SZERVER MAR TILTJA (`requireInternalWriter` -> `Forbidden`), a telefon
 * viszont MIND A HAROM helyen felkinalta a gombot -- mert a
 * `worksheetsManage` jogra kotott, es azt a `PARTNER_SERVICE` szerep VISELI.
 *
 * MIERT SZOVEGBOL: ebben a csomagban nincs komponens-renderelo. A DONTES tiszta
 * fuggvenyben all (`hatokorAValaszbol`), sajat speckel; ez a fajl azt meri,
 * hogy mind a harom hivohely HASZNALJA is.
 *
 * ES MIERT KULON-KULON: egy javitas, ami csak kettot fed, csendben hagyna egy
 * utat nyitva. A harom allitas kulon pirosodik, tehat a hianyzo hely NEVE is
 * megjelenik.
 */

const HELYEK = [
  ["a munkalap-lista", "src/app/worksheets/index.tsx"],
  ["a hibajegy adatlapja", "src/app/service-jobs/[id].tsx"],
  ["a jegy-felvitel vege", "src/app/service-jobs/new.tsx"],
] as const;

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("partner nem nyit munkalapot a telefonon", () => {
  it("KONTROLL: mind a harom kepernyo megvan es nem ures", () => {
    for (const [nev, ut] of HELYEK)
      assert.ok(olvas(ut).length > 1000, `${nev} (${ut}): ures vagy hianyzik`);
  });

  for (const [nev, ut] of HELYEK)
    it(`${nev}: a gomb a HATOKORHOZ van kotve`, () => {
      const s = olvas(ut);

      assert.match(
        s,
        /belsosIrasEngedett\(/,
        `${nev}: a munkalap-gomb nincs a hatokorhoz kotve. A \`worksheetsManage\` ` +
          "jog ONMAGABAN nem eleg: a PARTNER_SERVICE szerep viseli, a szerver " +
          "viszont a hatokorbol tilt.",
      );
    });

  /**
   * ES A REJTES ONMAGABAN NEM ELEG -- EZ ACROBOT KIKOTESE VOLT.
   *
   * A szerver uzenete („belsos lepes") egy VALODI szabalyt mond ki, es a
   * partnernek meg kell tudnia, miert nincs ott a gomb. Egy nema hiany
   * ugyanugy nez ki, mint egy elromlott kepernyo.
   *
   * EZ EGYBEN A POZITIV KONTROLL is: egy allitas, ami csak azt merne, hogy
   * „partnernel nincs gomb", egy URES kepernyore is zold lenne. Ez megnevezi,
   * MI all a helyen.
   */
  for (const [nev, ut] of HELYEK)
    it(`${nev}: a gomb helyen MONDAT all, nem semmi`, () => {
      assert.match(
        olvas(ut),
        /A munkalapot a szerviz készíti/,
        `${nev}: a gomb elrejtve, de semmi nem mondja meg, miert.`,
      );
    });
});
