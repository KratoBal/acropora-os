import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A CSEMPE BELYEGKEPET KER, A MENTES AZ EREDETIT.
 *
 * === A MERT HIANY, 2026-09-18 ===
 *
 * Minden galeria-csempe a TELJES MERETU fajlbol keszult. Acrobot merese az eles
 * adatbazison: egy eszkoz-galeria megnyitasa ATLAGOSAN 5,3 MB letoltes, a
 * legrosszabb 9,9 MB -- huszonkilenc kepbol.
 *
 * === MIERT KET KULON KLIENS-FUGGVENY, ES NEM EGY PARAMETER ===
 *
 * Egy elhagyhato `variant` parameter mellett a MENTES is kaphatna belyegkepet,
 * ha valaki elgepeli vagy elfelejti -- es az a hiba NEMA: a letoltott fajl
 * megnyilik, csak elmosodott. Ket kulon nev mellett ez nem lehetseges.
 *
 * Ez a teszt a KETTO SZETVALASZTASAT meri: hogy a csempe a belyegkep-agat
 * hivja, ES hogy a mentes-ut nem.
 */

const LAPOK = [
  {
    nev: "munkalap",
    komponens: "src/components/worksheets/worksheet-documents.tsx",
    kliens: "src/lib/api/worksheets.ts",
  },
  {
    nev: "eszkoz",
    komponens: "src/components/service-assets/asset-detail-page.tsx",
    kliens: "src/lib/api/assets.ts",
  },
  {
    nev: "hibajegy",
    komponens: "src/components/service-jobs/service-job-detail-page.tsx",
    kliens: "src/lib/api/service-jobs.ts",
  },
] as const;

describe("a galeria csempeje", () => {
  /** URES SOPRES NE LATSZODJON ZOLDNEK: ha az utvonalak elmozdulnak, ez szol. */
  it("mind a hat fajl olvashato", () => {
    for (const lap of LAPOK) {
      expect(readFileSync(lap.komponens, "utf8").length).toBeGreaterThan(1000);
      expect(readFileSync(lap.kliens, "utf8").length).toBeGreaterThan(1000);
    }
  });

  for (const lap of LAPOK) {
    it(`${lap.nev}: a csempe a belyegkep-agat hivja`, () => {
      const s = readFileSync(lap.komponens, "utf8");
      const csempe = s.indexOf("loadBlob={(documentId) =>");
      expect(csempe).toBeGreaterThanOrEqual(0);
      // A `loadBlob` visszahivas torzse: a kovetkezo lezaro kapcsos zarojelig.
      const torzs = s.slice(csempe, s.indexOf("\n", s.indexOf("}", csempe)));
      expect(torzs).toMatch(/downloadDocumentThumbnail\(/);
    });

    /**
     * A MENTES-UT SOHA NEM KERHET VALTOZATOT. Ezt a KLIENS oldalan merjuk, mert
     * ott dol el: a `downloadDocument` fuggveny torzsebe irt valtozat-parameter
     * MINDEN hivojat erintene, a mentest is.
     */
    it(`${lap.nev}: a mentes-ut nem ker valtozatot`, () => {
      const s = readFileSync(lap.kliens, "utf8");
      const kezd = s.indexOf(
        "  async downloadDocument(token: string, id: string, documentId: string) {",
      );
      expect(kezd).toBeGreaterThanOrEqual(0);
      const torzs = s.slice(kezd, s.indexOf("\n  },", kezd));
      expect(torzs).not.toMatch(/DOCUMENT_THUMBNAIL_VARIANT|variant=/);
    });

    it(`${lap.nev}: a belyegkep-hivas a kozos konstansokat hasznalja`, () => {
      const s = readFileSync(lap.kliens, "utf8");
      const kezd = s.indexOf("  async downloadDocumentThumbnail(");
      expect(kezd).toBeGreaterThanOrEqual(0);
      const torzs = s.slice(kezd, s.indexOf("\n  },", kezd));
      // A beirt `?variant=thumbnail` szoveg ugyanigy mukodne -- es egy
      // elgepelese NEM hibazna, csak a megtakaritas maradna el.
      expect(torzs).toMatch(
        /\$\{DOCUMENT_VARIANT_PARAM\}=\$\{DOCUMENT_THUMBNAIL_VARIANT\}/,
      );
    });
  }
});
