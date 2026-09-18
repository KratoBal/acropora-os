import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A BELYEGKEP-UT BEKOTESE A HAROM GAZDANAL -- FORRASBOL MERVE.
 *
 * === MIERT FORRASBOL, ES MIT NEM BIZONYIT ===
 *
 * A harom repository modul-szintu `prisma` peldanyt hasznal, tehat ezek a
 * lepesek adatbazis nelkul nem futtathatok. Amit ez a fajl mer, az a BEKOTES:
 * hogy az uj ag ott all, ahol allnia kell, es hogy a mar meglevo hatokor-kapuk
 * NEM maradtak ki belole.
 *
 * AMIT NEM MER: hogy a lekerdezes helyes eredmenyt ad. Azt integracios teszt
 * merne, es azt kulon kellene kimondani, ha egyszer megirjuk.
 *
 * === A MINTAK EGYEDISEGE MERVE ===
 *
 * A mintakat a `scripts/minta-egyedi.py --spec` eszkozzel mertem vissza: egy
 * minta, ami TOBB helyre illeszkedik, zolden atengedne a rontast -- akkor is,
 * ha a vedett hivas eltunt (mert egy import vagy egy komment eletben tartja).
 * Ez 2026-09-17-en negyszer fordult elo egy napon, ezert all itt kiirva.
 */

const GYOKER = new URL("../../", import.meta.url).pathname;

function forras(ut: string): string {
  return readFileSync(`${GYOKER}src/${ut}`, "utf8");
}

/** A harom gazda, egy tablaban: aki uj gazdat vesz fel, ide is beir. */
const GAZDAK = [
  {
    nev: "eszkoz",
    repository: "service-assets/service-assets.repository.ts",
    service: "service-assets/service-assets.service.ts",
    controller: "service-assets/service-assets.controller.ts",
    /** A tartalmat olvaso hivas -- a belyegkep-agnak EZ ELE kell kerulnie. */
    tartalomOlvasas:
      "const document = await this.document(id, documentId, scope);",
  },
  {
    nev: "munkalap",
    repository: "worksheets/worksheets.repository.ts",
    service: "worksheets/worksheets.service.ts",
    controller: "worksheets/worksheets.controller.ts",
    tartalomOlvasas:
      "const document = await this.repository.document(id, documentId);",
  },
  {
    nev: "hibajegy",
    repository: "service-jobs/service-job-documents.repository.ts",
    service: "service-jobs/service-job-documents.service.ts",
    controller: "service-jobs/service-job-documents.controller.ts",
    tartalomOlvasas:
      "const document = await this.repository.document(id, documentId);",
  },
] as const;

describe("a belyegkep bekotese", () => {
  /**
   * URES SOPRES NE LATSZODJON ZOLDNEK: ha az utvonalak elmozdulnak, ez a sor
   * szol -- nem az, hogy nulla talalatot elfogadunk leletnek.
   */
  it("mind a kilenc fajl olvashato", () => {
    for (const gazda of GAZDAK)
      for (const ut of [gazda.repository, gazda.service, gazda.controller])
        assert.ok(forras(ut).length > 1000, `${ut} ures vagy nem olvashato`);
  });

  for (const gazda of GAZDAK) {
    describe(gazda.nev, () => {
      /**
       * A FELTOLTES IRJA A BELYEGKEPET. A `prepareDocument` eredmenye
       * SZORASSAL megy at az `addDocument`-be (`...prepared.common`), es a
       * szoras NEM ad tobblet-mezo hibat: ha a `create` adataibol kimaradna a
       * `thumbnail`, a forditas ZOLD lenne, es minden uj kep belyegkep nelkul
       * keletkezne.
       */
      it("a feltoltesi sorba beirja a belyegkepet", () => {
        assert.match(
          forras(gazda.repository),
          /thumbnail: input\.thumbnail\s*\n?\s*\?\s*Uint8Array\.from\(input\.thumbnail\)\s*\n?\s*: null,/,
          `${gazda.repository}: az addDocument nem irja a thumbnail oszlopot`,
        );
      });

      it("a belyegkepet KULON olvassa, a tartalom nelkul", () => {
        assert.match(
          forras(gazda.repository),
          /async documentThumbnail\(/,
          `${gazda.repository}: nincs kulon belyegkep-olvasas`,
        );
      });

      /**
       * A SORREND AZ ALLITAS, NEM A JELENLET. Ha a belyegkep-ag a tartalom
       * beolvasasa UTAN allna, a szerver tovabbra is kiolvasna a teljes meretu
       * kepet az adatbazisbol -- csak nem kuldene el. A megtakaritas fele
       * elveszne, es eppen az a fele, amit senki nem lat.
       */
      it("a belyegkep-ag a tartalom beolvasasa ELOTT all", () => {
        const s = forras(gazda.service);
        const belyeg = s.indexOf("wantsThumbnail(variant)");
        const tartalom = s.indexOf(gazda.tartalomOlvasas);
        assert.ok(belyeg >= 0, `${gazda.service}: nincs belyegkep-ag`);
        assert.ok(
          tartalom >= 0,
          `${gazda.service}: nem talalom a tartalom-olvasast`,
        );
        assert.ok(
          belyeg < tartalom,
          `${gazda.service}: a belyegkep-ag a tartalom beolvasasa UTAN all`,
        );
      });

      it("a vegpont atadja a kert valtozatot", () => {
        assert.match(
          forras(gazda.controller),
          /@Query\("variant"\) variant\?: string,/,
          `${gazda.controller}: a letoltes nem fogad valtozat-parametert`,
        );
      });
    });
  }

  /**
   * A MOBIL KEZI MASOLATA UGYANAZT MONDJA, MINT A KOZOS FORRAS.
   *
   * Az `apps/mobile` SZANDEKOSAN kivul van a pnpm workspace-en, tehat nem tudja
   * importalni a `@acropora/types` erteket -- ugyanaz a helyzet, mint a
   * valasz-tipusoknal, es ott is halo meri.
   *
   * ES AZ ELTERES ITT NEMA LENNE: egy elgepelt ertek mellett a szerver az
   * EREDETIT adna vissza, a csempe megjelenne, semmi nem hibazna -- csak a
   * megtakaritas maradna el, es pont azon a kliensen, ahol a savszelesseg a
   * legdragabb.
   */
  it("a mobil valtozat-nevei egyeznek a kozos forrassal", () => {
    const kozos = readFileSync(
      `${GYOKER}../../packages/types/src/document-variant.ts`,
      "utf8",
    );
    const mobil = readFileSync(
      `${GYOKER}../../apps/mobile/src/lib/documents/document-view.ts`,
      "utf8",
    );

    for (const nev of [
      "DOCUMENT_VARIANT_PARAM",
      "DOCUMENT_THUMBNAIL_VARIANT",
    ]) {
      const minta = new RegExp(`export const ${nev} = "([^"]+)";`);
      const a = minta.exec(kozos);
      const b = minta.exec(mobil);
      assert.ok(a, `a kozos forrasban nincs ${nev}`);
      assert.ok(b, `a mobil masolatban nincs ${nev}`);
      assert.equal(
        b[1],
        a[1],
        `${nev}: a mobil "${b[1]}" erteket visel, a kozos forras "${a[1]}" erteket`,
      );
    }
  });

  /**
   * A HATOKOR-KAPUK AZ ESZKOZNEL: EZ A BIZTONSAGI ALLITAS.
   *
   * A masik ket gazdanal a lathatosag a szolgaltatasban dol el (`detail`,
   * `requireVisibleJob`), es a belyegkep-ag AZ UTAN all. Az eszkoznel viszont
   * a KET kapu magaban a lekerdezesben van (`rowBelongsToScope` a tulajdonosra,
   * `scopeMaySeeDocumentType` a fajtara), es egy masolat, ami ezeket kihagyja,
   * SEMMILYEN meglevo teszten nem bukna el.
   *
   * ES A KAR NEM ELMELETI: a belyegkep ugyanannak a kepnek a kicsinyitett masa.
   * Egy INTERNAL csatolmany csempeje ugyanugy szivargas, csak kisebb
   * felbontasban.
   */
  it("az eszkoz belyegkep-olvasasa ugyanazt a ket hatokor-kaput viseli", () => {
    const s = forras("service-assets/service-assets.repository.ts");
    const kezd = s.indexOf("async documentThumbnail(");
    assert.ok(kezd >= 0, "nincs documentThumbnail az eszkoz-repositoryban");
    const vege = s.indexOf("\n  async ", kezd + 1);
    assert.ok(vege > kezd, "nem talalom a fuggveny veget");
    const torzs = s.slice(kezd, vege);

    assert.match(
      torzs,
      /if \(!rowBelongsToScope\(row\.asset, scope\)\) return null;/,
      "a tulajdonos-kapu hianyzik a belyegkep-olvasasbol",
    );
    assert.match(
      torzs,
      /if \(!scopeMaySeeDocumentType\(row\.type, scope\)\) return null;/,
      "a dokumentum-fajta kapuja hianyzik a belyegkep-olvasasbol",
    );
  });
});
