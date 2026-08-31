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

// A KIMENET NEVEZZE MEG A HATÓKÖRÉT. Enélkül a zöld sor nem mondja meg, hány
// fájlra vonatkozik, és pontosan ez tette a korábbi alakot félrevezetővé.
console.log(
  `@acropora/config: ${files.length} JSON fájl rendben (${files.join(", ")})`,
);
