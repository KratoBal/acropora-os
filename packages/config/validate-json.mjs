/**
 * A CSOMAG MINDEN JSON FÁJLJA legyen olvasható -- nem csak az egyik.
 *
 * MÉRVE 2026-08-28: a `lint`, a `typecheck` és a `build` szkript mind ugyanazt
 * az egy sort futtatta, és az KIZÁRÓLAG a `base.json` fájlt olvasta. A
 * `nextjs.json` tartalmát szintaktikailag szétverve a
 * `pnpm --filter @acropora/config lint` NULLA kilépési kóddal futott le. A
 * csomag zöldje tehát a csomag EGY HATODÁRÓL szólt, miközben a `package.json`
 * `files` mezője szerint mind a hat JSON fájl közzé van téve.
 *
 * AMI VISZONT NEM IGAZ, ÉS EZÉRT ITT ÁLL: ettől a két megosztott konfiguráció
 * nem volt őrizetlen. Ugyanaz a rontás az `apps/web` oldalán HANGOSAN elhasalt
 * (`error TS1136` a `nextjs.json` sorára), mert a `tsconfig.json`-ja
 * kiterjeszti, és a `tsc` az örökölt fájlt is beolvassa. Ugyanez áll az
 * `apps/api` és a `nestjs.json` viszonyára. A hiba tehát nem védtelenség volt,
 * hanem FÉLREVEZETŐ JELZÉS: a csomag saját kapuja többet állított, mint amit
 * megmért, és a valódi fedezet máshonnan jött.
 *
 * EZÉRT A GLOB, ÉS NEM EGY FELSOROLÁS. Egy kézzel tartott lista pontosan akkor
 * marad le, amikor új fájl kerül a csomagba -- és egy ÚJ megosztott
 * konfigurációnak a bevezetése pillanatában még nincs fogyasztója, tehát a
 * fenti közvetett fedezet sem véd rajta.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(packageRoot)
  .filter((name) => name.endsWith(".json"))
  .sort();

// AZ OLVASÁS NEM MÉRÉS. Üres listán a ciklus egyszer sem fut le, és a szkript
// sikert jelentene -- ugyanaz a néma zöld, ami ezt a javítást kiváltotta, csak
// eggyel feljebb. Ha itt nincs mit ellenőrizni, az önmagában hiba.
if (files.length === 0) {
  console.error(
    `@acropora/config: egyetlen JSON fájlt sem találtam itt: ${packageRoot}`,
  );
  process.exit(1);
}

const failures = [];
for (const file of files) {
  try {
    JSON.parse(readFileSync(join(packageRoot, file), "utf8"));
  } catch (error) {
    // MINDET végignézzük, nem az elsőn állunk meg: egy futásból derüljön ki,
    // hány fájl romlott el, ne fájlonként egy kör.
    failures.push(`${file}: ${error.message}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`@acropora/config: ${failure}`);
  process.exit(1);
}

/**
 * A `skipLibCheck` MEGLÉTE, ÉS MIÉRT ÁLL EGY ŐRZŐ RAJTA (2026-09-21).
 *
 * === A KÁRTYA, AMI EZT KIVÁLTOTTA (1dbaccc2) ===
 *
 * A kártya azt állította, hogy a `turbo run build typecheck` EGY hívásban
 * `TS6053`-mal megáll, mert a `typecheck` nem vár a saját csomagja
 * buildjére. Öt független méréssel (törölt `.next`, törölt turbo-gyorsítótár)
 * kiderült, hogy MA nem áll meg: a `next-env.d.ts` a hiányzó fájlokra IMPORT
 * alakkal hivatkozik, azt pedig egy deklarációs fájlban a `skipLibCheck`
 * elnyeli.
 *
 * A JAVÍTÁS EZÉRT ELMARADT: a `typecheck` minden esetben egy teljes
 * Next-build mögé kerülne, minden fejlesztőnél, minden körben -- egy BIZTOS,
 * ismétlődő költség egy FELTÉTELES hiba ellen.
 *
 * === AMIT A LEZÁRÁS ELVESZÍTENE, ÉS AMIT EZ AZ ŐRZŐ MEGTART ===
 *
 * A tudást, hogy MI hozná vissza. Egy lezárt kártya pontosan addig véd, amíg
 * valaki elolvassa; egy őrző akkor is szól, ha senki nem olvassa.
 *
 * === A HATÁRA, KIMONDVA ===
 *
 * Ez a sor a KONFIGURÁCIÓT olvassa, nem a TypeScript viselkedését. Azt méri,
 * hogy a közös alapban ott áll-e a kapcsoló -- NEM azt, hogy a `TS6053`
 * visszajön-e nélküle. És SEMMIT nem állít a Next jövőbeli viselkedéséről (a
 * `reference path` alak visszatéréséről): azt nem tudjuk mérni, és egy külső
 * könyvtár jövőjéről szóló állítás hamis biztonság volna.
 *
 * Egy csomag, ami a saját `tsconfig`-jában FELÜLÍRJA `false`-ra, szintén
 * átcsúszna rajta. Ma egy sincs ilyen, és ez az őrző nem arról szól.
 */
const base = JSON.parse(readFileSync(join(packageRoot, "base.json"), "utf8"));
if (base?.compilerOptions?.skipLibCheck !== true) {
  console.error(
    "@acropora/config: a base.json compilerOptions.skipLibCheck értéke nem true. " +
      "Enélkül a Next-alkalmazások typecheckje elhasalhat a hiányzó " +
      ".next/types fájlokon (lásd a fenti magyarázatot és az 1dbaccc2 kártyát).",
  );
  process.exit(1);
}

// A KIMENET NEVEZZE MEG A HATÓKÖRÉT. Enélkül a zöld sor nem mondja meg, hány
// fájlra vonatkozik, és pontosan ez tette a korábbi alakot félrevezetővé.
console.log(
  `@acropora/config: ${files.length} JSON fájl rendben (${files.join(", ")}), ` +
    "és a base.json skipLibCheck kapcsolója a helyén van",
);
