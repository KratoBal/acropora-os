import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * MIERT NEM FUGG A `typecheck` A `build`-TOL, ES MI HOZNA VISSZA A KERDEST.
 *
 * === A KARTYA, AMI EZT KIVALTOTTA (1dbaccc2 -> 6a7b9696) ===
 *
 * A kartya azt allitotta, hogy a `turbo run build typecheck` EGY hivasban
 * `TS6053`-mal megall, mert a `typecheck` nem var a sajat csomagja buildjere:
 * a Next-appok `tsconfig`-ja a GENERALT `.next/types` fajlokra hivatkozik, es
 * azok tiszta munkafan nincsenek meg.
 *
 * Ot fuggetlen meressel (torolt `.next`, torolt turbo-gyorsitotar) kiderult,
 * hogy MA nem all meg. A javitas -- egy `typecheck` -> `build` fuggoseg a
 * `turbo.json`-ban -- ezert elmaradt: AZONNALI ES ALLANDO arat fizetne (minden
 * typecheck moge egy teljes Next-build kerul, minden fejlesztonel, minden
 * korben), egy olyan kockazat ellen, amit ma semmi nem valt ki.
 *
 * === AMIT EZ AZ ORZO CSINAL, ES AMIT NEM ===
 *
 * A lezaras elvesztene a TUDAST, hogy MI hozna vissza. Egy lezart kartya addig
 * ved, amig valaki elolvassa; egy orzo akkor is szol, ha senki nem olvassa.
 *
 * AMIT MER: azt a KET FELTETELT, ami ma a hibat tavol tartja, es amit a repo
 * sajat, KOVETETT fajljaibol meg lehet nezni. Ha barmelyik elmozdul, ez a spec
 * piros lesz, NEV SZERINT, es megmondja, hogy mostantol kell a fuggoseg.
 *
 * AMIT NEM MER: magat a `TS6053`-at. Ez a spec a KONFIGURACIOT olvassa, nem a
 * TypeScript viselkedeset -- es SEMMIT nem allit a Next jovobeli
 * viselkedeserol. Egy kulso konyvtar jovojerol szolo allitas hamis biztonsag
 * volna.
 *
 * === A HARMADIK FELTETEL SZANDEKOSAN HIANYZIK INNEN, ES EZ MERESEN ALL ===
 *
 * A kartya HARMADIK feltetelkent azt kerte, hogy a ket `next-env.d.ts` IMPORT
 * alakot hasznaljon (`import "./.next/types/routes.d.ts"`), ne `reference
 * path`-ot -- mert a `skipLibCheck` az IMPORT alakot nyeli el, a `reference
 * path`-ot nem.
 *
 * EZT NEM LEHET ITT MERNI, es az ok nem elovigyazatossag:
 *
 *   git ls-files | grep next-env.d.ts   ->  NULLA
 *   .gitignore:20                       ->  next-env.d.ts
 *
 * A fajlt a Next GENERALJA, es nincs a repoban. Egy orzo, ami a lemezrol
 * olvasna, egy HELYI ARTEFAKTUMOT merne, nem a repot -- es tiszta
 * kicsekkolason (a CI-ben, `next build` elott) a fajl NEM LETEZIK. Ket
 * kimenetele lenne, es mind a ketto rossz: vagy elhasal a CI-ben egy nem
 * letezo fajlon, vagy "ha nincs, kihagyjuk" alakban CSENDBEN URES lenne --
 * pontosan az a merce, ami nem tud elbukni.
 *
 * ES A KARTYA EGY TOVABBI ALLITASA SEM IGAZ MA. Azt mondja, hogy "a ket
 * Next-app NEM EGYFORMA: az apps/web EGY generalt fajlt importal, az
 * apps/partner KETTOT". Merve 2026-09-21, a lemezen allo generalt fajlokon:
 * MIND A KETTO ugyanazt a ket sort tartalmazza, beture azonosan
 * (`routes.d.ts` ES `root-params.d.ts`). Az aszimmetria, amit a kartya a
 * csapdanak nevez, ma nem all fenn -- valoszinuleg egy korabbi Next-verzio
 * generalt maskepp. Ez nem teszi a kartyat ertelmetlenne: a BEJARAS kovetelmenye
 * (ne EGY fajlra legyen kotve az orzo) valtozatlanul helyes, es itt teljesul.
 */

/** A repo gyokere: a forditott spec a `test-dist/common/` alatt fut. */
const REPO = new URL("../../../../", import.meta.url).pathname;

/**
 * A NEXT-APPOK A FABOL JONNEK, NEM FELSOROLASBOL.
 *
 * Egy kezzel tartott lista pontosan akkor marad le, amikor egy HARMADIK
 * Next-app szuletik -- es annak a `tsconfig`-ja lenne a legfrissebb, tehat a
 * legvaloszinubb helye egy elteres alaku beallitasnak.
 */
function nextAppok(): string[] {
  const appsDir = join(REPO, "apps");
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((b) => b.isDirectory())
    .map((b) => b.name)
    .filter((nev) =>
      ["ts", "js", "mjs", "cjs"].some((v) =>
        existsSync(join(appsDir, nev, `next.config.${v}`)),
      ),
    )
    .sort();
}

/** Minden kovetett `tsconfig*.json` a faban, a `node_modules` nelkul. */
function tsconfigok(konyvtar: string, gyujto: string[] = []): string[] {
  for (const b of readdirSync(konyvtar, { withFileTypes: true })) {
    if (b.name === "node_modules" || b.name.startsWith(".")) continue;
    const ut = join(konyvtar, b.name);
    if (b.isDirectory()) tsconfigok(ut, gyujto);
    else if (/^tsconfig.*\.json$/.test(b.name)) gyujto.push(ut);
  }
  return gyujto;
}

/**
 * A `tsconfig`-ok KOMMENTET is tartalmazhatnak (a repo tobb helyen el vele),
 * tehat `JSON.parse` helyett MINTARA merunk. A kerdes amugy sem az ertek
 * kiolvasasa, hanem az, all-e valahol `false`.
 */
function szoveg(ut: string): string {
  return readFileSync(ut, "utf8");
}

describe("a Next-appok typecheckje ma build nélkül is lefut", () => {
  const appok = nextAppok();

  /**
   * A DARABSZAM ALLITAS, NEM KENYELEM.
   *
   * Enelkul egy elrontott felismeres (atnevezett `next.config`, rossz gyoker)
   * URES listat adna, es MINDEN alabbi allitas zolden atmenne -- a ciklus
   * egyszer sem futna le. Ma ketto van: `partner` es `web`.
   */
  it("pontosan két Next-app van, névvel", () => {
    assert.deepEqual(appok, ["partner", "web"]);
  });

  /**
   * AZ ELSO FELTETEL: a generalt tipusokra GLOB hivatkozik, nem fajlnev.
   *
   * A `TS6053` KONKRET fajlnevre szol; egy semmit nem illeszto GLOB nem hiba.
   * Amint valaki fajlnevre csereli, a hianyzo `.next/types` azonnal megallitja
   * a typecheck-et -- es ATTOL a perctol kell a `turbo.json`-ba a
   * `typecheck` -> `build` fuggoseg.
   */
  for (const app of appok) {
    it(`${app}: a .next/types hivatkozas GLOB marad, nem fájlnév`, () => {
      const ut = join(REPO, "apps", app, "tsconfig.json");
      const include: string[] = JSON.parse(szoveg(ut)).include ?? [];

      const generalt = include.filter((m) => m.includes(".next/types"));

      // ISMERT POZITIV KONTROLL: van egyaltalan ilyen sor. Enelkul a lenti
      // allitas egy URES listan is zold lenne -- es epp az az eset, amikor a
      // hivatkozast valaki kivette.
      assert.equal(
        generalt.length,
        1,
        `${app}: pontosan egy .next/types mintát vártam, ez van: ${include.join(", ")}`,
      );
      assert.ok(
        generalt[0]?.includes("*"),
        `${app}: a .next/types hivatkozás FÁJLNÉVRE szűkült (${generalt[0]}). ` +
          "Mostantól kell a turbo.json-ban a typecheck -> build függőség, " +
          "különben tiszta munkafán TS6053-mal áll meg a typecheck.",
      );
    });
  }

  /**
   * A MASODIK FELTETEL: a `skipLibCheck` a LANCBAN VEGIG true.
   *
   * A meglevo orzo (`packages/config/validate-json.mjs`, #894) a `base.json`
   * erteket nezi. Ez a fele MAST mer: hogy senki nem IRJA FELUL `false`-ra egy
   * sajat `tsconfig`-ban. A ketto kulon all, mert a ket elmozdulas fuggetlen,
   * es kulon-kulon egyik sem latna a masikat.
   */
  it("egyetlen tsconfig sem kapcsolja KI a skipLibCheck-et", () => {
    const fajlok = tsconfigok(join(REPO, "apps")).concat(
      tsconfigok(join(REPO, "packages")),
    );

    // ISMERT POZITIV KONTROLL: a bejaras TALAL fajlokat. Egy rossz gyoker ures
    // listat adna, es a "nincs benne false" allitas uresen is igaz.
    assert.ok(
      fajlok.length >= 5,
      `gyanúsan kevés tsconfig: ${fajlok.length} darab`,
    );

    // ES EGY MASODIK KONTROLL: a bejaras latja is a TARTALMAT, nem csak a
    // neveket. Ha ez nulla, akkor nem a "false" hianyzik, hanem az olvasas.
    const emliti = fajlok.filter((ut) => szoveg(ut).includes("skipLibCheck"));
    assert.ok(
      emliti.length >= 1,
      "egyetlen tsconfig sem említi a skipLibCheck-et, ami a bejárás hibájára utal",
    );

    const kikapcsolt = fajlok.filter((ut) =>
      /"skipLibCheck"\s*:\s*false/.test(szoveg(ut)),
    );
    assert.deepEqual(
      kikapcsolt.map((ut) => ut.slice(REPO.length)),
      [],
      "Egy tsconfig KIKAPCSOLTA a skipLibCheck-et. A Next-appok next-env.d.ts " +
        "fájlja IMPORT alakkal hivatkozik a generált .next/types fájlokra, és " +
        "ezt a hiányt ma a skipLibCheck nyeli el. Nélküle tiszta munkafán a " +
        "typecheck elhasal, és kell a turbo.json-ba a typecheck -> build függőség.",
    );
  });
});
